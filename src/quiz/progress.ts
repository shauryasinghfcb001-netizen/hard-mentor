// Student progress view: recent quiz attempts, and how the next recommendation
// moved because of the latest one. Reads the saved quiz log and attempts and
// re-ranks with the rule planner's own rule (highest priority topic below
// MASTERED_AT). Pure over its inputs apart from reading those two files.

import fs from "node:fs";
import { MASTERED_AT, rankTopics, type TopicState } from "../core/priority.ts";
import { readQuizLog } from "../data/studyData.ts";
import { attemptsPathFor, readAttempts, type QuizAttempt } from "./attempts.ts";

export interface ProgressAttempt {
  quizId: string;
  topicId: string;
  topicName: string;
  takenAt: string;
  correct: number;
  total: number;
  masteryBefore: number;
  masteryAfter: number;
  /** first-ranked topic just before and just after this attempt (replayed from the saved mastery history) */
  nextBefore: Recommendation | null;
  nextAfter: Recommendation | null;
  /** per-question choices; null for attempts saved before the attempts file existed */
  answers: QuizAttempt["answers"] | null;
}

export interface Recommendation {
  topicId: string;
  name: string;
  mastery: number;
  priority: number;
}

export interface Progress {
  studentId: string;
  attempts: ProgressAttempt[];
  totalAttempts: number;
  /** recommendation just before the latest attempt, and now */
  before: Recommendation | null;
  now: Recommendation | null;
  mastered: string[];
  weak: string[];
}

function recommend(topics: TopicState[], days: number): Recommendation | null {
  const top = rankTopics(topics, days).find((t) => t.mastery < MASTERED_AT);
  return top ? { topicId: top.topicId, name: top.name, mastery: top.mastery, priority: top.priority } : null;
}

export function buildProgress(opts: { studentId: string; topics: TopicState[]; daysToExam: number; quizLog: string; limit?: number }): Progress {
  const log = fs.existsSync(opts.quizLog) ? readQuizLog(opts.quizLog).filter((r) => r.studentId === opts.studentId) : [];
  const saved = new Map(readAttempts(attemptsPathFor(opts.quizLog), opts.studentId).map((a) => [a.quizId, a]));
  const names = new Map(opts.topics.map((t) => [t.topicId, t.name]));
  // Undo attempts newest first: the state after attempt i is today's records with every later attempt undone.
  const mastery = new Map(opts.topics.map((t) => [t.topicId, t.mastery]));
  const view = () => opts.topics.map((t) => ({ ...t, mastery: mastery.get(t.topicId)! }));
  const replay = new Map<string, { nextBefore: Recommendation | null; nextAfter: Recommendation | null }>();
  for (const r of [...log].reverse()) {
    const nextAfter = recommend(view(), opts.daysToExam);
    if (mastery.has(r.topicId)) mastery.set(r.topicId, r.masteryBefore);
    replay.set(r.quizId, { nextBefore: recommend(view(), opts.daysToExam), nextAfter });
  }
  const recent = log.slice(-(opts.limit ?? 5)).reverse();
  const attempts = recent.map((r) => ({
    ...replay.get(r.quizId)!,
    quizId: r.quizId,
    topicId: r.topicId,
    topicName: names.get(r.topicId) ?? r.topicId,
    takenAt: r.takenAt,
    correct: r.correct,
    total: r.total,
    masteryBefore: r.masteryBefore,
    masteryAfter: r.masteryAfter,
    answers: saved.get(r.quizId)?.answers ?? null,
  }));
  const now = recommend(opts.topics, opts.daysToExam);
  const latest = log.at(-1);
  // Replay: the same records with the latest quiz's topic put back to its mastery before that quiz.
  const before = latest ? recommend(opts.topics.map((t) => (t.topicId === latest.topicId ? { ...t, mastery: latest.masteryBefore } : t)), opts.daysToExam) : null;
  return {
    studentId: opts.studentId,
    attempts,
    totalAttempts: log.length,
    before,
    now,
    mastered: opts.topics.filter((t) => t.mastery >= MASTERED_AT).map((t) => t.name),
    weak: opts.topics.filter((t) => t.mastery < MASTERED_AT).sort((a, b) => a.mastery - b.mastery).map((t) => t.name),
  };
}

export function renderProgress(p: Progress): string {
  if (!p.totalAttempts) return `No quiz attempts saved for ${p.studentId} yet. Say "quiz me" to take one; your progress shows here afterwards.`;
  const lines = [`Progress for ${p.studentId}: ${p.totalAttempts} saved quiz attempt${p.totalAttempts > 1 ? "s" : ""}, newest first (showing ${p.attempts.length}).`];
  for (const a of p.attempts) {
    const wrong = a.answers ? a.answers.filter((x) => !x.ok).length : null;
    lines.push(
      `- ${a.takenAt.slice(0, 10)} ${a.topicName}: ${a.correct}/${a.total} (${Math.round((a.correct / a.total) * 100)}%), mastery ${a.masteryBefore} -> ${a.masteryAfter}` +
        (wrong === null ? " [no per-question answers saved]" : wrong ? `; missed ${a.answers!.filter((x) => !x.ok).map((x) => `Q${a.answers!.indexOf(x) + 1}`).join(", ")}` : "; no misses") +
        ` [${a.quizId}]`
    );
    if (a.nextBefore?.topicId !== a.nextAfter?.topicId) lines.push(`    next topic after this quiz: ${a.nextBefore?.name ?? "none"} -> ${a.nextAfter?.name ?? "none (all mastered)"}`);
  }
  const fmt = (r: Recommendation | null) => (r ? `${r.name} (mastery ${r.mastery}, priority ${r.priority.toFixed(3)})` : "nothing due, all topics mastered");
  if (p.before?.topicId === p.now?.topicId) lines.push(`Next recommendation: ${fmt(p.now)}. The latest quiz did not change which topic is first.`);
  else lines.push(`Next recommendation changed after the latest quiz: ${fmt(p.before)} -> ${fmt(p.now)}.`);
  lines.push(`Weak, weakest first: ${p.weak.join(", ") || "none"}. Mastered (>= ${MASTERED_AT}): ${p.mastered.join(", ") || "none"}.`);
  return lines.join("\n");
}
