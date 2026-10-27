import { ConsentRequired, storageGeneration, assertStudentStorage } from "../consent/storageGate.ts";
// Per-student H-MEM store. One persistDir per student (data/students/<id>/),
// so state.json + ledger.jsonl for Riya never mix with another student's.
// This is the memory spine every later feature (planner, checker, why card)
// reads from and writes back to.

import fs from "node:fs";
import path from "node:path";
import { loadHMEM } from "../engine.ts";

const STUDENT_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export interface StudentMemory {
  studentId: string;
  dir: string;
  engineSource: string;
  generation: number;
  hmem: any;
}

export function studentDir(dataRoot: string, studentId: string): string {
  if (!STUDENT_ID.test(studentId)) throw new Error(`invalid student id: ${JSON.stringify(studentId)}`);
  return path.join(dataRoot, studentId);
}

export async function openStudentMemory(
  studentId: string,
  opts: { dataRoot: string; clock?: () => number }
): Promise<StudentMemory> {
  const dir = studentDir(opts.dataRoot, studentId);
  assertStudentStorage(dir, studentId);
  const generation = storageGeneration(dir, studentId);
  const { HMEM, source } = await loadHMEM();
  assertStudentStorage(dir, studentId);
  if (generation !== storageGeneration(dir, studentId)) throw new ConsentRequired();
  const hmem = new HMEM({ persistDir: dir, clock: opts.clock, actor: "hard-mentor" });
  return { studentId, dir, engineSource: source, hmem, generation };
}

export interface StudyPattern {
  content: string;
  subject: string;
  topic: string;
  source: string;
  synthetic: boolean;
}

// Patterns are stored verbatim with explicit provenance rather than mined, so
// the why card can point at an exact, auditable record.
export function rememberPattern(mem: StudentMemory, p: StudyPattern) {
  assertStudentStorage(mem.dir, mem.studentId);
  if (mem.generation !== storageGeneration(mem.dir, mem.studentId)) throw new ConsentRequired();
  return mem.hmem.add({
    content: p.content,
    type: "personal",
    layer: "working",
    tags: [`student:${mem.studentId}`, "pattern", `subject:${p.subject}`, `topic:${p.topic}`, ...(p.synthetic ? ["synthetic"] : [])],
    source: p.source,
    provenance: { origin: "manual", learnedAt: mem.hmem.clock(), label: p.synthetic ? "synthetic seed (fictional student)" : p.source },
  });
}

// Privacy layer over the vendored ledger (DECISIONS.md D15). H-MEM logs the
// full query text on every "read" entry and full record snapshots on
// create/update/delete. These helpers edit those entries in memory and
// rewrite ledger.jsonl so it keeps ids, actions and times but no query text
// and nothing from a forgotten record. This gives up H-MEM's append-only
// property for those fields; the entries themselves stay, in order.
function rewriteLedger(mem: StudentMemory): void {
  const file = path.join(mem.dir, "ledger.jsonl");
  const tmp = `${file}.tmp`;
  const lines = (mem.hmem.ledger.all() as any[]).map((e) => JSON.stringify(e) + "\n").join("");
  fs.writeFileSync(tmp, lines, "utf-8");
  fs.renameSync(tmp, file);
}

export const QUERY_NOT_STORED = "[query not stored]";

/** Retrieval without keeping the query: the raw student message never reaches ledger.jsonl. */
export function recall(mem: StudentMemory, query: string, opts?: { topN?: number; threshold?: number }) {
  assertStudentStorage(mem.dir, mem.studentId);
  if (mem.generation !== storageGeneration(mem.dir, mem.studentId)) throw new ConsentRequired();
  const before = mem.hmem.ledger.all().length;
  const res = mem.hmem.query(query, { threshold: opts?.threshold ?? 0.1, topN: opts?.topN });
  const fresh = (mem.hmem.ledger.all() as any[]).slice(before).filter((e) => e.details?.query !== undefined);
  for (const e of fresh) e.details.query = QUERY_NOT_STORED;
  if (fresh.length) rewriteLedger(mem);
  return res;
}

export interface MemoryItem {
  id: string;
  content: string;
  tags: string[];
  source: string;
}

/** "What do you remember about me?": every active record in this student's store, oldest first. */
export function listMemories(mem: StudentMemory): MemoryItem[] {
  assertStudentStorage(mem.dir, mem.studentId);
  if (mem.generation !== storageGeneration(mem.dir, mem.studentId)) throw new ConsentRequired();
  return (mem.hmem.store.all() as any[])
    .filter((r) => r.tags.includes(`student:${mem.studentId}`))
    .sort((a, b) => Number(a.id.slice(4)) - Number(b.id.slice(4)))
    .map((r) => ({ id: r.id, content: r.content, tags: [...r.tags], source: r.source }));
}

/**
 * "Forget X": deletes every record whose id equals X, or whose content holds
 * all of X's words. The record leaves state.json, links to it are dropped,
 * and every earlier ledger entry for it loses its snapshot and details. The
 * only new ledger line is a tombstone: id, time and status "forgotten".
 * H-MEM's own store.delete is not used, because it logs the full content.
 */
