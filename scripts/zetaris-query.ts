// Standalone Zetaris query runner. Reads the four HM_ZETARIS_* env vars, asks
// zetarisStudyData() for one student's topics and prints what came back, with
// the exact SQL that was executed. There is no CSV fallback and no model call:
// any failure prints "Zetaris unavailable" and exits 1.
//
//   node --import tsx scripts/zetaris-query.ts <studentId>

import { pathToFileURL } from "node:url";
import type { StudyDataSource, TopicQuery } from "../src/data/studyData.ts";
import { zetarisStudyData } from "../src/data/zetarisStudyData.ts";

const PREFIX = "Zetaris unavailable";

export function formatQuery(kind: StudyDataSource["kind"], q: TopicQuery): string {
  const lines = [
    `kind: ${kind}`,
    `source: ${q.source}`,
    `sql: ${q.sql ?? "(none)"}`,
    `rows: ${q.rows.length}`,
  ];
  for (const r of q.rows) {
    lines.push(`  topic_id=${r.topicId} name=${r.name} mastery=${r.mastery} marks_weight=${r.marksWeight}`);
  }
  return lines.join("\n");
}

// Only messages the connector itself wrote are printed. Anything else, and any
// configured secret that slipped into a message, is replaced.
export function formatFailure(err: unknown, secrets: string[] = []): string {
  const msg = err instanceof Error ? err.message : "";
  if (!msg.startsWith(PREFIX) || secrets.some((s) => s && msg.includes(s))) return `${PREFIX}: unexpected error`;
  return msg;
}

async function main(): Promise<number> {
  const studentId = process.argv[2];
  if (!studentId) {
    console.error("usage: node --import tsx scripts/zetaris-query.ts <studentId>");
    return 2;
  }
  const source = zetarisStudyData();
  try {
    console.log(formatQuery(source.kind, await source.topicsFor(studentId)));
    return 0;
  } catch (err) {
    const env = process.env;
    console.error(formatFailure(err, [env.HM_ZETARIS_PASSWORD ?? "", env.HM_ZETARIS_USER ?? ""]));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
