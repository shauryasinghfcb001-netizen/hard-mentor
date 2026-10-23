import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runMentor } from "../src/agent/graph.ts";
import { rulePlanner } from "../src/agent/planner.ts";
import { buildWhyCard } from "../src/agent/whyCard.ts";
import { checkFact, daysUntil, researchExam, type ExamCandidate } from "../src/context/examContext.ts";
import { fixtureResearch } from "../src/context/fixtureExams.ts";
import { csvStudyData } from "../src/data/studyData.ts";
import { buildQuiz, gradeQuiz } from "../src/quiz/quiz.ts";
import { submitQuiz } from "../src/quiz/writeBack.ts";
import { loadCorpus } from "../src/rag/ncert.ts";

const corpus = loadCorpus("corpus/ncert-phy12-ch1.json");
const AT = "2026-10-23T10:00:00Z";

function workCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hm-journey-"));
  const records = path.join(dir, "study-records.csv");
  fs.copyFileSync("seed/study-records.csv", records);
  return { records, quizLog: path.join(dir, "quiz-log.csv") };
}

test("ambiguous exam wording asks the student, and the reply resolves it", async () => {
  const goal = { exam: "12th boards", country: "India", goal: "90%", statedExamDate: "2027-02-15" };
  const a = await researchExam(fixtureResearch, goal, { ranAt: AT });
  assert.equal(a.status, "ambiguous");
  const b = await researchExam(fixtureResearch, goal, { ranAt: AT, choice: "the ISC one" });
  assert.equal(b.status, "resolved");
  assert.equal(b.status === "resolved" && b.context.exam.id, "in-isc-12");
  const named = await researchExam(fixtureResearch, { ...goal, exam: "CBSE 12th boards" }, { ranAt: AT });
  assert.equal(named.status === "resolved" && named.context.resolvedBy, "named in goal");
});

test("an exam outside the offline list is not guessed", async () => {
  const r = await researchExam(fixtureResearch, { exam: "SAT", country: "USA", goal: "1500" }, { ranAt: AT });
  assert.equal(r.status, "not_found");
  assert.match(r.status === "not_found" ? r.reply : "", /Web research is not built yet/);
});

test("fixture facts are never verified; only a fetched page on an official domain is", async () => {
  const r = await researchExam(fixtureResearch, { exam: "CBSE boards", country: "India", goal: "pass", statedExamDate: "2027-02-15" }, { ranAt: AT });
  assert.equal(r.status, "resolved");
  if (r.status !== "resolved") return;
  assert.ok(r.context.facts.every((f) => f.status === "unverified"));
  assert.deepEqual(r.context.examDate, { value: "2027-02-15", origin: "student-stated" });
  const c = { officialDomains: ["cbse.gov.in"], body: "CBSE" } as ExamCandidate;
  const web = (url: string) => ({ key: "k", value: "v", source: { url, publisher: "x", via: "web" as const, retrievedAt: AT, publishedAt: null, note: "" } });
  assert.equal(checkFact(web("https://www.cbse.gov.in/notice"), c).status, "verified-official");
  assert.equal(checkFact(web("https://cbse.gov.in.evil.example/notice"), c).status, "unverified");
  assert.equal(checkFact({ ...web("https://www.cbse.gov.in"), source: { ...web("https://www.cbse.gov.in").source, retrievedAt: null } }, c).status, "unverified");
  assert.equal(daysUntil("2027-02-15", "2026-10-23"), 115);
});

test("every quiz answer is a word printed in the cited note", () => {
  for (const round of [0, 1, 2]) {
    const q = buildQuiz(corpus, { n: 5, round, createdAt: AT });
    assert.equal(q.items.length, 5);
    for (const it of q.items) {
      const note = corpus.chunks.find((c) => c.id === it.chunkId)!;
      assert.match(note.text, new RegExp(`\\b${it.answer}\\b`));
      assert.ok(it.options.includes(it.answer));
      assert.equal(new Set(it.options).size, it.options.length);
      assert.ok(!it.prompt.includes(it.answer));
    }
  }
});

test("quiz result updates mastery, the quiz log and the next plan's why card", async () => {
  const { records, quizLog } = workCopy();
  const q = buildQuiz(corpus, { n: 5, createdAt: AT });
  const out = submitQuiz(q, q.items.map((i) => i.answer), { studentId: "riya", records, quizLog, takenAt: AT, memory: null });
  assert.equal(out.kind, "written");
  if (out.kind !== "written") return;
  assert.equal(out.result.correct, 5);
  assert.equal(out.record.masteryBefore, 0.35);
  assert.equal(out.record.masteryAfter, 0.545);
  const rows = (await csvStudyData(records, quizLog).topicsFor("riya")).rows;
  assert.equal(rows.find((r) => r.topicId === "physics:electrostatics")!.mastery, 0.545);
  // Kabir's records are untouched.
  assert.equal((await csvStudyData(records, quizLog).topicsFor("kabir")).rows.every((r) => !r.lastQuiz), true);
  const s = await runMentor({ planner: rulePlanner, memory: null }, { studentId: "riya", name: "Riya (fictional)", hoursPerDay: 3, daysToExam: 115, topics: rows }, "Plan my study for today.");
  const quizReason = buildWhyCard(s).reasons.find((r) => r.ref.kind === "quiz");
  assert.ok(quizReason, "why card cites the quiz");
  assert.equal(quizReason!.ref.id, "csv:quiz-log.csv#2");
});

test("distress in a quiz answer stops grading and writes nothing", () => {
  const { records, quizLog } = workCopy();
  const before = fs.readFileSync(records, "utf-8");
  const q = buildQuiz(corpus, { n: 2, createdAt: AT });
  const out = submitQuiz(q, ["I want to die", "A"], { studentId: "riya", records, quizLog, takenAt: AT, memory: null });
  assert.equal(out.kind, "distress");
  assert.equal(fs.readFileSync(records, "utf-8"), before);
  assert.equal(fs.existsSync(quizLog), false);
  assert.equal(gradeQuiz(q, ["b", "B"]).kind, "graded");
});
