// Demo beat 0:50-1:30: Riya asks to swap Electrostatics for Organic.
// Runs the LangGraph loop twice, memory ON and memory OFF, and prints both why
// cards. Rule planner only: no model is called.
//
//   node --import tsx scripts/riya-swap-demo.ts <dataRoot>

import path from "node:path";
import { runMentor, type StudentContext } from "../src/agent/graph.ts";
import { rulePlanner } from "../src/agent/planner.ts";
import { buildWhyCard, renderWhyCard } from "../src/agent/whyCard.ts";
import { csvStudyData } from "../src/data/studyData.ts";
import { openStudentMemory, rememberPattern } from "../src/memory/studentMemory.ts";
import { RIYA, RIYA_DAYS_TO_EXAM, RIYA_EVENING_SKIP_PATTERN, RIYA_SWAP_REQUEST } from "../src/synthetic/riya.ts";

async function main(): Promise<void> {
  const dataRoot = process.argv[2];
  if (!dataRoot) {
    console.error("usage: riya-swap-demo.ts <dataRoot>");
    process.exit(2);
  }
  const mem = await openStudentMemory(RIYA.studentId, { dataRoot: path.resolve(dataRoot) });
  rememberPattern(mem, RIYA_EVENING_SKIP_PATTERN);
  const student: StudentContext = {
    studentId: RIYA.studentId,
    name: RIYA.name,
    hoursPerDay: RIYA.dailyStudyHours,
    daysToExam: RIYA_DAYS_TO_EXAM,
    topics: (await csvStudyData("seed/study-records.csv").topicsFor(RIYA.studentId)).rows,
  };

  console.log(`Student message: "${RIYA_SWAP_REQUEST}"`);
  console.log(`Planner: ${rulePlanner.name} (${rulePlanner.kind}); engine: ${mem.engineSource}; data: local CSV seed/study-records.csv (synthetic, not Zetaris)\n`);
  for (const [label, memory] of [["MEMORY ON", mem], ["MEMORY OFF", null]] as const) {
    const s = await runMentor({ planner: rulePlanner, memory }, student, RIYA_SWAP_REQUEST);
    console.log(`=== ${label} ===`);
    console.log(`Reply: ${s.reply}`);
    console.log(`Plan: ${s.draft!.blocks.map((b) => `${b.topicId} ${b.minutes}m`).join(", ")}`);
    console.log(renderWhyCard(buildWhyCard(s)) + "\n");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
