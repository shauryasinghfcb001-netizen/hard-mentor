import { assertStudentStorage } from "../consent/storageGate.ts";
// Quiz attempt store: one JSON line per scored quiz, next to the quiz log.
// The quiz log keeps the score and the mastery change; this file also keeps the
// per-question choices (option text from the quiz, never free text), so a
// progress view can show what was answered. Local synthetic files only.

import fs from "node:fs";
import path from "node:path";

export interface AttemptAnswer {
  id: string;
  chunkId: string;
  given: string;
  answer: string;
  ok: boolean;
}

export interface QuizAttempt {
  quizId: string;
  studentId: string;
  topicId: string;
  takenAt: string;
  correct: number;
  total: number;
  score: number;
  answers: AttemptAnswer[];
  logRef: string;
}

/** The attempts file that sits beside a quiz log. */
export function attemptsPathFor(quizLog: string): string {
  return path.join(path.dirname(quizLog), "quiz-attempts.jsonl");
}

export function appendAttempt(file: string, attempt: QuizAttempt): void {
  assertStudentStorage(file, attempt.studentId);
  fs.appendFileSync(file, JSON.stringify(attempt) + "\n");
}

export function readAttempts(file: string, studentId?: string): QuizAttempt[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l, i) => {
      try {
        return JSON.parse(l) as QuizAttempt;
      } catch {
        throw new Error(`${path.basename(file)} line ${i + 1}: not valid JSON`);
      }
    })
    .filter((a) => !studentId || a.studentId === studentId);
}
