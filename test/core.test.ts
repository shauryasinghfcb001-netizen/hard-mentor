import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPlan, type DraftPlan, type RuleId } from "../src/core/checker.ts";
import { detectDistress, distressReply } from "../src/core/distress.ts";
import { initialMastery, priority, rankTopics, updateMastery, urgency } from "../src/core/priority.ts";
import { RIYA, RIYA_DAYS_TO_EXAM, RIYA_TOPICS } from "../src/synthetic/riya.ts";
import { DISTRESS_MESSAGES, NON_DISTRESS_MESSAGES } from "./fixtures/distress-set.ts";

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("priority formula matches blueprint", () => {
  close(urgency(30), 2);
  close(urgency(0), 31); // max(days, 1)
  close(priority(0.35, 0.8, 30), 0.65 * 0.8 * 2);
  close(priority(1, 0.8, 30), 0);
});

test("mastery update is 0.7m + 0.3score, initial 0.5 when uncovered", () => {
  close(updateMastery(0.5, 1), 0.65);
  close(updateMastery(0.35, 0), 0.245);
  close(initialMastery(), 0.5);
  close(initialMastery(0.7), 0.7);
  close(updateMastery(1.2, 2), 1); // clamped
});

test("Riya ranking puts Electrostatics first and Optics (mastered) last", () => {
  const ranked = rankTopics(RIYA_TOPICS, RIYA_DAYS_TO_EXAM);
  assert.deepEqual(
    ranked.map((t) => t.topicId),
    ["physics:electrostatics", "maths:integrals", "chemistry:organic", "physics:optics"]
  );
});

test("distress recall is 100% on 20 messages; no false positive on 8 study messages", () => {
  assert.equal(DISTRESS_MESSAGES.length, 20);
  const missed = DISTRESS_MESSAGES.filter((m) => !detectDistress(m).distress);
  assert.deepEqual(missed, []);
  const flagged = NON_DISTRESS_MESSAGES.filter((m) => detectDistress(m).distress);
  assert.deepEqual(flagged, []);
  assert.match(distressReply("Riya"), /14416/);
  assert.doesNotMatch(distressReply("Riya"), /no swap|skipp/i);
});

const ranked = rankTopics(RIYA_TOPICS, RIYA_DAYS_TO_EXAM);
const ctx = { hoursPerDay: RIYA.dailyStudyHours, ranked };
const good: DraftPlan = {
  blocks: [
    { topicId: "physics:electrostatics", minutes: 90, activity: "NCERT examples" },
    { topicId: "maths:integrals", minutes: 90, activity: "practice" },
  ],
  message: "Electrostatics first, then Integrals.",
  evidence: ["fixture:riya_topics#1"],
};
const mutate = (f: (p: DraftPlan) => void): DraftPlan => {
  const p = structuredClone(good);
  f(p);
  return p;
};

test("checker accepts a valid plan", () => {
  assert.deepEqual(checkPlan(good, ctx), { ok: true, failures: [] });
});

test("checker catches 15 injected bad plans", () => {
  const bad: [string, RuleId, DraftPlan][] = [
    ["empty plan", "non_empty", mutate((p) => (p.blocks = []))],
    ["zero minutes", "positive_minutes", mutate((p) => (p.blocks[1].minutes = 0))],
    ["negative minutes", "positive_minutes", mutate((p) => (p.blocks[1].minutes = -30))],
    ["4h on 3h budget", "hours_fit", mutate((p) => (p.blocks[1].minutes = 150))],
    ["extra block overflows", "hours_fit", mutate((p) => p.blocks.push({ topicId: "chemistry:organic", minutes: 60, activity: "x" }))],
    ["swap Electrostatics for Organic", "covers_top_priority", mutate((p) => (p.blocks[0].topicId = "chemistry:organic"))],
    ["drops top priority", "covers_top_priority", mutate((p) => p.blocks.shift())],
    ["repeats mastered Optics", "no_mastered_repeat", mutate((p) => (p.blocks[1].topicId = "physics:optics"))],
    ["unknown topic", "known_topics", mutate((p) => (p.blocks[1].topicId = "biology:genetics"))],
    ["no evidence", "uses_student_data", mutate((p) => (p.evidence = []))],
    ["insult: lazy", "tone", mutate((p) => (p.message = "Stop being lazy."))],
    ["insult: stupid", "tone", mutate((p) => (p.message = "Only a stupid student skips this."))],
    ["insult: useless", "tone", mutate((p) => (p.message = "You are useless at physics."))],
    ["insult: loser", "tone", mutate((p) => (p.message = "Don't be a loser."))],
    ["NaN minutes", "positive_minutes", mutate((p) => (p.blocks[1].minutes = Number.NaN))],
  ];
  assert.equal(bad.length, 15);
  const missed = bad.filter(([, rule, plan]) => !checkPlan(plan, ctx).failures.some((f) => f.rule === rule)).map(([n]) => n);
  assert.deepEqual(missed, [], `missed: ${missed.join(", ")}`);
});
