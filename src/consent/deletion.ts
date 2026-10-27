import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertFictionalPath } from "./storageGate.ts";

export interface StudentDataLayout {
  records: string;
  quizLog: string;
  sessionsDir: string;
  studentsDir: string;
}
/** Only the known application stores are edited; preserve other students and
 * unrelated files. Preflight paths/JSON before revoking or mutating anything.
 * Returns a synchronous purge to run after access has been revoked.
 */
export function prepareFictionalDeletion(root: string, id: string, layout: StudentDataLayout): () => void {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) throw new Error("Invalid student identity");
  const session = path.join(layout.sessionsDir, `${id}.json`);
  const memory = path.join(layout.studentsDir, id);
  const attempts = path.join(path.dirname(layout.quizLog), "quiz-attempts.jsonl");
  const audit = path.join(root, "deletion-audit.jsonl");
  const targets = [layout.records, layout.quizLog, attempts, session, `${session}.tmp`, memory, audit];
  for (const file of targets) assertFictionalPath(root, file);
  const changes: { file: string; text: string }[] = [];
  for (const [file, column] of [[layout.records, 0], [layout.quizLog, 1]] as const) {
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, "utf8").split("\n");
    changes.push({ file, text: lines.filter((line, n) => n === 0 || line.split(",")[column] !== id).join("\n") });
  }
  if (fs.existsSync(attempts)) {
    const lines = fs.readFileSync(attempts, "utf8").split("\n").filter(Boolean);
    changes.push({ file: attempts, text: lines.filter(line => JSON.parse(line).studentId !== id).map(line => line + "\n").join("") });
  }
  return () => {
    for (const { file, text } of changes) fs.writeFileSync(file, text);
    for (const file of [session, `${session}.tmp`, memory]) fs.rmSync(file, { recursive: true, force: true });
    fs.appendFileSync(audit, JSON.stringify({ event: "student-data-deleted", eventId: randomUUID(), at: new Date().toISOString() }) + "\n");
  };
}