export function forgetMatching(mem: StudentMemory, target: string): MemoryItem[] {
  assertStudentStorage(mem.dir, mem.studentId);
  if (mem.generation !== storageGeneration(mem.dir, mem.studentId)) throw new ConsentRequired();
  const words = target.toLowerCase().split(/[^a-z0-9-]+/).filter((w) => w.length > 2 && !["the", "about", "that", "this", "and", "you", "please"].includes(w));
  const hit = (m: MemoryItem) =>
    m.id === target.trim() || (words.length > 0 && words.every((w) => m.content.toLowerCase().includes(w) || m.tags.some((t) => t.toLowerCase().includes(w))));
  const gone = listMemories(mem).filter(hit);
  if (!gone.length) return gone;

  const ids = new Set(gone.map((m) => m.id));
  const snap = mem.hmem.store.snapshotAll();
  const kept = snap.records
    .filter((r: any) => !ids.has(r.id))
    .map((r: any) => ({ ...r, relatedTo: r.relatedTo.filter((x: string) => !ids.has(x)) }));
  mem.hmem.store.restoreAll(kept, snap.seq); // rewrites state.json without the records

  for (const e of mem.hmem.ledger.all() as any[]) {
    if (!ids.has(e.memoryId)) continue;
    delete e.previousState;
    delete e.newState;
    delete e.details;
    e.redacted = true;
  }
  for (const id of ids) mem.hmem.ledger.log(id, "delete", "hard-mentor", { details: { status: "forgotten" } });
  rewriteLedger(mem);
  return gone;
}

/** Every file under the student's directory that still contains `text` (case-insensitive), with a count. */
export function findCopies(mem: StudentMemory, text: string): { file: string; count: number }[] {
  assertStudentStorage(mem.dir, mem.studentId);
  if (mem.generation !== storageGeneration(mem.dir, mem.studentId)) throw new ConsentRequired();
  const needle = text.toLowerCase();
  const out: { file: string; count: number }[] = [];
  for (const name of fs.readdirSync(mem.dir)) {
    const body = fs.readFileSync(path.join(mem.dir, name), "utf-8").toLowerCase();
    const count = body.split(needle).length - 1;
    if (count) out.push({ file: name, count });
  }
  return out;
}

export interface Episode {
  intent: string;
  decision: string;
  topTopic?: string;
  topics: string[];
  outcome: string;
}

export interface QuizMemory {
  quizId: string;
  topicId: string;
  correct: number;
  total: number;
  masteryBefore: number;
  masteryAfter: number;
  /** note ids whose items were answered wrongly: what to revise next */
  missedNotes: string[];
  logRef: string;
}

// Quiz write-back. Stores the score, the mastery change and which notes were
// missed, never the student's typed answers.
export function rememberQuizResult(mem: StudentMemory, q: QuizMemory) {
  assertStudentStorage(mem.dir, mem.studentId);
  if (mem.generation !== storageGeneration(mem.dir, mem.studentId)) throw new ConsentRequired();
  const day = new Date(mem.hmem.clock()).toISOString().slice(0, 10);
  const content =
    `On ${day} the student scored ${q.correct}/${q.total} on quiz ${q.quizId} (${q.topicId}); mastery ${q.masteryBefore} -> ${q.masteryAfter}` +
    (q.missedNotes.length ? `; missed notes ${q.missedNotes.join(", ")}.` : "; no notes missed.");
  return mem.hmem.add({
    content,
    type: "personal",
    layer: "working",
    tags: [`student:${mem.studentId}`, "quiz", `topic:${q.topicId.split(":")[1] ?? q.topicId}`],
    source: q.logRef,
    provenance: { origin: "manual", learnedAt: mem.hmem.clock(), label: "quiz result written by the quiz step" },
  });
}

// Write-back after a turn. Stores a summary built from the graph's decision,
// not the raw student message, so free text the student typed is not kept.
export function rememberEpisode(mem: StudentMemory, e: Episode) {
  assertStudentStorage(mem.dir, mem.studentId);
  if (mem.generation !== storageGeneration(mem.dir, mem.studentId)) throw new ConsentRequired();
  const day = new Date(mem.hmem.clock()).toISOString().slice(0, 10);
  const content =
    `On ${day} the student sent a ${e.intent.replace("_", " ")}; the mentor decided ${e.decision} (${e.outcome})` +
    (e.topics.length ? ` with plan topics ${e.topics.join(", ")}.` : ".");
  return mem.hmem.add({
    content,
    type: "personal",
    layer: "working",
    tags: [`student:${mem.studentId}`, "episode", `decision:${e.decision}`, ...(e.topTopic ? [`topic:${e.topTopic.split(":")[1] ?? e.topTopic}`] : [])],
    source: "hard-mentor:turn",
    provenance: { origin: "manual", learnedAt: mem.hmem.clock(), label: "turn summary written by the graph" },
  });
}
