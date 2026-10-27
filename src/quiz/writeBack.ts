import { assertStudentStorage } from "../consent/storageGate.ts";
// Quiz -> mastery -> study records -> H-MEM, in one call. The next plan reads
// the changed record and the quiz log, so the why card can cite the quiz.

import fs from "node:fs";
import { readQuizLog, recordQuizResult, type QuizLogRow, type QuizWriteBack } from "../data/studyData.ts";
import { rememberQuizResult, type StudentMemory } from "../memory/studentMemory.ts";
import { appendAttempt, attemptsPathFor } from "./attempts.ts";
import { gradeQuiz, type Quiz, type QuizResult } from "./quiz.ts";

export type QuizStep =
  | { kind: "written"; result: QuizResult; record: QuizWriteBack; memoryId: string | null }
  | { kind: "distress"; ruleIds: string[] }
  | { kind: "already_recorded"; row: QuizLogRow };

export function submitQuiz(
  quiz: Quiz,
  answers: string[],
  opts: { studentId: string; records: string; quizLog: string; takenAt: string; memory: StudentMemory | null }
): QuizStep {
  assertStudentStorage(opts.records, opts.studentId);
  assertStudentStorage(opts.quizLog, opts.studentId);
  // A quiz id is scored once per student: a repeated completion is not counted again.
  const prior = fs.existsSync(opts.quizLog) ? readQuizLog(opts.quizLog).find((r) => r.studentId === opts.studentId && r.quizId === quiz.id) : undefined;
  if (prior) return { kind: "already_recorded", row: prior };
  const g = gradeQuiz(quiz, answers);
  // Distress in an answer stops the quiz: no grading, no record, no memory.
  if (g.kind === "distress") return g;
  const r = g.result;
  const record = recordQuizResult(opts.records, opts.quizLog, {
    studentId: opts.studentId,
    quizId: quiz.id,
    topicId: quiz.topicId,
    takenAt: opts.takenAt,
    correct: r.correct,
    total: r.total,
    sources: [...new Set(quiz.items.map((i) => `ncert:${i.chunkId}`))],
  });
  appendAttempt(attemptsPathFor(opts.quizLog), {
    quizId: quiz.id,
    studentId: opts.studentId,
    topicId: quiz.topicId,
    takenAt: opts.takenAt,
    correct: r.correct,
    total: r.total,
    score: r.score,
    answers: r.perItem,
    logRef: record.logRef,
  });
  const memoryId = opts.memory
    ? rememberQuizResult(opts.memory, {
        quizId: quiz.id,
        topicId: quiz.topicId,
        correct: r.correct,
        total: r.total,
        masteryBefore: record.masteryBefore,
        masteryAfter: record.masteryAfter,
        missedNotes: [...new Set(r.perItem.filter((p) => !p.ok).map((p) => p.chunkId))],
        logRef: record.logRef,
      }).id
    : null;
  return { kind: "written", result: r, record, memoryId };
}
