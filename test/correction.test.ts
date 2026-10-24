import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { converse, detectCorrection, loadSession, type ConversationEnv, type StudentProfile } from "../src/agent/conversation.ts";
import { rulePlanner } from "../src/agent/planner.ts";
import { fixtureResearch } from "../src/context/fixtureExams.ts";
import { bm25Retriever, loadCorpus } from "../src/rag/ncert.ts";

const corpus = loadCorpus("corpus/ncert-phy12-ch1.json");
const RIYA: StudentProfile = { studentId: "riya", name: "Riya (fictional)", hoursPerDay: 3 };
const KABIR: StudentProfile = { studentId: "kabir", name: "Kabir (fictional)", hoursPerDay: 2 };
const INTAKE = ["hi", "12th boards", "India", "90% in PCM", "15 Feb 2027", "CBSE"];

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hm-corr-"));
  const records = path.join(root, "study-records.csv");
  fs.copyFileSync("seed/study-records.csv", records);
  let t = Date.parse("2026-10-23T09:00:00Z");
  const env: ConversationEnv = {
    planner: rulePlanner,
    retriever: bm25Retriever(corpus),
    research: fixtureResearch,
    corpora: [corpus],
    records,
    quizLog: path.join(root, "quiz-log.csv"),
    sessionsDir: path.join(root, "sessions"),
    memoryFor: async () => null,
    now: () => new Date((t += 60_000)).toISOString(),
  };
  const say = (m: string, who = RIYA) => converse(env, who, m);
  return { env, say, records };
}

async function onboard(say: (m: string, who?: StudentProfile) => Promise<unknown>, who = RIYA) {
  for (const m of INTAKE) await say(m, who);
}

test("date correction: urgency rises, plan says why, records and other students untouched", async () => {
  const { env, say, records } = setup();
  await onboard(say);
  await onboard(say, KABIR);
  await say("Plan my study for today.");
  const csvBefore = fs.readFileSync(records, "utf-8");
  const kabirBefore = fs.readFileSync(path.join(env.sessionsDir, "kabir.json"), "utf-8");
  const r = await say("Actually my exam date is 2026-12-24");
  assert.equal(loadSession(env, "riya")!.exam!.examDate!.value, "2026-12-24");
  assert.equal(loadSession(env, "riya")!.exam!.examDate!.origin, "student-stated");
  assert.match(r.reply, /Updated your exam date to 2026-12-24/);
  assert.match(r.reply, /days to exam 115 -> 62/);
  assert.match(r.reply, /Mastery and quiz results are unchanged/);
  assert.match(r.reply, /Top topic unchanged/);
  assert.ok(r.state!.draft, "a new plan came back");
  assert.equal(fs.readFileSync(records, "utf-8"), csvBefore, "study records untouched");
  assert.equal(fs.readFileSync(path.join(env.sessionsDir, "kabir.json"), "utf-8"), kabirBefore, "other student untouched");
});

test("invalid, past, same and unreadable dates are refused and change nothing", async () => {
  const { env, say } = setup();
  await onboard(say);
  for (const bad of ["Correction: exam date is 2026-02-30", "the exam date changed to 2026-10-01", "exam date changed to next spring", "Actually the exam date is 2027-02-15"]) {
    const r = await say(bad);
    assert.equal(loadSession(env, "riya")!.exam!.examDate!.value, "2027-02-15", bad);
    assert.equal(r.state, null, `${bad}: no plan on a refused correction`);
  }
});

test("distress during a correction gets the support reply and changes nothing", async () => {
  const { env, say } = setup();
  await onboard(say);
  const r = await say("Actually the exam date is 2026-12-24 and I want to end my life");
  assert.equal(r.state!.intent, "distress");
  assert.equal(loadSession(env, "riya")!.exam!.examDate!.value, "2027-02-15");
  assert.equal(r.state!.draft, null);
});

test("goal correction changes the goal only", async () => {
  const { env, say } = setup();
  await onboard(say);
  const r = await say("Change my goal to 95% in PCM");
  assert.equal(loadSession(env, "riya")!.exam!.goal.goal, "95% in PCM");
  assert.match(r.reply, /does not use the goal/);
});

test("exam change keeps saved results, says old notes no longer apply, refuses with a quiz open", async () => {
  const { env, say, records } = setup();
  await onboard(say);
  const csvBefore = fs.readFileSync(records, "utf-8");
  await say("quiz me");
  const blocked = await say("Please change my exam to ISC board");
  assert.match(blocked.reply, /quiz open/);
  assert.equal(loadSession(env, "riya")!.exam!.exam.id, "in-cbse-12", "exam unchanged while quiz open");
  assert.ok(loadSession(env, "riya")!.activeQuiz, "quiz still open");
  await say("cancel the quiz");
  const r = await say("Please change my exam to ISC board");
  const s = loadSession(env, "riya")!;
  assert.equal(s.exam!.exam.id, "in-isc-12");
  assert.match(r.reply, /ncert-phy12-ch1\) do not apply to ISC/);
  assert.match(r.reply, /NOT relabeled/);
  assert.match(r.reply, /unverified/);
  assert.equal(fs.readFileSync(records, "utf-8"), csvBefore, "saved results never rewritten");
});

test("ordinary messages are not read as corrections", () => {
  for (const m of ["A, B, C", "plan my study for today", "what is Coulomb's law", "I changed my mind about the quiz", "the exam is hard"]) assert.equal(detectCorrection(m), null, m);
});
