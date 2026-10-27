import { fictionalSandbox } from "../src/consent/storageGate.ts";
// End-to-end (mocked) tests for the model-draft safety wiring. The path under
// test is the real one: converse -> graph draft_plan -> createModelPlanner
// (validate on) -> existing checker. The model is a scripted stub; fetch is
// stubbed to fail, and the test file fails if any real request is attempted.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { converse, type ConversationEnv, type StudentProfile } from "../src/agent/conversation.ts";
import { createModelPlanner, plannerFromEnv, type ModelPlannerEvents } from "../src/agent/modelPlanner.ts";
import { rulePlanner } from "../src/agent/planner.ts";
import { fixtureResearch } from "../src/context/fixtureExams.ts";
import { csvStudyData } from "../src/data/studyData.ts";
import type { ChatMessage, ChatModel } from "../src/llm/client.ts";
import { openStudentMemory, rememberPattern, type StudentMemory } from "../src/memory/studentMemory.ts";
import { bm25Retriever, loadCorpus } from "../src/rag/ncert.ts";
import { RIYA_EVENING_SKIP_PATTERN, RIYA_SWAP_REQUEST } from "../src/synthetic/riya.ts";

const realFetch = globalThis.fetch;
let fetchCalls = 0;
before(() => {
  assert.equal(process.env.HM_STUDY_SOURCE, undefined, "test must run on the local CSV source, not Zetaris");
  globalThis.fetch = (async () => {
    fetchCalls++;
    throw new Error("real network request attempted in an offline test");
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
  assert.equal(fetchCalls, 0, "no fetch call may happen");
});

const corpus = loadCorpus("corpus/ncert-phy12-ch1.json");
const RIYA: StudentProfile = { studentId: "riya", name: "Riya (fictional)", hoursPerDay: 3 };
const INTAKE = ["hi", "12th boards", "India", "90% in PCM", "15 Feb 2027", "CBSE"];

type Reply = (prompt: string) => string | Error;

function stubModel(reply: Reply): ChatModel & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    provider: "fake",
    model: "stub",
    prompts,
    async chat(messages: ChatMessage[]) {
      const prompt = messages[messages.length - 1].content;
      prompts.push(prompt);
      const r = reply(prompt);
      if (r instanceof Error) throw r;
      return { text: r, model: "stub", provider: "fake", latencyMs: 1, attempts: 1 };
    },
  };
}

function setup(model: ChatModel, opts: { memory?: boolean; kabir?: boolean } = {}) {
  const root = fictionalSandbox("hm-wire-");
  const records = path.join(root, "study-records.csv");
  fs.copyFileSync("seed/study-records.csv", records);
  if (opts.kabir) fs.appendFileSync(records, "kabir,physics:electrostatics,physics,Electrostatics,0.4,0.8\n");
  let t = Date.parse("2026-10-23T09:00:00Z");
  const clock = () => (t += 60_000);
  const mems = new Map<string, StudentMemory>();
  const events: ModelPlannerEvents & { proposals: { outcome: string; modelSuccess: boolean; issues: { code: string }[] }[] } = {
    proposals: [],
    onProposal(p) {
      this.proposals.push(p);
    },
  };
  const env: ConversationEnv = {
    planner: createModelPlanner(model, events, { validate: true }),
    retriever: bm25Retriever(corpus),
    research: fixtureResearch,
    corpora: [corpus],
    records,
    quizLog: path.join(root, "quiz-log.csv"),
    sessionsDir: path.join(root, "sessions"),
    async memoryFor(id) {
      if (!opts.memory) return null;
      if (!mems.has(id)) mems.set(id, await openStudentMemory(id, { dataRoot: path.join(root, "students"), clock }));
      return mems.get(id)!;
    },
    now: () => new Date(clock()).toISOString(),
  };
  const say = (msg: string, who = RIYA) => converse(env, who, msg);
  return { env, say, events, records, root };
}

async function intake(say: (m: string) => Promise<unknown>) {
  for (const m of INTAKE) await say(m);
}

