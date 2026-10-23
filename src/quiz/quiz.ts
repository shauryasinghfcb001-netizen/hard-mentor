// Quiz from the NCERT notes (blueprint section 6, feature 5: quiz -> mastery).
// Fill-in-the-blank items are cut from note sentences: the blanked word is the
// sentence's rarest content word across the chapter notes, so every answer is
// a word printed in the cited note. No model is called. Distractors are the
// blanked words of other notes. Questions check recall of the notes' wording,
// not problem solving; that is a known limit.

import { detectDistress } from "../core/distress.ts";
import { citeChunk, stem, tokenize, type Chunk, type Corpus } from "../rag/ncert.ts";

export interface QuizItem {
  id: string;
  chunkId: string;
  citation: string;
  prompt: string;
  options: string[];
  answer: string;
}

export interface Quiz {
  id: string;
  topicId: string;
  corpus: string;
  createdAt: string;
  items: QuizItem[];
}

export interface QuizResult {
  quizId: string;
  topicId: string;
  correct: number;
  total: number;
  score: number;
  perItem: { id: string; chunkId: string; given: string; answer: string; ok: boolean }[];
}

/** Which local note corpus covers which study-record topic. Only Ch 1 exists today. */
export const CORPUS_TOPIC: Record<string, string> = { "ncert-phy12-ch1": "physics:electrostatics" };

interface Candidate {
  chunk: Chunk;
  sentence: string;
  word: string;
  df: number;
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter((s) => !/[=^]/.test(s) && s.split(/\s+/).length >= 8 && s.split(/\s+/).length <= 40);
}

/** The best blank in each note: the rarest content word (5+ letters) that occurs once in its sentence. */
function candidates(corpus: Corpus): Candidate[] {
  const df = new Map<string, number>();
  for (const c of corpus.chunks) for (const t of new Set(tokenize(c.text))) df.set(t, (df.get(t) ?? 0) + 1);
  const out: Candidate[] = [];
  for (const chunk of corpus.chunks) {
    let best: Candidate | null = null;
    for (const sentence of sentences(chunk.text)) {
      const ws = sentence.match(/[A-Za-z]+/g) ?? [];
      for (const w of ws) {
        if (w.length < 5 || w !== w.toLowerCase()) continue;
        const t = tokenize(w)[0];
        if (!t) continue;
        if (ws.filter((x) => stem(x.toLowerCase()) === t).length !== 1) continue;
        const d = df.get(t) ?? 99;
        if (!best || d < best.df || (d === best.df && w.length > best.word.length)) best = { chunk, sentence, word: w, df: d };
      }
    }
    if (best) out.push(best);
  }
  return out;
}

/**
 * Builds an n-item quiz. `round` rotates which notes are used, so a second
 * quiz on the same topic asks about different notes when there are enough.
 */
export function buildQuiz(corpus: Corpus, opts: { n?: number; round?: number; createdAt: string }): Quiz {
  const topicId = CORPUS_TOPIC[corpus.corpus];
  if (!topicId) throw new Error(`no study-record topic is mapped to corpus ${corpus.corpus}`);
  const pool = candidates(corpus);
  const n = Math.min(opts.n ?? 5, pool.length);
  const start = ((opts.round ?? 0) * n) % pool.length;
  const picked = Array.from({ length: n }, (_, i) => pool[(start + i) % pool.length]);
  const id = `quiz-${corpus.corpus}-${opts.createdAt.slice(0, 10)}-r${opts.round ?? 0}`;
  const items = picked.map((c, i) => {
    const others = pool
      .filter((o) => o.word.toLowerCase() !== c.word.toLowerCase() && !c.sentence.toLowerCase().includes(o.word.toLowerCase()))
      .map((o) => o.word);
    // deterministic distractor choice: spread through the pool from this item's position
    const distractors = [...new Set(others)].filter((_, j, arr) => j % Math.max(1, Math.floor(arr.length / 3)) === i % Math.max(1, Math.floor(arr.length / 3))).slice(0, 3);
    const options = [c.word, ...distractors].sort((a, b) => a.localeCompare(b));
    return {
      id: `${id}#${i + 1}`,
      chunkId: c.chunk.id,
      citation: citeChunk(corpus, c.chunk),
      prompt: c.sentence.replace(new RegExp(`\\b${c.word}\\b`), "_____"),
      options,
      answer: c.word,
    };
  });
  return { id, topicId, corpus: corpus.corpus, createdAt: opts.createdAt, items };
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z]/g, "");

export type GradeOutcome = { kind: "graded"; result: QuizResult } | { kind: "distress"; ruleIds: string[] };

/**
 * Grades answers (option text, or the letter A-D). Answers are checked for
 * distress first: if any answer matches, nothing is graded or written back,
 * and only rule ids are returned, never the answer text.
 */
export function gradeQuiz(quiz: Quiz, answers: string[]): GradeOutcome {
  const flagged = answers.map((a) => detectDistress(a)).filter((d) => d.distress);
  if (flagged.length) return { kind: "distress", ruleIds: [...new Set(flagged.flatMap((d) => d.matched))] };
  const perItem = quiz.items.map((item, i) => {
    const raw = (answers[i] ?? "").trim();
    const letter = /^[a-d]$/i.test(raw) ? item.options["abcd".indexOf(raw.toLowerCase())] : undefined;
    const given = letter ?? raw;
    return { id: item.id, chunkId: item.chunkId, given, answer: item.answer, ok: norm(given) === norm(item.answer) };
  });
  const correct = perItem.filter((p) => p.ok).length;
  return { kind: "graded", result: { quizId: quiz.id, topicId: quiz.topicId, correct, total: perItem.length, score: perItem.length ? correct / perItem.length : 0, perItem } };
}

export function renderQuizItem(item: QuizItem, i: number): string {
  return `Q${i + 1}. ${item.prompt}\n    ${item.options.map((o, j) => `${"ABCD"[j]}) ${o}`).join("   ")}\n    [from ${item.citation}]`;
}
