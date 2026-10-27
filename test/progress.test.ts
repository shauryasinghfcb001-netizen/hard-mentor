import { fictionalSandbox } from "../src/consent/storageGate.ts";
// Quiz attempts persisted with answers, and the progress view that shows how the next recommendation moved.
// Offline: rule planner, local CSV in a temp dir, fictional students. fetch must never be called.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runProgress } from "../scripts/progress.ts";
import { converse, loadSession, type ConversationEnv, type StudentProfile } from "../src/agent/conversation.ts";
import { rulePlanner } from "../src/agent/planner.ts";
import { fixtureResearch } from "../src/context/fixtureExams.ts";
import type { TopicState } from "../src/core/priority.ts";
import { attemptsPathFor, readAttempts } from "../src/quiz/attempts.ts";
import { buildProgress, renderProgress } from "../src/quiz/progress.ts";
import { bm25Retriever, loadCorpus } from "../src/rag/ncert.ts";

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
  assert.equal(fetchCalls, 0);
});

const corpus = loadCorpus("corpus/ncert-phy12-ch1.json");
const RIYA: StudentProfile = { studentId: "riya", name: "Riya (fictional)", hoursPerDay: 3 };
const KABIR: StudentProfile = { studentId: "kabir", name: "Kabir (fictional)", hoursPerDay: 2 };
const INTAKE = ["hi", "12th boards", "India", "90% in PCM", "15 Feb 2027", "CBSE"];

function setup() {
  const root = fictionalSandbox("hm-prog-");
  const records = path.join(root, "study-records.csv");
  fs.copyFileSync("seed/study-records.csv", records);
  fs.appendFileSync(records, "kabir,physics:electrostatics,physics,Electrostatics,0.4,0.8\n");
  let t = Date.parse("2026-10-23T09:00:00Z");
  const clock = () => (t += 60_000);
  const env: ConversationEnv = {
    planner: rulePlanner,
    retriever: bm25Retriever(corpus),
    research: fixtureResearch,
    corpora: [corpus],
    records,
    quizLog: path.join(root, "quiz-log.csv"),
    sessionsDir: path.join(root, "sessions"),
    memoryFor: async () => null,
    now: () => new Date(clock()).toISOString(),
  };
  return { root, env, say: (m: string, who = RIYA) => converse(env, who, m) };
}

/** Takes one full quiz as `who`, wrong at the listed 1-based positions. */
async function takeQuiz(env: ConversationEnv, say: (m: string, who?: StudentProfile) => Promise<unknown>, who: StudentProfile, wrongAt: number[] = []) {
  await say("quiz me", who);
  const q = loadSession(env, who.studentId)!.activeQuiz!.quiz;
  const letters = q.items.map((it, i) => "ABCD"[wrongAt.includes(i + 1) ? it.options.findIndex((o) => o !== it.answer) : it.options.indexOf(it.answer)]);
  return say(letters.join(", "), who);
}

test("a scored quiz saves an attempt with topic, score, answers and date", async () => {
  const { env, say } = setup();
  for (const m of INTAKE) await say(m);
  await takeQuiz(env, say, RIYA, [2]);
  const [a] = readAttempts(attemptsPathFor(env.quizLog), "riya");
  assert.equal(a.topicId, "physics:electrostatics");
  assert.equal(a.correct, 4);
  assert.equal(a.total, 5);
  assert.equal(a.score, 0.8);
  assert.match(a.takenAt, /^2026-10-23T/);
  assert.equal(a.answers.length, 5);
  assert.deepEqual(a.answers.map((x) => x.ok), [true, false, true, true, true]);
  assert.ok(a.logRef.startsWith("csv:quiz-log.csv#"));
  assert.deepEqual(readAttempts(attemptsPathFor(env.quizLog), "kabir"), []);
});

test("an unfinished or cancelled quiz saves no attempt", async () => {
  const { env, say } = setup();
  for (const m of INTAKE) await say(m);
  await say("quiz me");
  await say("A, B");
  await say("cancel quiz");
  assert.equal(fs.existsSync(attemptsPathFor(env.quizLog)), false);
});

