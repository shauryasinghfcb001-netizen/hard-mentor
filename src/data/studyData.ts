// Study-record adapter (DECISIONS.md D16). The planner gets topic rows
// (mastery, marks weight) through this interface, so a Zetaris federated
// query can replace the local CSV later without touching the graph.
// Nothing in this file talks to Zetaris. `sql` is null for the CSV source:
// the why card only ever shows SQL that a source actually executed.

import fs from "node:fs";
import path from "node:path";
import { updateMastery, type TopicState } from "../core/priority.ts";

export interface TopicQuery {
  rows: TopicState[];
  source: string;
  sql: string | null;
}

export interface StudyDataSource {
  name: string;
  kind: "local-csv" | "zetaris";
  topicsFor(studentId: string): Promise<TopicQuery>;
}

const HEADER = "student_id,topic_id,subject,name,mastery,marks_weight";

/**
 * Synthetic records from a local CSV (Q4: local files stand in for the
 * blueprint's cloud sources). Rows are filtered by student_id, so one
 * student's records never reach another student's plan. sourceRow is
 * "csv:<file>#<line>", which the why card shows as the evidence row.
 */
export function csvStudyData(file: string, quizLog?: string): StudyDataSource {
  const base = path.basename(file);
  return {
    name: `csv:${base}`,
    kind: "local-csv",
    async topicsFor(studentId) {
      const lines = fs.readFileSync(file, "utf-8").split("\n");
      if (lines[0].trim() !== HEADER) throw new Error(`${base}: expected header "${HEADER}"`);
      const rows: TopicState[] = [];
      lines.forEach((line, i) => {
        if (i === 0 || !line.trim()) return;
        const [sid, topicId, subject, name, mastery, weight] = line.split(",").map((x) => x.trim());
        if (sid !== studentId) return;
        const m = Number(mastery);
        const w = Number(weight);
        if (!(m >= 0 && m <= 1 && w >= 0 && w <= 1)) throw new Error(`${base} line ${i + 1}: mastery and marks_weight must be 0..1`);
        rows.push({ topicId, subject, name, mastery: m, marksWeight: w, sourceRow: `csv:${base}#${i + 1}` });
      });
      if (quizLog && fs.existsSync(quizLog)) {
        const latest = new Map<string, QuizLogRow>();
        for (const q of readQuizLog(quizLog)) if (q.studentId === studentId) latest.set(q.topicId, q);
        for (const r of rows) {
          const q = latest.get(r.topicId);
          if (q) r.lastQuiz = { quizId: q.quizId, takenAt: q.takenAt, correct: q.correct, total: q.total, ref: q.ref };
        }
      }
      return { rows, source: `local CSV ${base} (synthetic)`, sql: null };
    },
  };
}

// --- Quiz write-back ----------------------------------------------------------
// A graded quiz updates mastery with updateMastery (m = 0.7m + 0.3 score) in
// the study-record CSV and appends one row to a quiz log next to it. Both are
// local synthetic files; callers pass a working copy, never the seed.

const QUIZ_HEADER = "quiz_id,student_id,topic_id,taken_at,correct,total,score,mastery_before,mastery_after,sources";

export interface QuizLogRow {
  quizId: string;
  studentId: string;
  topicId: string;
  takenAt: string;
  correct: number;
  total: number;
  masteryBefore: number;
  masteryAfter: number;
  sources: string[];
  ref: string;
}

export function readQuizLog(file: string): QuizLogRow[] {
  const base = path.basename(file);
  const lines = fs.readFileSync(file, "utf-8").split("\n");
  if (lines[0].trim() !== QUIZ_HEADER) throw new Error(`${base}: expected header "${QUIZ_HEADER}"`);
  return lines.flatMap((line, i) => {
    if (i === 0 || !line.trim()) return [];
    const [quizId, studentId, topicId, takenAt, correct, total, , before, after, sources] = line.split(",");
    return [{ quizId, studentId, topicId, takenAt, correct: Number(correct), total: Number(total), masteryBefore: Number(before), masteryAfter: Number(after), sources: sources ? sources.split(";") : [], ref: `csv:${base}#${i + 1}` }];
  });
}

export interface QuizWriteBack {
  topicId: string;
  masteryBefore: number;
  masteryAfter: number;
  recordRef: string;
  logRef: string;
}

export function recordQuizResult(
  recordsFile: string,
  quizLog: string,
  q: { studentId: string; quizId: string; topicId: string; takenAt: string; correct: number; total: number; sources: string[] }
): QuizWriteBack {
  if (!(q.total > 0 && q.correct >= 0 && q.correct <= q.total)) throw new Error("quiz result needs 0 <= correct <= total and total > 0");
  if (q.quizId.includes(",") || q.sources.some((s) => /[,;]/.test(s))) throw new Error("quiz id and sources must not contain , or ;");
  if (fs.existsSync(quizLog) && readQuizLog(quizLog).some((r) => r.studentId === q.studentId && r.quizId === q.quizId)) {
    throw new Error(`quiz ${q.quizId} is already recorded for ${q.studentId}`);
  }
  const lines = fs.readFileSync(recordsFile, "utf-8").split("\n");
  const i = lines.findIndex((l) => {
    const f = l.split(",");
    return f[0] === q.studentId && f[1] === q.topicId;
  });
  if (i < 1) throw new Error(`no study record for ${q.studentId} / ${q.topicId}`);
  const f = lines[i].split(",");
  const before = Number(f[4]);
  const after = Math.round(updateMastery(before, q.correct / q.total) * 1000) / 1000;
  f[4] = String(after);
  lines[i] = f.join(",");
  fs.writeFileSync(recordsFile, lines.join("\n"));

  if (!fs.existsSync(quizLog)) fs.writeFileSync(quizLog, QUIZ_HEADER + "\n");
  const row = [q.quizId, q.studentId, q.topicId, q.takenAt, q.correct, q.total, (q.correct / q.total).toFixed(3), before, after, q.sources.join(";")].join(",");
  fs.appendFileSync(quizLog, row + "\n");
  const logLines = fs.readFileSync(quizLog, "utf-8").split("\n").filter((l) => l.trim()).length;
  return { topicId: q.topicId, masteryBefore: before, masteryAfter: after, recordRef: `csv:${path.basename(recordsFile)}#${i + 1}`, logRef: `csv:${path.basename(quizLog)}#${logLines}` };
}
