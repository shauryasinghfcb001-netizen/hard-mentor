// Baseline-vs-model comparison in the real conversation output (converse -> graph -> why card).
// Offline and mocked: the model is a scripted stub and fetch fails the test if it is ever called.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { converse, type ConversationEnv, type StudentProfile } from "../src/agent/conversation.ts";
import { createModelPlanner } from "../src/agent/modelPlanner.ts";
import { rulePlanner, type Planner } from "../src/agent/planner.ts";
import { renderWhyCard } from "../src/agent/whyCard.ts";
import { fixtureResearch } from "../src/context/fixtureExams.ts";
import type { ChatMessage, ChatModel } from "../src/llm/client.ts";
import { bm25Retriever, loadCorpus } from "../src/rag/ncert.ts";

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
const ASK = "Plan my study for today.";

type Reply = (prompt: string) => string | Error;

function stubModel(reply: Reply): ChatModel {
  return {
    provider: "fake",
    model: "stub",
    async chat(messages: ChatMessage[]) {
      const r = reply(messages[messages.length - 1].content);
      if (r instanceof Error) throw r;
      return { text: r, model: "stub", provider: "fake", latencyMs: 1, attempts: 1 };
    },
  };
}

async function run(planner: Planner) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hm-cmp-"));
  const records = path.join(root, "study-records.csv");
  fs.copyFileSync("seed/study-records.csv", records);
  let t = Date.parse("2026-10-23T09:00:00Z");
  const env: ConversationEnv = {
    planner,
    retriever: bm25Retriever(corpus),
    research: fixtureResearch,
    corpora: [corpus],
    records,
    quizLog: path.join(root, "quiz-log.csv"),
    sessionsDir: path.join(root, "sessions"),
    async memoryFor() {
      return null;
    },
    now: () => new Date((t += 60_000)).toISOString(),
  };
  for (const m of INTAKE) await converse(env, RIYA, m);
  const r = await converse(env, RIYA, ASK);
  return { r, card: renderWhyCard(r.why!) };
}

const offered = (prompt: string) => ({
  topic: prompt.match(/^- (\S+) ".*?".*\[data_row (\S+?)\]$/m)!.slice(1),
  budget: Number(prompt.match(/Daily budget: (\d+) minutes/)![1]),
});
const plan = (prompt: string, over: Record<string, unknown> = {}) => {
  const o = offered(prompt);
  return JSON.stringify({
    decision: "daily_plan",
    blocks: [{ topicId: o.topic[0], minutes: 45, activity: "NCERT" }],
    message: "MODEL-PLAN: top topic first.",
    reasons: [{ text: "top priority", ref: { kind: "data_row", id: o.topic[1] } }],
    ...over,
  });
};

const validating = (reply: Reply) => createModelPlanner(stubModel(reply), {}, { validate: true });

// The baseline line the rule planner produces for Riya in this fixture, taken from the rule-planner run itself.
async function baselineLine() {
  const { r } = await run(rulePlanner);
  const d = r.state!.draft!;
  return `  Rule baseline: ${d.decision}: ${d.blocks.map((b) => `${b.topicId} ${b.minutes}min`).join(", ")}`;
}

// Captured from the rule-planner run through converse before this feature was wired; the rule path is unchanged.
const GOLDEN_REPLY = "Today: Electrostatics first for 90 min, then Integrals and Organic Chemistry.";
const GOLDEN_CARD = [
  "Decision: daily_plan (sent)",
  "Why:",
  "  - Electrostatics is your top priority: mastery 0.35, marks weight 0.8, priority 0.656  [data_row: csv:study-records.csv#2]",
  "Loop:",
  "  1. [sense] intent plan (rules: schedule wording)",
  "  2. [recall] exam context: CBSE Class 12 board exam (student choice, 3 candidates); 0/2 facts verified; exam date 2027-02-15 (student-stated); research by fixture-exams-2026-10-23 (mock, not web) at 2026-10-23T09:03:00.000Z",
  "  3. [recall] ranked 4 topics by (1-mastery)*marks_weight*urgency; top physics:electrostatics",
  "  4. [recall] memory OFF: H-MEM not queried",
  "  5. [draft_plan] attempt 1 by rule-planner-v1 (rules): decision daily_plan",
  "  6. [check_plan] attempt 1 passed all rules",
  "  7. [respond] sent decision daily_plan",
  "  8. [write_back] memory OFF: no write-back",
  "SQL: (not available: Zetaris federation not wired yet)",
].join("\n");

