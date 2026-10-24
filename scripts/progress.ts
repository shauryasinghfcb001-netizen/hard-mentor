// Read-only progress view for one student from a chat data root.
//
//   node --import tsx scripts/progress.ts <dataRoot> [studentId] [--days N] [--limit N]
//
// Reads <dataRoot>/study-records.csv and quiz-log.csv (written by scripts/chat.ts).
// Writes nothing. --days is the days to exam used for ranking (default 100).

import path from "node:path";
import { pathToFileURL } from "node:url";
import { csvStudyData } from "../src/data/studyData.ts";
import { buildProgress, renderProgress } from "../src/quiz/progress.ts";

export async function runProgress(args: string[], log: (s: string) => void): Promise<void> {
  const flag = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
  const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
  const [dataRoot, studentId = "riya"] = positional;
  if (!dataRoot) throw new Error("usage: progress.ts <dataRoot> [studentId] [--days N] [--limit N]");
  const root = path.resolve(dataRoot);
  const quizLog = path.join(root, "quiz-log.csv");
  const topics = (await csvStudyData(path.join(root, "study-records.csv"), quizLog).topicsFor(studentId)).rows;
  if (!topics.length) throw new Error(`no study records for ${studentId} in ${root}`);
  log(renderProgress(buildProgress({ studentId, topics, daysToExam: Number(flag("--days") ?? 100), quizLog, limit: flag("--limit") ? Number(flag("--limit")) : undefined })));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runProgress(process.argv.slice(2), console.log).catch((err) => {
    console.error((err as Error).message);
    process.exit(2);
  });
}
