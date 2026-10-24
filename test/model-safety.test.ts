// Offline tests for the model-proposal safety layer. fetch is stubbed to fail
// on any real request; the model is a scripted stand-in.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runMentor, type StudentContext } from "../src/agent/graph.ts";
import { createModelPlanner } from "../src/agent/modelPlanner.ts";
import { compareProposal, runModelProposal, validateModelDraft } from "../src/agent/modelSafety.ts";
import type { PlannerInput } from "../src/agent/planner.ts";
import { rankTopics } from "../src/core/priority.ts";
import type { ChatMessage, ChatModel } from "../src/llm/client.ts";
import { openStudentMemory, rememberPattern } from "../src/memory/studentMemory.ts";
import { RIYA, RIYA_DAYS_TO_EXAM, RIYA_EVENING_SKIP_PATTERN, RIYA_SWAP_REQUEST, RIYA_TOPICS } from "../src/synthetic/riya.ts";

const realFetch = globalThis.fetch;
let fetchCalls = 0;
before(() => {
  globalThis.fetch = (async () => {
    fetchCalls++;
    throw new Error("real network request attempted in an offline test");
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
  assert.equal(fetchCalls, 0, "no fetch call may happen");
});

const student: StudentContext = { studentId: RIYA.studentId, name: RIYA.name, hoursPerDay: RIYA.dailyStudyHours, daysToExam: RIYA_DAYS_TO_EXAM, topics: RIYA_TOPICS };
const ranked = rankTopics(RIYA_TOPICS, RIYA_DAYS_TO_EXAM);
const input = (over: Partial<PlannerInput> = {}): PlannerInput => ({
  name: "Riya", hoursPerDay: 3, message: "Plan my day", intent: "plan", ranked, memories: [{ id: "mem-1", content: "x", tags: [], relevance: 1 }], attempt: 1, feedback: [], ...over,
});

function model(reply: string | Error): ChatModel & { prompts: ChatMessage[][] } {
  const prompts: ChatMessage[][] = [];
  return {
    provider: "fake", model: "scripted", prompts,
    async chat(m) {
      prompts.push(m);
      if (reply instanceof Error) throw reply;
      return { text: reply, model: "scripted", provider: "fake", latencyMs: 1, attempts: 1 };
    },
  };
}

const draft = (over: Record<string, unknown> = {}, ref: Record<string, unknown> = { kind: "data_row", id: "fixture:riya_topics#1" }) =>
  JSON.stringify({
    decision: "daily_plan",
    blocks: [{ topicId: "physics:electrostatics", minutes: 90, activity: "NCERT" }],
    message: "Electrostatics first.",
    reasons: [{ text: "top priority", ref }],
    ...over,
  });

const ctx = (extra = {}) => ({ rows: ranked, hoursPerDay: 3, memories: input().memories, ...extra });
const codes = (r: ReturnType<typeof validateModelDraft>) => (r.ok ? [] : r.issues.map((i) => i.code));

test("valid draft passes", () => {
  const v = validateModelDraft(draft(), ctx());
  assert.equal(v.ok, true);
});

test("malformed JSON and schema violations are rejected", () => {
  assert.deepEqual(codes(validateModelDraft("no json here", ctx())), ["malformed"]);
  assert.deepEqual(codes(validateModelDraft('{"decision":"daily_plan"', ctx())), ["malformed"]);
  assert.deepEqual(codes(validateModelDraft('{"decision":"x"}', ctx())), ["malformed"]);
});

test("unknown topic, over-time plan", () => {
  assert.deepEqual(codes(validateModelDraft(draft({ blocks: [{ topicId: "bio:cells", minutes: 30, activity: "a" }] }), ctx())), ["unknown_topic"]);
  assert.deepEqual(codes(validateModelDraft(draft({ blocks: [{ topicId: "physics:electrostatics", minutes: 181, activity: "a" }] }), ctx())), ["over_time"]);
});

test("evidence: missing data row, missing memory, rule refs need no row", () => {
  assert.deepEqual(codes(validateModelDraft(draft({}, { kind: "data_row", id: "fixture:riya_topics#99" }), ctx())), ["missing_evidence"]);
  assert.deepEqual(codes(validateModelDraft(draft({}, { kind: "memory", id: "mem-404" }), ctx())), ["missing_evidence"]);
  assert.equal(validateModelDraft(draft({}, { kind: "memory", id: "mem-1" }), ctx()).ok, true);
  assert.equal(validateModelDraft(draft({}, { kind: "rule", id: "tough-love" }), ctx()).ok, true);
});

test("evidence: ambiguous row, foreign row, row both own and foreign", () => {
  const dup = [...ranked, { ...ranked.find((t) => t.sourceRow === "fixture:riya_topics#2")!, topicId: "chemistry:dup" }];
  assert.deepEqual(codes(validateModelDraft(draft({}, { kind: "data_row", id: "fixture:riya_topics#2" }), ctx({ rows: dup }))), ["ambiguous_evidence"]);
  const dupMem = { memories: [...input().memories, { id: "mem-1", content: "y", tags: [], relevance: 1 }] };
  assert.deepEqual(codes(validateModelDraft(draft({}, { kind: "memory", id: "mem-1" }), ctx(dupMem))), ["ambiguous_evidence"]);
  const other = { id: "kabir:row#1", sourceRow: "kabir:row#1" };
  assert.deepEqual(codes(validateModelDraft(draft({}, { kind: "data_row", id: other.id }), ctx({ foreignRowIds: [other.id] }))), ["foreign_evidence"]);
  const both = [...ranked, { ...ranked[0], topicId: "x:y", sourceRow: other.id }];
  assert.deepEqual(codes(validateModelDraft(draft({}, { kind: "data_row", id: other.id }), ctx({ rows: both, foreignRowIds: [other.id] }))), ["ambiguous_evidence"]);
});

test("field references use own properties only", () => {
  assert.equal(validateModelDraft(draft({}, { kind: "data_row", id: "fixture:riya_topics#1", field: "mastery" }), ctx()).ok, true);
  for (const field of ["nope", "toString", "__proto__", 7])
    assert.deepEqual(codes(validateModelDraft(draft({}, { kind: "data_row", id: "fixture:riya_topics#1", field }), ctx())), ["unknown_field"], String(field));
});

test("rows without a student_id field are accepted when correctly scoped", () => {
  assert.ok(!("student_id" in ranked[0]));
  assert.equal(validateModelDraft(draft(), ctx()).ok, true);
});

const opts = { daysToExam: RIYA_DAYS_TO_EXAM };

test("run outcomes: validated, rejected, model_error, fallback are distinct; only validated is model success", async () => {
  const ok = await runModelProposal(model(draft()), input(), opts);
  assert.equal(ok.outcome, "validated");
  assert.equal(ok.modelSuccess, true);
  assert.equal(ok.draft, ok.proposal);

  const bad = await runModelProposal(model(draft({}, { kind: "memory", id: "mem-404" })), input(), opts);
  assert.equal(bad.outcome, "rejected");
  assert.equal(bad.modelSuccess, false);
  assert.equal(bad.draft, bad.baseline);
  assert.equal(bad.proposal, null);

  const err = await runModelProposal(model(new Error("HTTP 503")), input(), opts);
  assert.equal(err.outcome, "model_error");
  assert.equal(err.modelSuccess, false);
  assert.equal(err.draft, err.baseline);
  assert.match(err.error ?? "", /503/);

  const none = await runModelProposal(null, input(), opts);
  assert.equal(none.outcome, "fallback");
  assert.equal(none.modelSuccess, false);
  assert.equal(new Set([ok, bad, err, none].map((r) => r.outcome)).size, 4);
});

test("baseline ranks only the student's own rows", async () => {
  const foreignRow = { topicId: "physics:foreign", subject: "physics", name: "Foreign", mastery: 0, marksWeight: 1, sourceRow: "kabir:row#1" };
  const r = await runModelProposal(model(new Error("down")), input({ ranked: [...ranked, { ...foreignRow, priority: 99, urgency: 1 }] }), { ...opts, foreignRowIds: ["kabir:row#1"] });
  assert.ok(r.baseline.blocks.length > 0);
  assert.ok(!r.baseline.blocks.some((b) => b.topicId === "physics:foreign"));
  assert.ok(!r.baseline.evidence.includes("kabir:row#1"));
});

test("comparison shows baseline beside the proposal with its status", async () => {
  const ok = compareProposal(await runModelProposal(model(draft()), input(), opts));
  assert.equal(ok.proposal.status, "validated");
  assert.ok(ok.baseline.blocks.length > 0 && ok.proposal.blocks?.length);
  const bad = compareProposal(await runModelProposal(model("junk"), input(), opts));
  assert.equal(bad.proposal.status, "rejected");
  assert.equal(bad.proposal.decision, undefined);
  assert.match(bad.proposal.issues[0], /^malformed/);
  const err = compareProposal(await runModelProposal(model(new Error("boom")), input(), opts));
  assert.match(err.proposal.issues[0], /model_error: boom/);
});

test("memory off removes remembered facts from the prompt sent to the model", async () => {
  // No existing test inspects prompt text with memory off (controls.test.ts only checks state.memories is empty).
  const mem = await openStudentMemory(RIYA.studentId, { dataRoot: fs.mkdtempSync(path.join(os.tmpdir(), "hm-ms-")) });
  const rec = rememberPattern(mem, RIYA_EVENING_SKIP_PATTERN);
  const reply = JSON.stringify({ decision: "compromise", blocks: [{ topicId: "physics:electrostatics", minutes: 90, activity: "a" }], message: "ok", reasons: [{ text: "t", ref: { kind: "data_row", id: "fixture:riya_topics#1" } }] });

  const on = model(reply);
  await runMentor({ planner: createModelPlanner(on), memory: mem }, student, RIYA_SWAP_REQUEST);
  const withMem = on.prompts[0][1].content;
  assert.ok(withMem.includes(RIYA_EVENING_SKIP_PATTERN.content) && withMem.includes(`[memory ${rec.id}]`), "control: memory on puts the fact in the prompt");

  const off = model(reply);
  await runMentor({ planner: createModelPlanner(off), memory: null }, student, RIYA_SWAP_REQUEST);
  const without = off.prompts[0].map((m) => m.content).join("\n");
  assert.ok(!without.includes(RIYA_EVENING_SKIP_PATTERN.content));
  assert.ok(!without.includes(`[memory ${rec.id}]`));
  assert.match(without, /Memories:\n- \(none\)/);
});
