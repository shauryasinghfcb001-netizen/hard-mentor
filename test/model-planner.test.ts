import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runMentor, type StudentContext } from "../src/agent/graph.ts";
import { createModelPlanner, extractJson, plannerFromEnv } from "../src/agent/modelPlanner.ts";
import { rulePlanner } from "../src/agent/planner.ts";
import type { ChatMessage, ChatModel } from "../src/llm/client.ts";
import { openStudentMemory, rememberPattern } from "../src/memory/studentMemory.ts";
import { RIYA, RIYA_DAYS_TO_EXAM, RIYA_EVENING_SKIP_PATTERN, RIYA_SWAP_REQUEST, RIYA_TOPICS } from "../src/synthetic/riya.ts";

const student: StudentContext = { studentId: RIYA.studentId, name: RIYA.name, hoursPerDay: RIYA.dailyStudyHours, daysToExam: RIYA_DAYS_TO_EXAM, topics: RIYA_TOPICS };

/** Scripted stand-in for Nemotron: returns canned replies in order and records prompts. */
function scriptedModel(replies: (string | Error)[]): ChatModel & { prompts: ChatMessage[][] } {
  const prompts: ChatMessage[][] = [];
  return {
    provider: "fake",
    model: "scripted",
    prompts,
    async chat(messages) {
      prompts.push(messages);
      const r = replies.shift();
      if (r === undefined) throw new Error("scripted model ran out of replies");
      if (r instanceof Error) throw r;
      return { text: r, model: "scripted", provider: "fake", latencyMs: 1, attempts: 1 };
    },
  };
}

async function seeded() {
  const mem = await openStudentMemory(RIYA.studentId, { dataRoot: fs.mkdtempSync(path.join(os.tmpdir(), "hm-mp-")) });
  const rec = rememberPattern(mem, RIYA_EVENING_SKIP_PATTERN);
  return { mem, memId: rec.id as string };
}

const refuse = (memId: string, minutes = 90) =>
  "Sure, here is the plan:\n```json\n" +
  JSON.stringify({
    decision: "refuse_swap",
    blocks: [
      { topicId: "physics:electrostatics", minutes, activity: "NCERT examples" },
      { topicId: "maths:integrals", minutes: 90, activity: "practice" },
    ],
    message: "No swap, Riya. Electrostatics first.",
    reasons: [
      { text: "You skipped it before", ref: { kind: "memory", id: memId } },
      { text: "Top priority", ref: { kind: "data_row", id: "fixture:riya_topics#1" } },
      { text: "Invented evidence", ref: { kind: "memory", id: "mem-999" } },
    ],
  }) +
  "\n```";

test("model planner: parsed JSON drives the graph; trace names the model; invented ids are not evidence", async () => {
  const { mem, memId } = await seeded();
  const model = scriptedModel([refuse(memId)]);
  const s = await runMentor({ planner: createModelPlanner(model), memory: mem }, student, RIYA_SWAP_REQUEST);
  assert.equal(s.outcome, "sent");
  assert.equal(s.draft?.decision, "refuse_swap");
  assert.ok(s.draft?.evidence.includes(memId));
  assert.ok(!s.draft?.evidence.includes("mem-999"), "ids not given to the model must not count as evidence");
  assert.ok(s.trace.some((t) => t.node === "draft_plan" && t.detail.includes("model:fake/scripted (model)")));
  // the prompt carried the memory and the data rows
  const prompt = model.prompts[0][1].content;
  assert.ok(prompt.includes(`[memory ${memId}]`) && prompt.includes("fixture:riya_topics#1"));
});

test("model planner: checker rejection feeds back into the model's next prompt", async () => {
  const { mem, memId } = await seeded();
  const model = scriptedModel([refuse(memId, 200), refuse(memId, 90)]); // 200+90 > 180 budget
  const s = await runMentor({ planner: createModelPlanner(model), memory: mem }, student, RIYA_SWAP_REQUEST);
  assert.equal(s.attempts, 2);
  assert.equal(s.outcome, "sent");
  assert.match(model.prompts[1][1].content, /hours_fit: 290 min planned, budget 180 min/);
});

test("model planner: bad reply or HTTP error falls back to rules and says so", async () => {
  const { mem } = await seeded();
  const model = scriptedModel(["I think Riya should rest.", new Error("nvidia HTTP 503: busy")]);
  const planner = createModelPlanner(model);
  const s = await runMentor({ planner, memory: mem }, student, RIYA_SWAP_REQUEST);
  assert.equal(s.draft?.decision, "refuse_swap");
  assert.match(s.draft?.producedBy ?? "", /^rule-planner-v1 \(rules; model failed: no JSON object/);
  assert.ok(s.trace.some((t) => t.node === "draft_plan" && t.detail.includes("model failed")));
  const s2 = await runMentor({ planner, memory: mem }, student, RIYA_SWAP_REQUEST);
  assert.match(s2.draft?.producedBy ?? "", /model failed: nvidia HTTP 503/);
});

test("planner flag: HM_PLANNER=model needs a model; default is rules", () => {
  const model = scriptedModel([]);
  assert.equal(plannerFromEnv({}, model), rulePlanner);
  assert.equal(plannerFromEnv({ HM_PLANNER: "model" }, null), rulePlanner);
  assert.equal(plannerFromEnv({ HM_PLANNER: "model" }, model).kind, "model");
});

test("extractJson handles braces inside strings", () => {
  assert.deepEqual(extractJson('x {"a":"}{","b":{"c":1}} y'), { a: "}{", b: { c: 1 } });
});
