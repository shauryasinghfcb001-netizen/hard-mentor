import { assertStudentStorage } from "../src/consent/storageGate.ts";
// CSV-backed plan change demo (DECISIONS.md D16, D17). Riya's study records
// come from seed/study-records.csv through the StudyDataSource adapter. A
// second copy of the CSV with changed fictional marks (as if after a quiz) is
// written to <dataRoot>, and the same message is planned on both. The plan
// and the why card change, and every data reason names the CSV file and line
// it came from.
//
// Data: local CSV, synthetic. Not Zetaris. Planner: rule-planner-v1 (rules),
// no model is called. Memory is off so only the data differs.
//
//   node --import tsx scripts/csv-plan-demo.ts <dataRoot>

import fs from "node:fs";
import path from "node:path";
import { runMentor, type StudentContext } from "../src/agent/graph.ts";
import { rulePlanner } from "../src/agent/planner.ts";
import { buildWhyCard, renderWhyCard } from "../src/agent/whyCard.ts";
import { csvStudyData } from "../src/data/studyData.ts";
import { RIYA, RIYA_DAYS_TO_EXAM } from "../src/synthetic/riya.ts";

const MESSAGE = "Plan my study for today.";
// Fictional quiz results: Electrostatics improves past the mastered line
// (0.85), Integrals drops.
export const MARK_CHANGES: Record<string, number> = { "physics:electrostatics": 0.88, "maths:integrals": 0.25 };

export function writeChangedCsv(seedFile: string, outFile: string): string[] {
  assertStudentStorage(outFile, RIYA.studentId);
  const lines = fs.readFileSync(seedFile, "utf-8").split("\n");
  const diffs: string[] = [];
  const out = lines.map((line, i) => {
    const f = line.split(",");
    const next = f[0] === RIYA.studentId ? MARK_CHANGES[f[1]] : undefined;
    if (next === undefined) return line;
    diffs.push(`line ${i + 1}: ${f[1]} mastery ${f[4]} -> ${next}`);
    f[4] = String(next);
    return f.join(",");
  });
  fs.writeFileSync(outFile, out.join("\n"));
  return diffs;
}

async function planFrom(file: string) {
  const q = await csvStudyData(file).topicsFor(RIYA.studentId);
  const student: StudentContext = { studentId: RIYA.studentId, name: RIYA.name, hoursPerDay: RIYA.dailyStudyHours, daysToExam: RIYA_DAYS_TO_EXAM, topics: q.rows };
  return { q, s: await runMentor({ planner: rulePlanner, memory: null }, student, MESSAGE) };
}

async function main(): Promise<void> {
  const dataRoot = process.argv[2];
  if (!dataRoot) {
    console.error("usage: csv-plan-demo.ts <dataRoot>");
    process.exit(2);
  }
  const seed = path.resolve("seed/study-records.csv");
  const changed = path.join(path.resolve(dataRoot), "study-records.after-quiz.csv");
  const diffs = writeChangedCsv(seed, changed);

  console.log(`Student message: "${MESSAGE}"`);
  console.log(`Data: local CSV via StudyDataSource (synthetic, not Zetaris). Planner: ${rulePlanner.name} (${rulePlanner.kind}), no model called. Memory: off.\n`);
  console.log(`Changed fictional marks in ${path.basename(changed)}:`);
  for (const d of diffs) console.log(`  ${d}`);
  console.log("");

  const plans: string[] = [];
  for (const [label, file] of [["BEFORE (seed CSV)", seed], ["AFTER (changed marks)", changed]] as const) {
    const { q, s } = await planFrom(file);
    const plan = s.draft!.blocks.map((b) => `${b.topicId} ${b.minutes}m`).join(", ");
    plans.push(plan);
    console.log(`=== ${label} ===`);
    console.log(`Source: ${q.source}; rows: ${q.rows.map((r) => `${r.topicId}=${r.mastery} [${r.sourceRow}]`).join(", ")}`);
    console.log(`Reply: ${s.reply}`);
    console.log(`Plan: ${plan}`);
    console.log(renderWhyCard(buildWhyCard(s)) + "\n");
  }
  console.log(plans[0] === plans[1] ? "RESULT: plan did NOT change" : `RESULT: plan changed\n  before: ${plans[0]}\n  after:  ${plans[1]}`);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
