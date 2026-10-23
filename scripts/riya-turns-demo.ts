// Six-turn demo on one H-MEM store: swap request (memory refuses), "what do
// you remember", "forget X", the same swap request again (now a compromise),
// an NCERT doubt with citation, and an out-of-syllabus refusal.
// Planner: rules unless HM_PLANNER=model and a key is in .env.
//
//   node --import tsx scripts/riya-turns-demo.ts <dataRoot>

import fs from "node:fs";
import path from "node:path";
import { runMentor, type StudentContext } from "../src/agent/graph.ts";
import { plannerFromEnv } from "../src/agent/modelPlanner.ts";
import { buildWhyCard, renderWhyCard } from "../src/agent/whyCard.ts";
import { modelFromEnv } from "../src/llm/client.ts";
import { csvStudyData } from "../src/data/studyData.ts";
import { openStudentMemory, rememberPattern } from "../src/memory/studentMemory.ts";
import { bm25Retriever, loadCorpus } from "../src/rag/ncert.ts";
import { RIYA, RIYA_DAYS_TO_EXAM, RIYA_EVENING_SKIP_PATTERN, RIYA_SWAP_REQUEST } from "../src/synthetic/riya.ts";

const TURNS = [
  RIYA_SWAP_REQUEST,
  "What do you remember about me?",
  "Forget that I skipped Electrostatics.",
  RIYA_SWAP_REQUEST,
  "What is Coulomb's law?",
  "What is Ohm's law?",
];

async function main(): Promise<void> {
  const dataRoot = process.argv[2];
  if (!dataRoot) {
    console.error("usage: riya-turns-demo.ts <dataRoot>");
    process.exit(2);
  }
  if (fs.existsSync(".env")) process.loadEnvFile(".env");
  const model = modelFromEnv(process.env);
  const planner = plannerFromEnv(process.env, model);
  const useModelForDoubts = process.env.HM_PLANNER === "model" ? model : null;
  const mem = await openStudentMemory(RIYA.studentId, { dataRoot: path.resolve(dataRoot) });
  rememberPattern(mem, RIYA_EVENING_SKIP_PATTERN);
  const retriever = bm25Retriever(loadCorpus("corpus/ncert-phy12-ch1.json"));
  const student: StudentContext = { studentId: RIYA.studentId, name: RIYA.name, hoursPerDay: RIYA.dailyStudyHours, daysToExam: RIYA_DAYS_TO_EXAM, topics: (await csvStudyData("seed/study-records.csv").topicsFor(RIYA.studentId)).rows };

  console.log(`Planner: ${planner.name} (${planner.kind}); doubts: ${useModelForDoubts ? `model ${useModelForDoubts.model}` : "extractive"}; engine: ${mem.engineSource}; data: local CSV seed/study-records.csv (synthetic, not Zetaris)\n`);
  for (const [i, msg] of TURNS.entries()) {
    const s = await runMentor({ planner, memory: mem, retriever, doubtModel: useModelForDoubts }, student, msg);
    console.log(`=== Turn ${i + 1}: "${msg}" ===`);
    console.log(`Reply: ${s.reply}`);
    console.log(renderWhyCard(buildWhyCard(s)) + "\n");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