/** Ids and numbers the prompt actually offered, so the stub only cites what it was given. */
function offered(prompt: string) {
  const topics = [...prompt.matchAll(/^- (\S+) ".*?".*\[data_row (\S+?)\]$/gm)].map((m) => ({ topicId: m[1], row: m[2] }));
  const budget = Number(prompt.match(/Daily budget: (\d+) minutes/)![1]);
  const memory = prompt.match(/\[memory (\S+?)\]/)?.[1];
  return { topics, budget, memory };
}

const plan = (prompt: string, over: Record<string, unknown> = {}, ref?: Record<string, unknown>) => {
  const o = offered(prompt);
  return JSON.stringify({
    decision: "daily_plan",
    blocks: [{ topicId: o.topics[0].topicId, minutes: 60, activity: "NCERT" }],
    message: "MODEL-PLAN: top topic first.",
    reasons: [{ text: "top priority", ref: ref ?? { kind: "data_row", id: o.topics[0].row } }],
    ...over,
  });
};

const ASK = "Plan my study for today.";

test("valid model draft is accepted: used as the model plan, counted as model success", async () => {
  const m = stubModel((p) => plan(p));
  const { say, events } = setup(m);
  await intake(say);
  const r = await say(ASK);
  assert.equal(r.reply, "MODEL-PLAN: top topic first.");
  assert.equal(r.state!.outcome, "sent");
  assert.equal(r.state!.draft!.producedBy, undefined);
  assert.ok(r.state!.trace.some((t) => t.node === "draft_plan" && t.detail.includes("model:fake/stub (model)")));
  assert.deepEqual(events.proposals.map((p) => [p.outcome, p.modelSuccess]), [["validated", true]]);
});

const REJECTED: [string, Reply, string][] = [
  ["malformed reply", () => "I think Riya should rest.", "malformed"],
  ["schema violation", () => '{"decision":"daily_plan"}', "malformed"],
  ["unknown topic", (p) => plan(p, { blocks: [{ topicId: "bio:cells", minutes: 30, activity: "a" }] }), "unknown_topic"],
  ["over time", (p) => plan(p, { blocks: [{ topicId: offered(p).topics[0].topicId, minutes: offered(p).budget + 1, activity: "a" }] }), "over_time"],
  ["unprovable data row", (p) => plan(p, {}, { kind: "data_row", id: "csv:study-records.csv#999" }), "missing_evidence"],
  ["unprovable memory", (p) => plan(p, {}, { kind: "memory", id: "mem-999" }), "missing_evidence"],
  ["unknown ref.field", (p) => plan(p, {}, { kind: "data_row", id: offered(p).topics[0].row, field: "student_id" }), "unknown_field"],
  ["ref.field on a rule ref", (p) => plan(p, {}, { kind: "rule", id: "tough-love", field: "x" }), "unknown_field"],
];

for (const [name, reply, code] of REJECTED) {
  test(`rejected, baseline fallback labelled, not model success: ${name}`, async () => {
    const { say, events } = setup(stubModel(reply));
    await intake(say);
    const r = await say(ASK);
    const d = r.state!.draft!;
    assert.match(d.producedBy ?? "", new RegExp(`^rule-planner-v1 \\(rules; model rejected: .*${code}`));
    assert.notEqual(r.reply, "MODEL-PLAN: top topic first.");
    assert.match(r.reply, /^Today: /, "reply is the rule planner's text");
    assert.ok(r.state!.trace.some((t) => t.node === "draft_plan" && t.detail.includes("model rejected")));
    assert.deepEqual(events.proposals.map((p) => [p.outcome, p.modelSuccess]), [["rejected", false]]);
    assert.ok(events.proposals[0].issues.some((i) => i.code === code));
  });
}

