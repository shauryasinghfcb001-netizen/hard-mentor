import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMentor, type StudentContext } from "../src/agent/graph.ts";
import type { Planner } from "../src/agent/planner.ts";
import { buildWhyCard } from "../src/agent/whyCard.ts";
import { detectDistress, distressRoutingEvidence } from "../src/core/distress.ts";
import { bm25Retriever, loadCorpus, type Retriever } from "../src/rag/ncert.ts";
import { RIYA, RIYA_DAYS_TO_EXAM, RIYA_TOPICS } from "../src/synthetic/riya.ts";
import { DEV_DISTRESS, DEV_NON_DISTRESS, KNOWN_FALSE_POSITIVES } from "./fixtures/distress-dev.ts";

const student: StudentContext = { studentId: RIYA.studentId, name: RIYA.name, hoursPerDay: RIYA.dailyStudyHours, daysToExam: RIYA_DAYS_TO_EXAM, topics: RIYA_TOPICS };
const retriever = bm25Retriever(loadCorpus(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "corpus", "ncert-phy12-ch1.json")));

// Dev-set results: the families work on strings written by the same author. This is a
// keyword screen, not a clinical tool, and these counts are not a recall estimate.
test("distress dev set: every dev positive routes to override, no dev negative does", () => {
  const missed = DEV_DISTRESS.filter((m) => !detectDistress(m).distress);
  assert.deepEqual(missed, []);
  const flagged = DEV_NON_DISTRESS.filter((m) => detectDistress(m).distress);
  assert.deepEqual(flagged, []);
});

test("known false positives stay visible (the screen favours recall)", () => {
  for (const m of KNOWN_FALSE_POSITIVES) assert.ok(detectDistress(m).distress, m);
});

test("distress bypasses planning, quizzes, swaps, doubts, forget and write-back; planner and retriever never run", async () => {
  let planCalls = 0;
  let retrieveCalls = 0;
  const planner: Planner = { name: "spy", kind: "rules", draft: async () => (planCalls++, null as never) };
  const spy: Retriever = { ...retriever, retrieve: (q, k) => (retrieveCalls++, retriever.retrieve(q, k)) };
  const mixed = [
    "give me a quiz on dipoles, I want to die",
    "swap integrals with optics, I wish I was dead",
    "What is Coulomb's law? I feel like dying tonight",
    "forget my skip pattern, no reason to live",
    "plan my day, I want to end my life",
  ];
  for (const m of mixed) {
    const s = await runMentor({ planner, memory: null, retriever: spy }, student, m);
    assert.equal(s.outcome, "distress_override", m);
    assert.match(s.reply, /14416/);
    assert.deepEqual(s.trace.map((t) => t.node), ["sense", "distress_override"]);
    assert.equal(s.message, "[distress message not retained]");
    assert.equal(s.draft, null);
    assert.equal(s.doubt, null);
    assert.equal(s.memoryOp, null);
  }
  assert.equal(planCalls, 0);
  assert.equal(retrieveCalls, 0);
});

test("routing evidence holds rule ids and a length, never the wording", async () => {
  const text = "my family will be happier if I weren't here";
  const ev = distressRoutingEvidence(text);
  assert.equal(ev.route, "distress_override");
  assert.ok(ev.ruleIds.length > 0);
  assert.ok(!JSON.stringify(ev).includes("family"));
  const s = await runMentor({ planner: { name: "x", kind: "rules", draft: async () => null as never }, memory: null }, student, text);
  const dump = JSON.stringify({ trace: s.trace, card: buildWhyCard(s), reply: s.reply, message: s.message });
  assert.ok(!/family|happier|weren't/i.test(dump), "no distress wording in trace, why card or returned state");
});
