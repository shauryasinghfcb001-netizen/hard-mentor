import { fictionalSandbox } from "../src/consent/storageGate.ts";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { converse, loadSession, parseDate, type ConversationEnv, type StudentProfile } from "../src/agent/conversation.ts";
import { classifyIntent } from "../src/agent/graph.ts";
import { rulePlanner } from "../src/agent/planner.ts";
import { fixtureResearch } from "../src/context/fixtureExams.ts";
import { readQuizLog, recordQuizResult } from "../src/data/studyData.ts";
import { listMemories, openStudentMemory, type StudentMemory } from "../src/memory/studentMemory.ts";
import { parseAnswers } from "../src/quiz/quizTurn.ts";
import { bm25Retriever, loadCorpus } from "../src/rag/ncert.ts";

const corpus = loadCorpus("corpus/ncert-phy12-ch1.json");
const RIYA: StudentProfile = { studentId: "riya", name: "Riya (fictional)", hoursPerDay: 3 };
const KABIR: StudentProfile = { studentId: "kabir", name: "Kabir (fictional)", hoursPerDay: 2 };
const INTAKE = ["hi", "12th boards", "India", "90% in PCM", "15 Feb 2027", "CBSE"];

function setup(opts: { memory?: boolean; kabirElectrostatics?: boolean } = {}) {
  const root = fictionalSandbox("hm-conv-");
  const records = path.join(root, "study-records.csv");
  fs.copyFileSync("seed/study-records.csv", records);
  if (opts.kabirElectrostatics) fs.appendFileSync(records, "kabir,physics:electrostatics,physics,Electrostatics,0.4,0.8\n");
  let t = Date.parse("2026-10-23T09:00:00Z");
  const clock = () => (t += 60_000);
  const mems = new Map<string, StudentMemory>();
  const env: ConversationEnv = {
    planner: rulePlanner,
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
  const mastery = (sid: string) => Number(fs.readFileSync(records, "utf-8").split("\n").find((l) => l.startsWith(`${sid},physics:electrostatics,`))!.split(",")[4]);
  return { env, say, records, mastery, mems };
}

async function intake(say: (m: string, who?: StudentProfile) => Promise<unknown>, who = RIYA) {
  for (const m of INTAKE) await say(m, who);
}

/** Correct option letters for the open quiz, except at the listed 1-based positions. */
function letters(env: ConversationEnv, sid: string, wrongAt: number[] = []): string[] {
  const q = loadSession(env, sid)!.activeQuiz!.quiz;
  return q.items.map((it, i) => "ABCD"[wrongAt.includes(i + 1) ? it.options.findIndex((o) => o !== it.answer) : it.options.indexOf(it.answer)]);
}

test("intake -> quiz me -> answers over several messages -> score, saved progress, memory, next plan cites the quiz", async () => {
  const { env, say, mastery, mems } = setup({ memory: true });
  await intake(say);
  const s = loadSession(env, "riya")!;
  assert.equal(s.stage, "ready");
  assert.ok(s.exam!.facts.every((f) => f.status === "unverified"), "mock facts stay unverified");
  assert.deepEqual(s.exam!.examDate, { value: "2027-02-15", origin: "student-stated" });

  const plan1 = await say("Plan my study for today.");
  assert.equal(plan1.state!.draft!.blocks[0].topicId, "physics:electrostatics");

  const start = await say("quiz me");
  assert.equal(start.state!.quizTurn!.kind, "started");
  assert.match(start.reply, /\[from NCERT Physics Part I, Class 12, Ch 1, §/);
  assert.match(start.reply, /recall of the notes' wording, not problem solving/);

  const a = letters(env, "riya", [3]);
  const part = await say(`${a[0]}, ${a[1]}`);
  assert.equal(part.state!.quizTurn!.kind, "progress");
  const stray = await say("Can I do this later?");
  assert.equal(stray.state!.quizTurn!.kind, "progress", "a non-answer leaves the quiz open");
  assert.equal(loadSession(env, "riya")!.activeQuiz!.answers.filter((x) => x !== null).length, 2);
  assert.equal(mastery("riya"), 0.35, "nothing saved before completion");
  assert.ok(!fs.existsSync(env.quizLog));

  const done = await say(`Q3: ${a[2]}, Q4: ${a[3]}, Q5: ${a[4]}`);
  assert.equal(done.state!.quizTurn!.kind, "scored");
  assert.match(done.reply, /: 4\/5\./);
  assert.match(done.reply, /Q3 wrong: .* The note says: ".+" \[NCERT/);
  assert.equal(mastery("riya"), 0.485);
  assert.equal(readQuizLog(env.quizLog).length, 1);
  assert.ok(listMemories(mems.get("riya")!).some((m) => m.tags.includes("quiz") && /4\/5/.test(m.content)));
  assert.equal(loadSession(env, "riya")!.activeQuiz, null);

  // The same completion message again is not counted.
  const again = await say(`Q3: ${a[2]}, Q4: ${a[3]}, Q5: ${a[4]}`);
  assert.equal(again.state!.quizTurn!.kind, "already_scored");
  assert.equal(readQuizLog(env.quizLog).length, 1);
  assert.equal(mastery("riya"), 0.485);

  const plan2 = await say("Plan my study for today.");
  const why = plan2.why!.reasons.find((r) => r.ref.kind === "quiz");
  assert.equal(why?.ref.id, "csv:quiz-log.csv#2");
  assert.match(plan2.reply, /Electrostatics mastery 0\.35 -> 0\.485 after quiz .*priority 0\.656 -> 0\.519/);
  assert.match(plan2.reply, /Top topic unchanged/);
});

test("cancelling an open quiz saves no score; a retake later is scored once", async () => {
  const { env, say, mastery } = setup();
  await intake(say);
  await say("quiz me");
  await say(letters(env, "riya").slice(0, 2).join(", "));
  const c = await say("cancel quiz");
  assert.equal(c.state!.quizTurn!.kind, "cancelled");
  assert.match(c.reply, /No score was saved/);
  assert.equal(mastery("riya"), 0.35);
  assert.ok(!fs.existsSync(env.quizLog));
  const none = await say("cancel quiz");
  assert.equal(none.state!.quizTurn!.kind, "no_open_quiz");
  await say("quiz me");
  const r = await say(letters(env, "riya").join(" "));
  assert.equal(r.state!.quizTurn!.kind, "scored");
  assert.equal(mastery("riya"), 0.545);
});

test("each student's open quiz is separate", async () => {
  const { env, say, mastery } = setup({ kabirElectrostatics: true });
  await intake(say, RIYA);
  await intake(say, KABIR);
  await say("quiz me", RIYA);
  await say("quiz me", KABIR);
  const kabirLetters = letters(env, "kabir");
  await say(letters(env, "riya").slice(0, 3).join(", "), RIYA);
  // Kabir answers all five: only Kabir's record changes, Riya's quiz stays at 3/5.
  const k = await say(kabirLetters.join(", "), KABIR);
  assert.equal(k.state!.quizTurn!.kind, "scored");
  assert.equal(mastery("kabir"), 0.58);
  assert.equal(mastery("riya"), 0.35);
  assert.equal(loadSession(env, "riya")!.activeQuiz!.answers.filter((x) => x !== null).length, 3);
  assert.deepEqual(readQuizLog(env.quizLog).map((r) => r.studentId), ["kabir"]);
});

test("distress during a quiz or during intake overrides everything and writes nothing", async () => {
  const { env, say, mastery } = setup();
  const first = await say("hi");
  assert.equal(first.handledBy, "intake");
  const d0 = await say("I want to die");
  assert.equal(d0.state!.outcome, "distress_override");
  assert.equal(loadSession(env, "riya")!.intake.step, "exam", "intake does not advance");
  assert.equal(JSON.stringify(loadSession(env, "riya")).includes("die"), false, "message not kept in the session");
  for (const m of INTAKE.slice(1)) await say(m);
  await say("quiz me");
  await say("A, B");
  const d = await say("C, I want to die");
  assert.equal(d.state!.outcome, "distress_override");
  assert.match(d.reply, /14416/);
  assert.equal(loadSession(env, "riya")!.activeQuiz, null, "open quiz closed without a score");
  assert.equal(mastery("riya"), 0.35);
  assert.ok(!fs.existsSync(env.quizLog));
});

test("distress never initializes memory or writes session files, even with invalid study configuration", async () => {
  const { env } = setup({ memory: true });
  env.memoryFor = async () => { throw new Error("distress must not open student persistence"); };
  const before = fs.readdirSync(path.dirname(env.records));
  const prior = process.env.HM_STUDY_SOURCE;
  process.env.HM_STUDY_SOURCE = "invalid-for-test";
  try {
    const result = await converse(env, RIYA, "I want to die");
    assert.equal(result.state?.outcome, "distress_override");
    assert.equal(fs.existsSync(env.sessionsDir), false);
    assert.deepEqual(fs.readdirSync(path.dirname(env.records)), before);
  } finally {
    if (prior === undefined) delete process.env.HM_STUDY_SOURCE;
    else process.env.HM_STUDY_SOURCE = prior;
  }
});

test("distress leaves every existing file unchanged; an interrupted quiz cannot score on the next turn", async () => {
  const { env, say, records } = setup({ memory: true });
  await intake(say);
  await say("quiz me");
  const answers = letters(env, "riya").join(", ");
  const snapshot = (dir: string): Record<string, string> => Object.fromEntries(fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? Object.entries(snapshot(full)) : [[full, `${fs.statSync(full).mtimeMs}:${createHash("sha256").update(fs.readFileSync(full)).digest("hex")}`]];
  }));
  const before = snapshot(path.dirname(records));
  const result = await say("I want to die");
  assert.equal(result.state?.outcome, "distress_override");
  assert.deepEqual(snapshot(path.dirname(records)), before);
  assert.equal(loadSession(env, "riya")!.activeQuiz, null, "quiz closes in memory without a distress write");
  const again = await say(answers);
  assert.equal(again.state?.quizTurn?.kind, "no_open_quiz");
  assert.ok(!fs.existsSync(env.quizLog));
});

test("an interrupted quiz overlay does not close another fictional student's quiz", async () => {
  const { env, say } = setup({ kabirElectrostatics: true });
  await intake(say, RIYA);
  await intake(say, KABIR);
  await say("quiz me", RIYA);
  await say("quiz me", KABIR);
  const kabirAnswers = letters(env, "kabir").join(", ");
  await say("I want to die", RIYA);
  assert.equal(loadSession(env, "riya")!.activeQuiz, null);
  assert.ok(loadSession(env, "kabir")!.activeQuiz);
  const result = await say(kabirAnswers, KABIR);
  assert.equal(result.state?.quizTurn?.kind, "scored");
  assert.deepEqual(readQuizLog(env.quizLog).map(r => r.studentId), ["kabir"]);
});

test("broken saved session data cannot block the distress response or trigger repair writes", async () => {
  const { env } = setup();
  fs.mkdirSync(env.sessionsDir);
  const file = path.join(env.sessionsDir, "riya.json");
  fs.writeFileSync(file, "{not valid JSON");
  env.memoryFor = async () => { throw new Error("must not initialize storage"); };
  const result = await converse(env, RIYA, "I want to die");
  assert.equal(result.state?.outcome, "distress_override");
  assert.equal(fs.readFileSync(file, "utf8"), "{not valid JSON");
});

test("routing, answer parsing, dates and the duplicate guard", () => {
  assert.equal(classifyIntent("quiz me").intent, "quiz_start");
  assert.equal(classifyIntent("Give me a quiz on dipoles, I want to die").intent, "distress");
  assert.equal(classifyIntent("plan my day", null, true).intent, "quiz_answer");
  assert.equal(classifyIntent("cancel the quiz", null, true).intent, "quiz_cancel");
  assert.equal(classifyIntent("What do you remember about me?", null, true).intent, "memory_list");
  assert.equal(classifyIntent("B, A, D").intent, "quiz_answer");
  assert.equal(classifyIntent("What is a test charge?").intent, "doubt");

  const quiz = { id: "q", topicId: "t", corpus: "c", createdAt: "x", items: ["a", "b", "c"].map((w, i) => ({ id: `q#${i + 1}`, chunkId: "n", citation: "c", prompt: "_____", options: ["alpha", "beta", "gamma", "delta"], answer: w })) };
  const p = parseAnswers("Q2: gamma, b, pass, Q9: a, zeta", { quiz, answers: [null, null, null] });
  assert.deepEqual(p.answers, ["beta", "gamma", "(no answer)"]);
  assert.equal(p.rejected.length, 2);

  assert.equal(parseDate("15 Feb 2027"), "2027-02-15");
  assert.equal(parseDate("February 15, 2027"), "2027-02-15");
  assert.equal(parseDate("2027-02-30"), null);
  assert.equal(parseDate("soon"), null);

  const dir = fictionalSandbox("hm-dup-");
  const rec = path.join(dir, "r.csv");
  fs.copyFileSync("seed/study-records.csv", rec);
  const row = { studentId: "riya", quizId: "quiz-x", topicId: "physics:electrostatics", takenAt: "2026-10-23T10:00:00Z", correct: 5, total: 5, sources: [] };
  recordQuizResult(rec, path.join(dir, "log.csv"), row);
  assert.throws(() => recordQuizResult(rec, path.join(dir, "log.csv"), row), /already recorded/);
});

test('free-text why explains the saved plan without a planner call or NCERT refusal', async () => {
  const { env, say } = setup();
  await intake(say);
  const planned = await say('Plan my study for today.');
  const original = env.planner;
  env.planner = { ...original, async draft() { throw new Error('why must not call planner'); } };
  for (const message of ['why', 'why?', 'why this plan?', 'explain my plan']) {
    const reply = await say(message);
    assert.equal(reply.state, null);
    assert.deepEqual(reply.why, planned.why);
    assert.match(reply.reply, /Decision:.*\nWhy:/);
    assert.doesNotMatch(reply.reply, /out.of.syllabus|can't answer|not wired yet/i);
  }
  assert.equal(classifyIntent('why?').intent, 'plan');
  assert.equal(classifyIntent('why do charges repel?').intent, 'doubt');
});

test('why before a first plan asks for a plan rather than refusing NCERT', async () => {
  const { say } = setup();
  await intake(say);
  const reply = await say('why');
  assert.match(reply.reply, /no previous plan/);
  assert.equal(reply.why, null);
});
