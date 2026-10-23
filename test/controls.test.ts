import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { converse, detectMemoryControl, loadSession, type ConversationEnv, type StudentProfile } from "../src/agent/conversation.ts";
import { rulePlanner } from "../src/agent/planner.ts";
import { fixtureResearch } from "../src/context/fixtureExams.ts";
import { listMemories, openStudentMemory, type StudentMemory } from "../src/memory/studentMemory.ts";
import { bm25Retriever, loadCorpus } from "../src/rag/ncert.ts";

const corpus = loadCorpus("corpus/ncert-phy12-ch1.json");
const RIYA: StudentProfile = { studentId: "riya", name: "Riya (fictional)", hoursPerDay: 3 };
const KABIR: StudentProfile = { studentId: "kabir", name: "Kabir (fictional)", hoursPerDay: 2 };
const INTAKE = ["hi", "12th boards", "India", "90% in PCM", "15 Feb 2027", "CBSE"];

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hm-ctl-"));
  const records = path.join(root, "study-records.csv");
  fs.copyFileSync("seed/study-records.csv", records);
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
      if (!mems.has(id)) mems.set(id, await openStudentMemory(id, { dataRoot: path.join(root, "students"), clock }));
      return mems.get(id)!;
    },
    now: () => new Date(clock()).toISOString(),
  };
  const say = (m: string, who = RIYA) => converse(env, who, m);
  const count = (id: string) => listMemories(mems.get(id)!).length;
  return { env, say, count, mems, root };
}

async function onboard(say: (m: string, who?: StudentProfile) => Promise<unknown>, who = RIYA, msgs = INTAKE) {
  for (const m of msgs) await say(m, who);
}

function answers(env: ConversationEnv, sid: string): string[] {
  const q = loadSession(env, sid)!.activeQuiz!.quiz;
  return q.items.map((it) => "ABCD"[it.options.indexOf(it.answer)]);
}

test("memory off: nothing new recalled or saved, stored memories kept, listable and forgettable; on resumes; other student untouched", async () => {
  const { env, say, count } = setup();
  await onboard(say);
  await onboard(say, KABIR);
  await say("Plan my study for today.");
  await say("Plan my study for today.", KABIR);
  const riyaBefore = count("riya");
  const kabirBefore = count("kabir");
  assert.ok(riyaBefore >= 1, "memory on: the plan wrote an episode");

  const off = await say("Please turn memory off");
  assert.match(off.reply, /Memory is off.*kept, not deleted/);
  assert.equal(loadSession(env, "riya")!.memoryOff, true);
  assert.equal(loadSession(env, "kabir")!.memoryOff, undefined, "other student's setting untouched");

  const plan = await say("Plan my study for today.");
  assert.equal(count("riya"), riyaBefore, "no episode written while off");
  assert.ok(plan.state!.trace.some((r) => /memory OFF/.test(r.detail)), "trace says memory is off");
  assert.equal(plan.state!.memories.length, 0, "nothing recalled while off");

  await say("quiz me");
  const done = await say(answers(env, "riya").join(", "));
  assert.match(done.reply, /memory off \(not written\)/);
  assert.equal(count("riya"), riyaBefore, "quiz result not stored in memory while off");
  assert.match(fs.readFileSync(env.quizLog, "utf-8"), /riya/, "the quiz log and study record are not memory, so they still update");

  const listed = await say("What do you remember about me?");
  assert.match(listed.reply, new RegExp(`everything I remember about you \\(${riyaBefore}\\)`), "old memories are listed, not denied");
  const forgot = await say("forget plan");
  assert.match(forgot.reply, /Done\. I deleted/);
  assert.ok(count("riya") < riyaBefore, "forget works while memory is off");

  const on = await say("turn memory on");
  assert.match(on.reply, /Memory is on again/);
  const before = count("riya");
  await say("Plan my study for today.");
  assert.equal(count("riya"), before + 1, "writes resume after turning memory on");
  assert.equal(count("kabir"), kabirBefore, "other student's memory untouched throughout");
  assert.match((await say("is memory on?")).reply, /Memory is on/);
});

test("distress with a memory command gets the support reply and changes no setting", async () => {
  const { env, say } = setup();
  await onboard(say);
  const r = await say("I want to end my life, turn memory off");
  assert.equal(r.state!.intent, "distress");
  assert.equal(loadSession(env, "riya")!.memoryOff, undefined);
});