test("rejected: another student's evidence (Kabir's row cited for Riya)", async () => {
  let kabirRow = "";
  const m = stubModel((p) => plan(p, {}, { kind: "data_row", id: kabirRow }));
  const { say, events, records } = setup(m, { kabir: true });
  kabirRow = (await csvStudyData(records).topicsFor("kabir")).rows[0].sourceRow;
  await intake(say);
  const r = await say(ASK);
  assert.ok(!m.prompts.some((p) => p.includes(kabirRow)), "Kabir's row was never offered to the model");
  assert.match(r.state!.draft!.producedBy ?? "", /^rule-planner-v1 \(rules; model rejected: missing_evidence/);
  assert.deepEqual(events.proposals.map((p) => p.modelSuccess), [false]);
});

test("model error: baseline fallback labelled model failed, not model success", async () => {
  const { say, events } = setup(stubModel(() => new Error("nvidia HTTP 503: busy")));
  await intake(say);
  const r = await say(ASK);
  assert.match(r.state!.draft!.producedBy ?? "", /^rule-planner-v1 \(rules; model failed: nvidia HTTP 503/);
  assert.deepEqual(events.proposals.map((p) => [p.outcome, p.modelSuccess]), [["model_error", false]]);
});

test("rejected draft never reaches the student; the baseline equals the rule planner's own answer", async () => {
  const bad = setup(stubModel(() => "not json"));
  const base = setup(stubModel(() => "unused"));
  base.env.planner = rulePlanner;
  await intake(bad.say);
  await intake(base.say);
  const a = await bad.say(ASK);
  const b = await base.say(ASK);
  assert.equal(a.reply, b.reply);
  assert.deepEqual(a.state!.draft!.blocks, b.state!.draft!.blocks);
});

test("memory on: a recalled memory is valid evidence", async () => {
  const m = stubModel((p) => plan(p, {}, { kind: "memory", id: offered(p).memory! }));
  const { env, say, events } = setup(m, { memory: true });
  rememberPattern((await env.memoryFor("riya"))!, RIYA_EVENING_SKIP_PATTERN);
  await intake(say);
  const r = await say(RIYA_SWAP_REQUEST);
  assert.match(m.prompts[0], /\[memory /);
  assert.equal(r.state!.draft!.producedBy, undefined);
  assert.deepEqual(events.proposals.map((p) => p.modelSuccess), [true]);
});

test("memory off through the real path: nothing recalled, a stored memory cited by the model is rejected", async () => {
  let storedId = "";
  const m = stubModel((p) => plan(p, {}, { kind: "memory", id: storedId }));
  const { env, say, events } = setup(m, { memory: true });
  storedId = rememberPattern((await env.memoryFor("riya"))!, RIYA_EVENING_SKIP_PATTERN).id as string;
  await intake(say);
  await say("Please turn memory off");
  const r = await say(RIYA_SWAP_REQUEST);
  assert.match(m.prompts[0], /Memories:\n- \(none\)/);
  assert.ok(!m.prompts[0].includes(storedId) && !m.prompts[0].includes("[memory "));
  assert.match(r.state!.draft!.producedBy ?? "", /^rule-planner-v1 \(rules; model rejected: missing_evidence/);
  assert.deepEqual(events.proposals.map((p) => p.modelSuccess), [false]);
});

test("default with no model is unchanged: rule planner, no model call", () => {
  assert.equal(plannerFromEnv({}, null), rulePlanner);
  assert.equal(plannerFromEnv({ HM_PLANNER: "model" }, null), rulePlanner);
  const m = stubModel(() => "unused");
  assert.equal(plannerFromEnv({}, m), rulePlanner);
  assert.equal(plannerFromEnv({ HM_PLANNER: "model" }, m).kind, "model");
  assert.equal(m.prompts.length, 0);
});

test("plannerFromEnv(HM_PLANNER=model) validates: an unprovable draft falls back", async () => {
  const m = stubModel((p) => plan(p, {}, { kind: "memory", id: "mem-999" }));
  const planner = plannerFromEnv({ HM_PLANNER: "model" }, m);
  const base = setup(m);
  base.env.planner = planner;
  await intake(base.say);
  const r = await base.say(ASK);
  assert.match(r.state!.draft!.producedBy ?? "", /model rejected: missing_evidence/);
});
