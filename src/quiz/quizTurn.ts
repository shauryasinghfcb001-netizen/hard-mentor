// The quiz inside a conversation (graph node "quiz"). A quiz is opened by
// "quiz me", answered over one or more later messages, and scored only when
// every question has an answer. Until then nothing is written. The open quiz
// lives in the caller's per-student session and is passed in and out of the
// graph as `activeQuiz`, so one student's open quiz never reaches another.

import fs from "node:fs";
import type { TraceRow } from "../agent/graph.ts";
import type { Reason } from "../agent/planner.ts";
import { rankTopics, type TopicState } from "../core/priority.ts";
import { readQuizLog, type QuizLogRow } from "../data/studyData.ts";
import type { StudentMemory } from "../memory/studentMemory.ts";
import type { Corpus } from "../rag/ncert.ts";
import { buildQuiz, CORPUS_TOPIC, renderQuizItem, type Quiz } from "./quiz.ts";
import { submitQuiz } from "./writeBack.ts";

export interface ActiveQuiz {
  quiz: Quiz;
  /** chosen option text per question, null = not answered yet; "(no answer)" = student passed */
  answers: (string | null)[];
}

export interface QuizDeps {
  /** local note corpora that quizzes can be cut from */
  corpora: Corpus[];
  records: string;
  quizLog: string;
  /** ISO time for quiz ids and the quiz log; injected so runs are reproducible */
  now: () => string;
}

export interface QuizTurn {
  kind: "started" | "progress" | "scored" | "cancelled" | "no_open_quiz" | "already_scored" | "unavailable";
  quizId: string | null;
  reply: string;
  reasons: Reason[];
  trace: TraceRow[];
  active: ActiveQuiz | null;
}

export const QUIZ_LIMIT_NOTE = "These questions check recall of the notes' wording, not problem solving.";
const NO_ANSWER = "(no answer)";
const PASS = /^(pass|skip|idk|i\s+don'?t\s+know|don'?t\s+know|no\s+idea|not\s+sure)$/i;

function logFor(deps: QuizDeps, studentId: string): QuizLogRow[] {
  return fs.existsSync(deps.quizLog) ? readQuizLog(deps.quizLog).filter((r) => r.studentId === studentId) : [];
}

const turn = (t: Omit<QuizTurn, "reasons" | "trace"> & Partial<Pick<QuizTurn, "reasons" | "trace">>): QuizTurn => ({ reasons: [], trace: [], ...t });

export function startQuiz(
  deps: QuizDeps,
  student: { studentId: string; topics: TopicState[]; daysToExam: number; corpora?: string[] },
  message: string
): QuizTurn {
  const allowed = deps.corpora.filter((c) => !student.corpora || student.corpora.includes(c.corpus));
  const ranked = rankTopics(student.topics, student.daysToExam);
  const named = ranked.find((t) => message.toLowerCase().includes(t.name.toLowerCase()));
  const covered = (topicId: string) => allowed.find((c) => CORPUS_TOPIC[c.corpus] === topicId);
  const quizzable = ranked.filter((t) => covered(t.topicId)).map((t) => t.name);
  if (named && !covered(named.topicId)) {
    return turn({
      kind: "unavailable",
      quizId: null,
      active: null,
      reply: `I have no notes for ${named.name} yet, so I can't quiz you on it. ${quizzable.length ? `I can quiz ${quizzable.join(", ")}: say "quiz me".` : ""}`.trim(),
      trace: [{ node: "quiz", detail: `no local notes for ${named.topicId}; no quiz started` }],
    });
  }
  const pick = named ?? ranked.find((t) => covered(t.topicId));
  if (!pick) {
    return turn({
      kind: "unavailable",
      quizId: null,
      active: null,
      reply: "I have no local notes for any topic in your study records, so I can't build a quiz yet.",
      trace: [{ node: "quiz", detail: `no corpus covers this student's topics (have: ${allowed.map((c) => c.corpus).join(", ") || "none"})` }],
    });
  }
  const corpus = covered(pick.topicId)!;
  const round = logFor(deps, student.studentId).filter((r) => r.quizId.startsWith(`quiz-${corpus.corpus}-`)).length;
  const quiz = buildQuiz(corpus, { n: 5, round, createdAt: deps.now() });
  const reply = [
    `Quiz ${quiz.id} on ${pick.name}: ${quiz.items.length} fill-in-the-blank questions cut from ${corpus.book} Ch ${corpus.chapter} notes (built by rules, no model). ${QUIZ_LIMIT_NOTE}`,
    ...quiz.items.map((it, i) => renderQuizItem(it, i)),
    `Answer with letters in order (e.g. "B, A, D, C, A") or one at a time ("Q2: B"). Say "pass" for one you don't know, or "cancel quiz" to stop. Nothing is saved until all ${quiz.items.length} are answered.`,
  ].join("\n");
  return turn({
    kind: "started",
    quizId: quiz.id,
    active: { quiz, answers: quiz.items.map(() => null) },
    reply,
    reasons: [{ text: `Quiz on ${pick.name}, the highest-priority topic that has local notes (priority ${pick.priority.toFixed(3)})`, ref: { kind: "data_row", id: pick.sourceRow } }],
    trace: [{ node: "quiz", detail: `started ${quiz.id} (round ${round}) on ${quiz.topicId}; ${quiz.items.length} items from ${corpus.corpus}`, refs: quiz.items.map((i) => `ncert:${i.chunkId}`) }],
  });
}