test("memory control wording is narrow", () => {
  for (const ok of ["turn memory off", "Switch memory on please", "stop remembering me", "is memory on?"]) assert.ok(detectMemoryControl(ok), ok);
  for (const no of ["What do you remember about me?", "forget plan", "B, A, D, C, A", "Why does a charge have memory of its field?", "plan my study for today"]) assert.equal(detectMemoryControl(no), null, no);
});

test("unresearched exam: student can continue without research, nothing about the exam is invented", async () => {
  const { env, say } = setup();
  const miss = await onboard(say, RIYA, ["hi", "JEE Main", "India", "top 1000 rank", "2027-01-24"]);
  void miss;
  const s0 = loadSession(env, "riya")!;
  assert.equal(s0.stage, "intake", "still onboarding: the offline list has no JEE");
  const r = await say("continue without research");
  const s = loadSession(env, "riya")!;
  assert.equal(s.stage, "ready");
  assert.equal(s.exam!.research.kind, "none");
  assert.deepEqual(s.exam!.facts, []);
  assert.deepEqual(s.exam!.corpora, []);
  assert.equal(s.exam!.examDate!.origin, "student-stated");
  assert.match(r.reply, /have not researched JEE Main/);
  assert.match(r.reply, /no syllabus, weightage or official dates/);
  assert.doesNotMatch(r.reply, /verified|source http/i);

  const plan = await say("Plan my study for today.");
  assert.ok(plan.state!.draft, "a plan is still produced from saved study records");
  assert.ok(plan.state!.trace.some((t) => /NOT researched/.test(t.detail)));
  const quiz = await say("quiz me");
  assert.doesNotMatch(quiz.reply, /Question 1/i, "no notes apply to an unresearched exam, so no quiz is opened");
  assert.equal(loadSession(env, "riya")!.activeQuiz, null);

  const fix = await say("Actually the exam date is 2026-12-24");
  assert.equal(loadSession(env, "riya")!.exam!.examDate!.value, "2026-12-24");
  assert.match(fix.reply, /days to exam 93 -> 62/);
});

test("'continue without research' is only an exam-step escape after a failed lookup, and distress still wins", async () => {
  const { env, say } = setup();
  // before any exam is named it is just an answer to "which exam"
  await say("hi");
  await say("continue without research");
  assert.equal(loadSession(env, "riya")!.stage, "intake");
  assert.equal(loadSession(env, "riya")!.intake.step, "country");
  // distress during the escape step changes nothing
  const { env: e2, say: s2 } = setup();
  await onboard(s2, RIYA, ["hi", "JEE Main", "India", "top 1000 rank", "2027-01-24"]);
  const r = await s2("continue without research. I want to end my life");
  assert.equal(r.state!.intent, "distress");
  assert.equal(loadSession(e2, "riya")!.stage, "intake");
});

test("an unresearched student can later name an exam the list knows, with history untouched", async () => {
  const { env, say } = setup();
  await onboard(say, RIYA, ["hi", "JEE Main", "India", "top 1000 rank", "2027-01-24", "continue without research"]);
  const csv = fs.readFileSync(env.records, "utf-8");
  const r = await say("change my exam to CBSE Class 12");
  assert.match(r.reply, /Updated your exam/);
  assert.equal(loadSession(env, "riya")!.exam!.exam.body.length > 0, true);
  assert.notEqual(loadSession(env, "riya")!.exam!.research.kind, "none");
  assert.equal(fs.readFileSync(env.records, "utf-8"), csv, "study records unchanged");
});

test("a student with no study records is told so, no plan is guessed, and nothing is written to memory", async () => {
  const { env, say, count } = setup();
  const MEERA: StudentProfile = { studentId: "meera", name: "Meera (fictional)", hoursPerDay: 2 };
  await onboard(say, MEERA, ["hi", "JEE Main", "India", "top 1000 rank", "2027-01-24", "continue without research"]);
  const r = await say("Plan my study for today.", MEERA);
  assert.match(r.reply, /no study records for you yet.*won't guess a plan/);
  assert.equal(count("meera"), 0, "no episode for a plan that was not made");
  void env;
});