test("default (rule planner): reply and why card are byte-identical to the golden, no comparison", async () => {
  const { r, card } = await run(rulePlanner);
  assert.equal(r.reply, GOLDEN_REPLY);
  assert.equal(card, GOLDEN_CARD);
  assert.ok(!("comparison" in r.why!));
  assert.ok(!("comparison" in r.state!.draft!));
});

test("default (rule planner) output is deterministic: two runs give byte-identical reply and card", async () => {
  const a = await run(rulePlanner);
  const b = await run(rulePlanner);
  assert.equal(a.r.reply, b.r.reply);
  assert.equal(a.card, b.card);
});

test("lenient createModelPlanner (validate off) shows no comparison, even after a parse failure", async () => {
  const ok = await run(createModelPlanner(stubModel((p) => plan(p))));
  assert.ok(!ok.card.includes("Plan comparison"));
  const bad = await run(createModelPlanner(stubModel(() => "not json")));
  assert.ok(!bad.card.includes("Plan comparison"));
  assert.ok(!("comparison" in bad.r.state!.draft!));
  assert.match(bad.r.state!.draft!.producedBy ?? "", /model failed/);
});

test("validated: model proposal shown beside the baseline, marked as the plan sent", async () => {
  const { r, card } = await run(validating((p) => plan(p)));
  const base = await baselineLine();
  assert.equal(r.reply, "MODEL-PLAN: top topic first.");
  assert.ok(card.includes("Plan comparison:\n" + base + "\n"));
  assert.match(card, /  Model proposal: validated: daily_plan: \S+ 45min\n/);
  assert.ok(card.includes("  Plan sent: the model's validated proposal"));
  assert.equal(r.why!.comparison!.proposal.status, "validated");
  assert.ok(card.indexOf("Plan comparison:") < card.indexOf("Loop:"));
});

test("rejected: baseline is the plan, reason codes shown, raw model text never shown", async () => {
  const raw = "I think Riya should rest and eat biryani.";
  const { r, card } = await run(validating(() => raw));
  assert.match(r.reply, /^Today: /);
  assert.ok(card.includes("  Model proposal: rejected (malformed); not used, not shown as a plan"));
  assert.ok(card.includes("  Plan sent: the rule baseline"));
  assert.ok(!card.includes("biryani") && !r.reply.includes("biryani"));
  assert.ok(!card.includes("validated proposal"));
  assert.equal(r.why!.comparison!.proposal.status, "rejected");
  assert.equal(r.why!.comparison!.proposal.blocks, undefined, "a rejected draft carries no blocks");
});

test("rejected for a rule violation lists its code; its blocks are not displayed", async () => {
  const { card } = await run(validating((p) => plan(p, { blocks: [{ topicId: "bio:cells", minutes: 30, activity: "a" }] })));
  assert.ok(card.includes("  Model proposal: rejected (unknown_topic); not used, not shown as a plan"));
  assert.ok(!card.includes("bio:cells 30min"));
  assert.ok(card.includes("  Plan sent: the rule baseline"));
});

test("model error: baseline is the plan, labelled model error, not model success", async () => {
  const { r, card } = await run(validating(() => new Error("nvidia HTTP 503: busy")));
  assert.match(r.reply, /^Today: /);
  assert.ok(card.includes("  Model proposal: model error (model_error: nvidia HTTP 503: busy); no proposal"));
  assert.ok(card.includes("  Plan sent: the rule baseline"));
  assert.ok(!card.includes("validated"));
});

test("a comparison never claims a live model", async () => {
  for (const reply of [(p: string) => plan(p), () => "nope", () => new Error("x")] as Reply[]) {
    const { card } = await run(validating(reply));
    assert.ok(!/\blive\b/i.test(card.split("Loop:")[0].split("Plan comparison:")[1] ?? ""));
  }
});
