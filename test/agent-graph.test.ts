import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAX_DRAFTS, runMentor, type StudentContext } from "../src/agent/graph.ts";
import { rulePlanner, type Planner } from "../src/agent/planner.ts";
import { buildWhyCard, renderWhyCard } from "../src/agent/whyCard.ts";
import { openStudentMemory, rememberPattern } from "../src/memory/studentMemory.ts";
import { RIYA, RIYA_DAYS_TO_EXAM, RIYA_EVENING_SKIP_PATTERN, RIYA_SWAP_REQUEST, RIYA_TOPICS } from "../src/synthetic/riya.ts";

const student: StudentContext = {
  studentId: RIYA.studentId,
  name: RIYA.name,
  hoursPerDay: RIYA.dailyStudyHours,
  daysToExam: RIYA_DAYS_TO_EXAM,
  topics: RIYA_TOPICS,
};

async function seededMemory() {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hm-graph-"));
  const mem = await openStudentMemory(RIYA.studentId, { dataRoot });
  const rec = rememberPattern(mem, RIYA_EVENING_SKIP_PATTERN);
  return { mem, memoryId: rec.id as string };
}

test("memory ON vs OFF changes Riya's swap decision, and the why card cites the memory", async () => {
  const { mem, memoryId } = await seededMemory();
  const on = await runMentor({ planner: rulePlanner, memory: mem }, student, RIYA_SWAP_REQUEST);
  const off = await runMentor({ planner: rulePlanner, memory: null }, student, RIYA_SWAP_REQUEST);

  assert.equal(on.intent, "swap_request");
  assert.equal(on.outcome, "sent");
  assert.equal(off.outcome, "sent");
  assert.equal(on.draft?.decision, "refuse_swap");
  assert.equal(off.draft?.decision, "compromise");

  const onCard = buildWhyCard(on);
  const offCard = buildWhyCard(off);
  assert.ok(onCard.reasons.some((r) => r.ref.kind === "memory" && r.ref.id === memoryId));
  assert.ok(!offCard.reasons.some((r) => r.ref.kind === "memory"));
  assert.ok(on.draft!.evidence.includes(memoryId));
  // Both keep the top priority; only memory-on drops Organic for today.
  assert.equal(on.draft!.blocks[0].topicId, "physics:electrostatics");
  assert.ok(!on.draft!.blocks.some((b) => b.topicId === "chemistry:organic"));
  assert.ok(off.draft!.blocks.some((b) => b.topicId === "chemistry:organic"));
  assert.equal(onCard.sql, null); // no fabricated SQL before Zetaris
  assert.match(renderWhyCard(onCard), new RegExp(`memory: ${memoryId}`));
  assert.ok(off.trace.some((t) => t.detail.includes("memory OFF")));
});

test("distress overrides everything: no recall, no plan, Tele-MANAS reply", async () => {
  const { mem } = await seededMemory();
  const s = await runMentor({ planner: rulePlanner, memory: mem }, student, "I can't take this anymore, I want to die");
  assert.equal(s.outcome, "distress_override");
  assert.match(s.reply, /14416/);
  assert.deepEqual(s.trace.map((t) => t.node), ["sense", "distress_override"]);
});

test("checker rejects a bad draft and the planner revises (visible in loop log)", async () => {
  let calls = 0;
  const flaky: Planner = {
    name: "flaky-test-planner",
    kind: "rules",
    async draft(input) {
      calls++;
      const good = await rulePlanner.draft(input);
      if (input.attempt === 1) return { ...good, blocks: good.blocks.map((b) => ({ ...b, minutes: b.minutes * 2 })) };
      assert.ok(input.feedback.some((f) => f.rule === "hours_fit"), "revision receives checker feedback");
      return good;
    },
  };
  const s = await runMentor({ planner: flaky, memory: null }, student, "plan my day");
  assert.equal(calls, 2);
  assert.equal(s.outcome, "sent");
  assert.ok(s.trace.some((t) => t.node === "check_plan" && t.detail.includes("rejected: hours_fit")));
});

test("three rejected drafts fall back to a safe reply", async () => {
  let calls = 0;
  const bad: Planner = {
    name: "always-bad-test-planner",
    kind: "rules",
    async draft() {
      calls++;
      return { decision: "bad", blocks: [{ topicId: "physics:optics", minutes: 500, activity: "x" }], message: "Stop being lazy", evidence: [], reasons: [] };
    },
  };
  const s = await runMentor({ planner: bad, memory: null }, student, "plan my day");
  assert.equal(calls, MAX_DRAFTS);
  assert.equal(s.outcome, "fallback");
  assert.equal(s.draft?.decision, "safe_fallback");
  assert.equal(s.draft?.blocks[0].topicId, "physics:electrostatics");
  assert.doesNotMatch(s.reply, /lazy/);
});
