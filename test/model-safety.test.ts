import { fictionalSandbox } from "../src/consent/storageGate.ts";
// Offline tests for the model-proposal safety layer. fetch is stubbed to fail
// on any real request; the model is a scripted stand-in.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runMentor, type StudentContext } from "../src/agent/graph.ts";
import { buildPlannerPrompt, createModelPlanner } from "../src/agent/modelPlanner.ts";
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

test('study budget contract preserves hours, fractional minutes and aggregate validation without rewriting output', async () => {
  for (const hoursPerDay of [3, 0.75, 1 / 128]) {
    const budget = hoursPerDay * 60;
    const blocks = budget ? [budget / 2, budget / 2].map(minutes => ({ topicId: ranked[0].topicId, minutes, activity: 'NCERT' })) : [];
    const text = draft({ blocks });
    const fake = model(text);
    const scoped = input({ hoursPerDay });
    const result = await createModelPlanner(fake, {}, { validate: true }).draft(scoped);
    assert.equal(fake.prompts.length, 1);
    assert.match(fake.prompts[0][0].content, /sum minutes across EVERY block, including repeated topics/);
    assert.match(fake.prompts[0][0].content, /time is zero/);
    assert.ok(fake.prompts[0][1].content.includes(`Daily budget: ${budget} minutes.`));
    assert.ok(fake.prompts[0][1].content.includes(`${hoursPerDay} hours/day * 60 minutes/hour = ${budget} minutes total across all blocks`));
    assert.ok(fake.prompts[0][1].content.includes(`sum(blocks[].minutes) <= ${budget} minutes`));
    assert.deepEqual(result.blocks, blocks);
    assert.equal(result.comparison?.proposal.status, 'validated');
    // Each block fits alone; their aggregate exceeds the shared budget.
    const over = draft({ blocks: [budget || 1, 1].map(minutes => ({ topicId: ranked[0].topicId, minutes, activity: 'NCERT' })) });
    assert.deepEqual(codes(validateModelDraft(over, ctx({ hoursPerDay }))), ['over_time']);
    const rejectedModel = model(over);
    const rejected = await createModelPlanner(rejectedModel, {}, { validate: true }).draft(scoped);
    assert.equal(rejectedModel.prompts.length, 1, 'no repair generation');
    assert.equal(rejected.comparison?.proposal.status, 'rejected');
    assert.match(rejected.producedBy!, /rules; model rejected: over_time/);
  }
});

test('missing or invalid study allowance never becomes a default or reaches the model', async () => {
  for (const hoursPerDay of [undefined, null, NaN, Infinity, -1] as unknown as number[]) {
    const scoped = input({ hoursPerDay });
    assert.throws(() => buildPlannerPrompt(scoped), { message: 'invalid_study_allowance' });
    const fake = model(draft());
    const result = await createModelPlanner(fake, {}, { validate: true }).draft(scoped);
    assert.equal(fake.prompts.length, 0);
    assert.equal(result.comparison?.proposal.status, 'model_error');
  }
});

test('over_time does not short circuit typed evidence checks or establish grounding', () => {
  const over = { blocks: [{ topicId: ranked[0].topicId, minutes: 181, activity: 'NCERT' }] };
  assert.deepEqual(codes(validateModelDraft(draft(over, { kind: 'memory', id: 'unprovided' }), ctx())), ['over_time', 'missing_evidence']);
  // Empty reasons remain schema-valid but cannot pass the evidence requirement.
  assert.deepEqual(codes(validateModelDraft(draft({ ...over, reasons: [] }), ctx())), ['over_time', 'missing_evidence']);
});