/** Reads answers from one message into the open quiz. Unreadable parts are reported, never guessed. */
export function parseAnswers(message: string, active: ActiveQuiz): { answers: (string | null)[]; filled: number[]; rejected: string[] } {
  const answers = [...active.answers];
  const items = active.quiz.items;
  let parts = message.split(/[,;\n]+/).map((p) => p.trim().replace(/[.!]+$/, "")).filter(Boolean);
  if (parts.length === 1 && /^([a-d]\s+)+[a-d]$/i.test(parts[0])) parts = parts[0].split(/\s+/);
  parts = parts.flatMap((p) => p.split(/\s+(?=q?\d+\s*[:.)=-])/i));
  const filled: number[] = [];
  const rejected: string[] = [];
  for (const part of parts) {
    const m = part.match(/^q?(\d+)\s*[:.)=-]?\s*(.+)$/i);
    const idx = m ? Number(m[1]) - 1 : answers.findIndex((a) => a === null);
    const raw = (m ? m[2] : part).trim();
    if (idx < 0 || idx >= items.length) {
      rejected.push(m ? `there is no Q${m[1]}` : `"${part}" (every question already has an answer)`);
      continue;
    }
    const opts = items[idx].options;
    const value = /^[a-d]$/i.test(raw)
      ? opts["abcd".indexOf(raw.toLowerCase())]
      : PASS.test(raw)
        ? NO_ANSWER
        : opts.find((o) => o.toLowerCase() === raw.toLowerCase());
    if (!value) {
      rejected.push(`"${raw}" is not one of the options for Q${idx + 1}`);
      continue;
    }
    answers[idx] = value;
    filled.push(idx);
  }
  return { answers, filled, rejected };
}

