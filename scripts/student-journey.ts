// One student journey through the whole loop, offline:
//   goal intake -> exam research (MOCK fixture source) -> ambiguity question ->
//   resolved exam context -> plan -> quiz from NCERT notes -> mastery write-back
//   to the study records + H-MEM -> second quiz -> plan changes -> memory list.
//
// Student, answers and exam date are fictional. Research is the offline
// fixture (nothing fetched, nothing verified). Planner: rule-planner-v1, no
// model called. Data: a working copy of seed/study-records.csv in <dataRoot>.
//
//   node --import tsx scripts/student-journey.ts <dataRoot>

import fs from "node:fs";
import path from "node:path";
import { runMentor, type StudentContext } from "../src/agent/graph.ts";
import { rulePlanner } from "../src/agent/planner.ts";
import { buildWhyCard, renderWhyCard } from "../src/agent/whyCard.ts";
import { daysUntil, researchExam, type ExamContext, type StudentGoal } from "../src/context/examContext.ts";
import { fixtureResearch } from "../src/context/fixtureExams.ts";
import { csvStudyData } from "../src/data/studyData.ts";
import { openStudentMemory } from "../src/memory/studentMemory.ts";
import { buildQuiz, CORPUS_TOPIC, renderQuizItem, type Quiz } from "../src/quiz/quiz.ts";
import { submitQuiz } from "../src/quiz/writeBack.ts";
import { bm25Retriever, loadCorpus } from "../src/rag/ncert.ts";
import { RIYA } from "../src/synthetic/riya.ts";

const TODAY = "2026-10-23";
// Fictional: what Riya types at intake. The exam date is her own statement, not an official date.
const GOAL: StudentGoal = { exam: "12th boards", country: "India", goal: "90% in PCM", statedExamDate: "2027-02-15" };
const CHOICE = "CBSE";

/** Simulated fictional answers: correct except at the listed item numbers, where the first wrong option is picked. */
function simulatedAnswers(q: Quiz, wrongAt: number[]): string[] {
  return q.items.map((it, i) => (wrongAt.includes(i + 1) ? it.options.find((o) => o !== it.answer)! : it.answer));
}

async function main(): Promise<void> {
  const dataRoot = process.argv[2];
  if (!dataRoot) {
    console.error("usage: student-journey.ts <dataRoot>");
    process.exit(2);
  }
  const root = path.resolve(dataRoot);
  const records = path.join(root, "study-records.csv");
  const quizLog = path.join(root, "quiz-log.csv");
  fs.copyFileSync("seed/study-records.csv", records);
  let t = Date.parse(`${TODAY}T09:00:00Z`);
  const clock = () => (t += 60_000);
  const mem = await openStudentMemory(RIYA.studentId, { dataRoot: path.join(root, "students"), clock });
  const corpus = loadCorpus("corpus/ncert-phy12-ch1.json");
  const retriever = bm25Retriever(corpus);

  console.log("WHAT RAN: research = offline MOCK fixture (no web, nothing fetched); planner = rule-planner-v1 (no model);");
  console.log(`memory = H-MEM (${mem.engineSource}); study records = local synthetic CSV copy; student, answers and exam date are fictional.\n`);

  // 1. Goal intake and research
  console.log(`=== 1. Riya (fictional) says: exam "${GOAL.exam}", country "${GOAL.country}", goal "${GOAL.goal}", exam date "${GOAL.statedExamDate}" ===`);
  const first = await researchExam(fixtureResearch, GOAL, { ranAt: `${TODAY}T09:00:00Z` });
  if (first.status !== "ambiguous") throw new Error(`expected an ambiguity question, got ${first.status}`);
  console.log(`Mentor: ${first.question}`);
  for (const o of first.options) console.log(`  - ${o.name} (${o.body})`);

  console.log(`\n=== 2. Riya answers: "${CHOICE}" ===`);
  const step = await researchExam(fixtureResearch, GOAL, { ranAt: `${TODAY}T09:01:00Z`, choice: CHOICE });
  if (step.status !== "resolved") throw new Error(`expected a resolved context, got ${step.status}`);
  const ctx: ExamContext = step.context;
  console.log(`Exam: ${ctx.exam.name} (resolved by ${ctx.resolvedBy})`);
  for (const f of ctx.facts) console.log(`  fact ${f.key} = "${f.value}": ${f.status.toUpperCase()} (${f.why}); source ${f.source.url}, retrieved ${f.source.retrievedAt ?? "never"}, published ${f.source.publishedAt ?? "n/a"}`);
  console.log(`  exam date ${ctx.examDate?.value} (${ctx.examDate?.origin}); days to exam from ${TODAY}: ${daysUntil(ctx.examDate!.value, TODAY)}`);
  console.log(`  local notes for this exam: ${ctx.corpora.join(", ")} (${corpus.book}, Ch ${corpus.chapter}, ${corpus.edition}, from ${corpus.sourceFile})`);

  const student = async (): Promise<StudentContext> => ({
    studentId: RIYA.studentId,
    name: RIYA.name,
    hoursPerDay: RIYA.dailyStudyHours,
    daysToExam: daysUntil(ctx.examDate!.value, TODAY),
    topics: (await csvStudyData(records, quizLog).topicsFor(RIYA.studentId)).rows,
    exam: ctx,
  });
  const turn = async (label: string, msg: string) => {
    const s = await runMentor({ planner: rulePlanner, memory: mem, retriever }, await student(), msg);
    console.log(`\n=== ${label}: "${msg}" ===`);
    console.log(`Mentor: ${s.reply}`);
    console.log(renderWhyCard(buildWhyCard(s)));
    return s;
  };

  const plan1 = await turn("3. Plan", "Plan my study for today.");
  const top = plan1.draft!.blocks[0].topicId;

  // 4. Quizzes on the top topic, only where local notes exist for it
  const corpusFor = ctx.corpora.find((c) => CORPUS_TOPIC[c] === top);
  if (!corpusFor) throw new Error(`no local notes for ${top}; quiz not possible`);
  for (const [round, wrongAt] of [[0, [3]], [1, []]] as const) {
    const quiz = buildQuiz(corpus, { n: 5, round, createdAt: `${TODAY}T1${round}:00:00Z` });
    console.log(`\n=== ${4 + round * 2}. Quiz ${quiz.id} on ${quiz.topicId} (built from the notes, no model) ===`);
    quiz.items.forEach((it, i) => console.log(renderQuizItem(it, i)));
    const answers = simulatedAnswers(quiz, [...wrongAt]);
    console.log(`Riya's answers (simulated, fictional): ${answers.join(", ")}`);
    const out = submitQuiz(quiz, answers, { studentId: RIYA.studentId, records, quizLog, takenAt: quiz.createdAt, memory: mem });
    if (out.kind !== "written") throw new Error("unexpected distress stop");
    console.log(`Score ${out.result.correct}/${out.result.total}. Mastery ${out.record.masteryBefore} -> ${out.record.masteryAfter} (m = 0.7m + 0.3 score)`);
    console.log(`Written: study record ${out.record.recordRef}; quiz log ${out.record.logRef}; H-MEM ${out.memoryId}`);
    await turn(`${5 + round * 2}. Plan after quiz`, "Plan my study for today.");
  }

  await turn("8. Memory", "What do you remember about me?");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