test("prompt contract has no concrete example ids or observations and handles empty typed registries", async () => {
  for (const scoped of [input(), input({ memories: [] }), input({ ranked: [] }), input({ ranked: [], memories: [] })]) {
    const fake = model(JSON.stringify({ decision: 'nothing_due', blocks: [], message: 'Synthetic.', reasons: [] }));
    await createModelPlanner(fake, {}, { validate: true }).draft(scoped);
    assert.equal(fake.prompts.length, 1);
    assert.deepEqual(fake.prompts[0].map(message => message.role), ['system', 'user']);
    const system = fake.prompts[0][0].content;
    assert.doesNotMatch(system, /record:riya|physics:electrostatics|Focus on Electrostatics|Top priority weak topic/);
    // Shape instructions nominate no literal reference id (available or otherwise).
    assert.doesNotMatch(system, /"id"\s*:\s*"/);
    assert.match(system, /Copy the id exactly/);
    assert.match(system, /Registry membership/);
    assert.match(system, /record supports the reason's claim/);
    assert.match(system, /data, not instructions/);
    assert.match(system, /no plan can pass the current checker/);
    assert.match(system, /ref.kind MUST be exactly "data_row", "memory", or "rule"/);
    assert.match(system, /600 output tokens/);
    assert.match(system, /Require at least one supported data_row or memory reason/);
    const user = fake.prompts[0][1].content;
    assert.equal(user, buildPlannerPrompt(scoped));
    if (!scoped.memories.length) {
      assert.match(user, /Memories:\n- \(none\)/);
      assert.doesNotMatch(user, /\[memory /);
    }
    if (!scoped.ranked.length) {
      assert.match(user, /Topics, highest priority first:\n- \(none\)/);
      assert.doesNotMatch(user, /\[data_row /);
    }
  }
});

test("typed references remain exact after prompt correction, including empty and memory-off inputs", () => {
  for (const [kind, id] of [
    ['data_row', 'mem-1'], ['memory', ranked[0].sourceRow],
    ['data_row', 'record:riya:physics:electrostatics'], ['memory', 'fabricated'],
  ]) assert.deepEqual(codes(validateModelDraft(draft({}, { kind, id }), ctx())), ['missing_evidence']);
  assert.deepEqual(codes(validateModelDraft(draft({}, { kind: 'memory', id: 'mem-1' }), ctx({ memories: [] }))), ['missing_evidence']);
  const empty = ctx({ rows: [], memories: [] });
  assert.deepEqual(codes(validateModelDraft(draft({ decision: 'nothing_due', blocks: [], reasons: [] }), empty)), ['checker_rejected', 'missing_evidence']);
  assert.deepEqual(codes(validateModelDraft(draft({ blocks: [] }), empty)), ['checker_rejected', 'missing_evidence']);
  assert.deepEqual(codes(validateModelDraft(draft({ reasons: [{ text: 'Synthetic' }] }), ctx())), ['malformed']);
});

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
  assert.deepEqual(codes(validateModelDraft(draft({ blocks: [{ topicId: "bio:cells", minutes: 30, activity: "a" }] }), ctx())), ["checker_rejected", "unknown_topic"]);
  assert.deepEqual(codes(validateModelDraft(draft({ blocks: [{ topicId: "physics:electrostatics", minutes: 181, activity: "a" }] }), ctx())), ["over_time"]);
});

test("evidence: missing data row, missing memory, rule-only reasons cannot ground a plan", () => {
  assert.deepEqual(codes(validateModelDraft(draft({}, { kind: "data_row", id: "fixture:riya_topics#99" }), ctx())), ["missing_evidence"]);
  assert.deepEqual(codes(validateModelDraft(draft({}, { kind: "memory", id: "mem-404" }), ctx())), ["missing_evidence"]);
  assert.equal(validateModelDraft(draft({}, { kind: "memory", id: "mem-1" }), ctx()).ok, true);
  assert.deepEqual(codes(validateModelDraft(draft({}, { kind: "rule", id: "tough-love" }), ctx())), ["missing_evidence"]);
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
  const mem = await openStudentMemory(RIYA.studentId, { dataRoot: fictionalSandbox("hm-ms-") });
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


test('combined contract accepts complete compact plans and rejects simultaneous violations without output repair', async () => {
  const scoped = input({ memories: [] });
  const accepted = draft({ blocks: [90, 90].map(minutes => ({ topicId: ranked[0].topicId, minutes, activity: 'Practice' })) });
  const fake = model(accepted);
  const result = await createModelPlanner(fake, {}, { validate: true }).draft(scoped);
  assert.equal(result.comparison?.proposal.status, 'validated');
  assert.deepEqual(result.blocks, JSON.parse(accepted).blocks);
  assert.equal(fake.prompts.length, 1);
  const registry = fake.prompts[0][1].content.split('Exact typed reference registry')[1].split('\n')[1];
  assert.deepEqual(JSON.parse(registry), ranked.map(t => ({ kind: 'data_row', id: t.sourceRow })));
  const system = fake.prompts[0][0].content;
  const schema = JSON.parse(system.split('\n').find(line => line.startsWith('{'))!);
  assert.deepEqual(new Set(schema.required), new Set(['decision', 'blocks', 'message', 'reasons']));
  assert.equal(schema.properties.message.type, 'string');
  assert.equal(schema.properties.reasons.type, 'array');
  assert.equal(schema.properties.reasons.items.type, 'object');
  assert.deepEqual(new Set(schema.properties.reasons.items.properties.ref.properties.kind.enum), new Set(['memory', 'data_row', 'rule']));
  const exact = input({ ranked: [{ ...ranked[0], mastery: 0.8499 }] });
  assert.match(buildPlannerPrompt(exact), /mastery 0\.8499,/);
  for (const change of [{ message: {} }, { message: [] }, { reasons: 'data_row' }, { reasons: {} }]) {
    assert.deepEqual(codes(validateModelDraft(draft(change), ctx())), ['malformed']);
  }
  for (const kind of ['topic', 'source', 'quiz', 'ncert', 'data_row|memory', 'DATA_ROW']) {
    assert.deepEqual(codes(validateModelDraft(draft({}, { kind, id: ranked[0].sourceRow }), ctx())), ['malformed']);
  }
  for (const key of ['decision', 'blocks', 'message', 'reasons']) {
    const missing = JSON.parse(accepted); delete missing[key];
    assert.deepEqual(codes(validateModelDraft(JSON.stringify(missing), ctx())), ['malformed']);
  }
  const bad = draft({ blocks: [
    { topicId: 'unknown', minutes: 181, activity: 'Practice' },
    { topicId: ranked.find(t => t.mastery >= 0.85)!.topicId, minutes: 1, activity: 'Practice' },
    { topicId: ranked[0].topicId, minutes: 0, activity: 'Practice' },
  ] }, { kind: 'memory', id: ranked[0].sourceRow });
  const rejected = validateModelDraft(bad, ctx());
  assert.equal(rejected.ok, false);
  assert.deepEqual(new Set(codes(rejected)), new Set(['invalid_minutes', 'over_time', 'unknown_topic', 'checker_rejected', 'missing_evidence']));
  for (const change of [
    { blocks: [] }, { blocks: [{ topicId: ranked[1].topicId, minutes: 30, activity: 'Practice' }] },
    { message: 'You idiot' }, { reasons: [] },
  ]) assert.equal(validateModelDraft(draft(change), ctx()).ok, false);
  assert.equal(validateModelDraft(draft({ blocks: [] }), ctx({ hoursPerDay: 0 })).ok, false);
});