export function answerQuiz(deps: QuizDeps, studentId: string, active: ActiveQuiz | null, message: string, memory: StudentMemory | null): QuizTurn {
  if (!active) {
    const last = logFor(deps, studentId).at(-1);
    return turn({
      kind: last ? "already_scored" : "no_open_quiz",
      quizId: last?.quizId ?? null,
      active: null,
      reply: last
        ? `No quiz is open. Your last quiz ${last.quizId} was already scored ${last.correct}/${last.total} and saved once (${last.ref}); I did not count these answers again. Say "quiz me" for a new quiz.`
        : `No quiz is open, so I did not score that. Say "quiz me" to start one.`,
      reasons: last ? [{ text: `Quiz ${last.quizId} already recorded; repeated answers are not counted`, ref: { kind: "quiz", id: last.ref } }] : [],
      trace: [{ node: "quiz", detail: last ? `no open quiz; ${last.quizId} already in the quiz log, nothing written` : "no open quiz; nothing written", refs: last ? [last.ref] : [] }],
    });
  }
  const { quiz } = active;
  const p = parseAnswers(message, active);
  const open = p.answers.flatMap((a, i) => (a === null ? [`Q${i + 1}`] : []));
  const note = p.rejected.length && p.filled.length ? `I couldn't use: ${p.rejected.join("; ")}.` : "";
  if (open.length) {
    const got = p.filled.length ? `Got ${[...new Set(p.filled)].map((i) => `Q${i + 1}`).join(", ")}.` : "That doesn't look like an answer, so I left the quiz as it was.";
    return turn({
      kind: "progress",
      quizId: quiz.id,
      active: { quiz, answers: p.answers },
      reply: `${got} ${note} ${quiz.items.length - open.length}/${quiz.items.length} answered; still open: ${open.join(", ")}. Nothing is saved until all are answered, or say "cancel quiz".`.replace(/\s+/g, " "),
      trace: [{ node: "quiz", detail: `${quiz.id}: ${quiz.items.length - open.length}/${quiz.items.length} answered; ${p.rejected.length} unreadable part(s); nothing written` }],
    });
  }
  const out = submitQuiz(quiz, p.answers as string[], { studentId, records: deps.records, quizLog: deps.quizLog, takenAt: deps.now(), memory });
  if (out.kind === "already_recorded") {
    return turn({
      kind: "already_scored",
      quizId: quiz.id,
      active: null,
      reply: `Quiz ${quiz.id} was already scored ${out.row.correct}/${out.row.total} (${out.row.ref}); I did not count it again.`,
      trace: [{ node: "quiz", detail: `${quiz.id} already in the quiz log; nothing written`, refs: [out.row.ref] }],
    });
  }
  if (out.kind === "distress") {
    // The graph routes distress before this node; this is a second guard.
    return turn({ kind: "cancelled", quizId: quiz.id, active: null, reply: "Let's stop the quiz here.", trace: [{ node: "quiz", detail: `distress rules matched in an answer (ids only): ${out.ruleIds.join(", ")}; nothing written` }] });
  }
  const r = out.result;
  const lines = r.perItem.map((it, i) => {
    const item = quiz.items[i];
    const source = item.prompt.replace("_____", item.answer);
    return it.ok
      ? `Q${i + 1} correct: "${item.answer}" [${item.citation}]`
      : `Q${i + 1} wrong: you ${it.given === NO_ANSWER ? "passed" : `chose "${it.given}"`}; the answer is "${item.answer}". The note says: "${source}" [${item.citation}]`;
  });
  const missed = [...new Set(r.perItem.filter((x) => !x.ok).map((x) => x.chunkId))];
  const reply = [
    `Quiz ${quiz.id}: ${r.correct}/${r.total}.`,
    ...lines,
    `Saved: mastery ${out.record.masteryBefore} -> ${out.record.masteryAfter} (m = 0.7m + 0.3 x score) in ${out.record.recordRef}; quiz log ${out.record.logRef}; memory ${out.memoryId ?? "off (not written)"}.`,
    missed.length ? `Revise note${missed.length > 1 ? "s" : ""} ${missed.join(", ")} next.` : "No notes missed.",
    `${QUIZ_LIMIT_NOTE} Ask "plan my study for today" to see how this changes your plan.`,
  ].join("\n");
  return turn({
    kind: "scored",
    quizId: quiz.id,
    active: null,
    reply,
    reasons: [
      { text: `Scored ${r.correct}/${r.total} on quiz ${quiz.id}`, ref: { kind: "quiz", id: out.record.logRef } },
      { text: `Mastery ${out.record.masteryBefore} -> ${out.record.masteryAfter}`, ref: { kind: "data_row", id: out.record.recordRef } },
      ...(out.memoryId ? [{ text: "Quiz result stored in memory (score and missed notes, not typed answers)", ref: { kind: "memory" as const, id: out.memoryId } }] : []),
      ...[...new Set(quiz.items.map((i) => i.chunkId))].map((id) => ({ text: `Question cut from NCERT note ${id}`, ref: { kind: "ncert" as const, id } })),
    ],
    trace: [
      { node: "quiz", detail: `${quiz.id} scored ${r.correct}/${r.total} by exact match against the note word`, refs: quiz.items.map((i) => `ncert:${i.chunkId}`) },
      { node: "quiz", detail: `wrote mastery ${out.record.masteryBefore} -> ${out.record.masteryAfter}, quiz log row, ${out.memoryId ? `H-MEM ${out.memoryId}` : "no memory (off)"}`, refs: [out.record.recordRef, out.record.logRef, ...(out.memoryId ? [out.memoryId] : [])] },
    ],
  });
}

export function cancelQuiz(active: ActiveQuiz | null): QuizTurn {
  if (!active) return turn({ kind: "no_open_quiz", quizId: null, active: null, reply: "No quiz is open, so there is nothing to cancel.", trace: [{ node: "quiz", detail: "cancel: no open quiz" }] });
  const done = active.answers.filter((a) => a !== null).length;
  return turn({
    kind: "cancelled",
    quizId: active.quiz.id,
    active: null,
    reply: `Quiz ${active.quiz.id} cancelled with ${done}/${active.answers.length} answered. No score was saved; your mastery and records are unchanged.`,
    trace: [{ node: "quiz", detail: `${active.quiz.id} cancelled at ${done}/${active.answers.length}; nothing written` }],
  });
}
