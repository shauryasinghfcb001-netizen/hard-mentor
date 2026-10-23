import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMentor, type StudentContext } from "../src/agent/graph.ts";
import { rulePlanner } from "../src/agent/planner.ts";
import { buildWhyCard } from "../src/agent/whyCard.ts";
import type { ChatModel } from "../src/llm/client.ts";
import { answerDoubt } from "../src/rag/doubt.ts";
import { bm25Retriever, checkCitations, groundQuestion, loadCorpus } from "../src/rag/ncert.ts";
import { RIYA, RIYA_DAYS_TO_EXAM, RIYA_TOPICS } from "../src/synthetic/riya.ts";

const corpus = loadCorpus(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "corpus", "ncert-phy12-ch1.json"));
const r = bm25Retriever(corpus);
const student: StudentContext = { studentId: RIYA.studentId, name: RIYA.name, hoursPerDay: RIYA.dailyStudyHours, daysToExam: RIYA_DAYS_TO_EXAM, topics: RIYA_TOPICS };

// The same 22 questions were used to set MIN_SCORE/MIN_COVERAGE, so this is a
// regression check, not a held-out accuracy measurement.
const IN: [string, string][] = [
  ["What is Coulomb's law?", "phy12-1-6"],
  ["State Gauss's law", "phy12-1-13"],
  ["What is quantisation of charge?", "phy12-1-5"],
  ["Why can two electric field lines never cross?", "phy12-1-9"],
  ["What is the torque on a dipole in a uniform electric field?", "phy12-1-12"],
  ["Define electric flux", "phy12-1-10"],
  ["What is the electric field inside a charged spherical shell?", "phy12-1-14"],
  ["What is the principle of superposition for forces between charges?", "phy12-1-7"],
  ["What is the difference between conductors and insulators?", "phy12-1-3"],
  ["What is an electric dipole moment?", "phy12-1-11"],
  ["Is charge conserved when a glass rod is rubbed with silk?", "phy12-1-4"], // top-3, see below
  ["What is the field of an infinite plane sheet of charge?", "phy12-1-14"],
];
const OUT = [
  "Who won the IPL in 2024?",
  "What is the mechanism of SN2 reaction?",
  "Explain photosynthesis",
  "How do I integrate x squared?",
  "What is Ohm's law?",
  "What is the lens formula?",
  "Explain Faraday's law of induction",
  "What is Newton's second law?",
  "What is the capital of France?",
  "How does a transistor work?",
];

test("corpus: 14 new-work chunks with valid page numbers (chapter PDF has 44 pages)", () => {
  assert.equal(corpus.chunks.length, 14);
  assert.match(corpus.provenance, /^NEW WORK/);
  assert.equal(new Set(corpus.chunks.map((c) => c.id)).size, 14);
  for (const c of corpus.chunks) {
    assert.ok(c.pages.length > 0 && c.pages.every((p) => Number.isInteger(p) && p >= 1 && p <= 44), c.id);
    assert.ok(c.text.length > 80, c.id);
  }
});

test("retrieval: 12/12 syllabus questions find the expected chunk in the top 3 (11 at rank 1)", () => {
  let top1 = 0;
  for (const [q, id] of IN) {
    const g = groundQuestion(r, q);
    assert.ok(g.inSyllabus, `${q}: ${g.reason}`);
    const ids = g.hits.map((h) => h.chunk.id);
    assert.ok(ids.includes(id), `${q}: expected ${id}, got ${ids.join(",")}`);
    if (ids[0] === id) top1++;
  }
  assert.equal(top1, 11);
});

test("out-of-syllabus gate refuses 10/10 off-chapter questions", () => {
  for (const q of OUT) assert.equal(groundQuestion(r, q).inSyllabus, false, q);
});

test("citation check: passes a grounded answer, catches invented chunk, wrong page, missing citation and off-topic text", () => {
  const chunk = corpus.chunks.find((c) => c.id === "phy12-1-6")!;
  const good = "Coulomb's law: the force between two point charges is proportional to the product of the charges and inversely proportional to the square of the distance.";
  assert.deepEqual(checkCitations(good, [{ chunkId: "phy12-1-6", pages: [6, 7] }], [chunk]), { ok: true, failures: [] });
  assert.match(checkCitations(good, [{ chunkId: "phy12-9-9", pages: [6] }], [chunk]).failures.join(), /not retrieved/);
  assert.match(checkCitations(good, [{ chunkId: "phy12-1-6", pages: [12] }], [chunk]).failures.join(), /pages 12 not in chunk/);
  assert.match(checkCitations(good, [], [chunk]).failures.join(), /no citation/);
  assert.match(checkCitations("Mitochondria make ATP for cellular respiration in animals.", [{ chunkId: "phy12-1-6", pages: [6] }], [chunk]).failures.join(), /shares \d+% of words/);
});

test("graph: a doubt gets an extractive NCERT answer with chapter and pages; the why card cites the chunk", async () => {
  const s = await runMentor({ planner: rulePlanner, memory: null, retriever: r }, student, "What is Coulomb's law?");
  assert.equal(s.intent, "doubt");
  assert.equal(s.outcome, "doubt_answered");
  assert.match(s.reply, /Source: NCERT Physics Part I, Class 12, Ch 1, §1\.5, pp\. 6-8\nWhy this note: it has the question's word pairs "coulomb law" close together; it contains coulomb, law\.$/);
  const card = buildWhyCard(s);
  assert.equal(card.decision, "doubt_extractive");
  assert.deepEqual(card.reasons.map((x) => x.ref), [{ kind: "ncert", id: "phy12-1-6" }]);
  assert.ok(s.trace.some((t) => t.detail.includes("extractive answer by bm25-extractive")));
});

test("graph: an out-of-syllabus doubt is refused, not answered", async () => {
  const s = await runMentor({ planner: rulePlanner, memory: null, retriever: r }, student, "What is Ohm's law?");
  assert.equal(s.outcome, "doubt_refused");
  assert.match(s.reply, /do not cover it|not covered/);
  assert.equal(buildWhyCard(s).reasons[0].ref.id, "out-of-syllabus");
});

function oneReply(text: string): ChatModel {
  return { provider: "fake", model: "scripted", chat: async () => ({ text, model: "scripted", provider: "fake", latencyMs: 1, attempts: 1 }) };
}

test("model doubt answer: passes when citations check out, falls back to extractive when they do not", async () => {
  const good = JSON.stringify({
    answer: "Gauss's law says the total electric flux through a closed surface equals the charge enclosed divided by epsilon_0.",
    citations: [{ chunkId: "phy12-1-13", pages: [29, 30] }],
  });
  const a = await answerDoubt(r, "State Gauss's law", oneReply(good));
  assert.equal(a.mode, "model");
  assert.equal(a.check?.ok, true);
  assert.match(a.text, /§1\.13, pp\. 29-30/);

  const invented = JSON.stringify({ answer: "Gauss's law relates flux and enclosed charge.", citations: [{ chunkId: "phy12-1-13", pages: [99] }] });
  const b = await answerDoubt(r, "State Gauss's law", oneReply(invented));
  assert.equal(b.mode, "extractive");
  assert.equal(b.check?.ok, false);
  assert.match(b.producedBy, /failed citation check: phy12-1-13: pages 99/);
});