test("repeated perfect quizzes: the weak topic is replaced by the next one and the progress view says so", async () => {
  const { env, say } = setup();
  for (const m of INTAKE) await say(m);
  assert.equal((await say("Plan my study for today.")).state!.draft!.blocks[0].topicId, "physics:electrostatics");
  for (let i = 0; i < 3; i++) await takeQuiz(env, say, RIYA);
  const plan = await say("Plan my study for today.");
  assert.equal(plan.state!.draft!.blocks[0].topicId, "maths:integrals", "electrostatics no longer first");
  const r = await say("show my progress");
  assert.equal(r.handledBy, "intake");
  assert.match(r.reply, /3 saved quiz attempts/);
  assert.match(r.reply, /Electrostatics: 5\/5 \(100%\), mastery 0\.682 -> 0\.777; no misses/);
  assert.match(r.reply, /did not change which topic is first/, "the third quiz did not move the top topic");
  assert.match(r.reply, /mastery 0\.545 -> 0\.682; no misses \[[^\]]+\]\n    next topic after this quiz: Electrostatics -> Integrals/, "the second quiz did");
  assert.equal(r.reply.split("\n").filter((l) => l.startsWith("- ")).length, 3);
});

test("a poor quiz keeps the weak topic first and says the latest quiz did not change it", async () => {
  const { env, say } = setup();
  for (const m of INTAKE) await say(m);
  await takeQuiz(env, say, RIYA, [1, 2, 3, 4, 5]);
  const r = await say("my progress");
  assert.match(r.reply, /0\/5 \(0%\), mastery 0\.35 -> 0\.245; missed Q1, Q2, Q3, Q4, Q5/);
  assert.match(r.reply, /did not change which topic is first/);
});

test("progress is scoped to the student and writes nothing", async () => {
  const { env, say, root } = setup();
  for (const m of INTAKE) await say(m);
  for (const m of INTAKE) await say(m, KABIR);
  await takeQuiz(env, say, RIYA);
  const k = await say("progress", KABIR);
  assert.match(k.reply, /No quiz attempts saved for kabir/);
  const files = ["study-records.csv", "quiz-log.csv", "quiz-attempts.jsonl"].map((f) => fs.readFileSync(path.join(root, f), "utf-8"));
  await say("my progress");
  await say("progress", KABIR);
  assert.deepEqual(["study-records.csv", "quiz-log.csv", "quiz-attempts.jsonl"].map((f) => fs.readFileSync(path.join(root, f), "utf-8")), files);
});

test("an open quiz survives a progress request", async () => {
  const { env, say } = setup();
  for (const m of INTAKE) await say(m);
  await say("quiz me");
  const r = await say("my progress");
  assert.match(r.reply, /No quiz attempts saved/);
  assert.ok(loadSession(env, "riya")!.activeQuiz, "quiz still open");
});

test("buildProgress: a mastered topic stops being recommended; attempts without saved answers still list", () => {
  const dir = fictionalSandbox("hm-prog-unit-");
  const quizLog = path.join(dir, "quiz-log.csv");
  fs.writeFileSync(
    quizLog,
    "quiz_id,student_id,topic_id,taken_at,correct,total,score,mastery_before,mastery_after,sources\nq1,s,t:a,2026-10-01T09:00:00Z,5,5,1.000,0.8,0.86,ncert:x\n"
  );
  const t = (id: string, mastery: number, w: number): TopicState => ({ topicId: id, subject: "s", name: id, mastery, marksWeight: w, sourceRow: `row:${id}` });
  const p = buildProgress({ studentId: "s", topics: [t("t:a", 0.86, 0.9), t("t:b", 0.5, 0.2)], daysToExam: 50, quizLog });
  assert.equal(p.before!.topicId, "t:a");
  assert.equal(p.now!.topicId, "t:b");
  assert.deepEqual(p.mastered, ["t:a"]);
  assert.equal(p.attempts[0].answers, null);
  assert.match(renderProgress(p), /no per-question answers saved/);
});

test("scripts/progress.ts prints the view for a data root and rejects bad input", async () => {
  const { env, say, root } = setup();
  for (const m of INTAKE) await say(m);
  await takeQuiz(env, say, RIYA, [3]);
  const out: string[] = [];
  await runProgress([root, "riya", "--days", "100"], (s) => out.push(s));
  assert.match(out.join("\n"), /Progress for riya: 1 saved quiz attempt/);
  await assert.rejects(runProgress([], () => {}), /usage:/);
  await assert.rejects(runProgress([root, "nobody"], () => {}), /no study records for nobody/);
});
