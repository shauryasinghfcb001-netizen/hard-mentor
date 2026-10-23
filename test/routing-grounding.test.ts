import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyIntent, runMentor, type StudentContext } from "../src/agent/graph.ts";
import { rulePlanner } from "../src/agent/planner.ts";
import type { ChatModel } from "../src/llm/client.ts";
import { answerDoubt } from "../src/rag/doubt.ts";
import { bm25Retriever, checkCitations, groundQuestion, loadCorpus } from "../src/rag/ncert.ts";
import { RIYA, RIYA_DAYS_TO_EXAM, RIYA_TOPICS } from "../src/synthetic/riya.ts";
import { DEV_OUT, DEV_PLAN, DEV_VALID } from "./fixtures/rag-dev.ts";

const corpus = loadCorpus(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "corpus", "ncert-phy12-ch1.json"));
const r = bm25Retriever(corpus);
const student: StudentContext = { studentId: RIYA.studentId, name: RIYA.name, hoursPerDay: RIYA.dailyStudyHours, daysToExam: RIYA_DAYS_TO_EXAM, topics: RIYA_TOPICS };

test("dev: valid Ch 1 questions route to doubt, are answered, and the answering chunk is an accepted one (not blanket refusal)", () => {
  for (const c of DEV_VALID) {
    const g = groundQuestion(r, c.q);
    assert.equal(classifyIntent(c.q, r).intent, "doubt", c.q);
    assert.ok(g.inSyllabus, `${c.q}: ${g.reason}`);
    assert.ok(c.accept.includes(g.hits[0].chunk.id), `${c.q}: got ${g.hits[0].chunk.id}`);
  }
});

test("dev: questions that share Ch 1 words but need other chapters are refused with a scope-limit explanation", async () => {
  for (const q of DEV_OUT) assert.equal(groundQuestion(r, q).inSyllabus, false, q);
  const s = await runMentor({ planner: rulePlanner, memory: null, retriever: r }, student, "What is the electric potential energy of a system of charges?");
  assert.equal(s.outcome, "doubt_refused");
  assert.match(s.reply, /electric potential and potential energy/);
  assert.match(s.reply, /do not cover it/);
});

test("dev: planning questions are not hijacked by the textbook route", () => {
  for (const q of DEV_PLAN) assert.ok(["plan", "swap_request"].includes(classifyIntent(q, r).intent), q);
});

function model(answer: string, chunkId: string, pages: number[]): ChatModel {
  const text = JSON.stringify({ answer, citations: [{ chunkId, pages }] });
  return { provider: "fake", model: "scripted", chat: async () => ({ text, model: "scripted", provider: "fake", latencyMs: 1, attempts: 1 }) };
}

test("citations must support the answer: real pages on the wrong chunk fall back to extractive", async () => {
  // Gauss's law answer citing the Coulomb chunk with that chunk's real pages.
  const wrong = await answerDoubt(r, "State Gauss's law", model("Gauss's law says the total flux through a closed surface equals the enclosed charge over epsilon_0.", "phy12-1-6", [6, 7]));
  assert.equal(wrong.mode, "extractive");
  assert.equal(wrong.check?.ok, false);
});

test("citations must support the answer: an invented number is caught", () => {
  const chunk = corpus.chunks.find((c) => c.id === "phy12-1-6")!;
  const ck = checkCitations("Coulomb's law gives the force between point charges, with k about 7 x 10^3.", [{ chunkId: chunk.id, pages: [6] }], [chunk], 0.3, { question: "What is Coulomb's law?", retriever: r });
  assert.match(ck.failures.join(), /number/);
});

test("citations must support the answer: a decorative second citation is caught", () => {
  const a = corpus.chunks.find((c) => c.id === "phy12-1-13")!;
  const b = corpus.chunks.find((c) => c.id === "phy12-1-3")!;
  const ck = checkCitations(
    "Gauss's law: the total electric flux through any closed surface equals the enclosed charge divided by epsilon_0.",
    [{ chunkId: a.id, pages: [29] }, { chunkId: b.id, pages: [3] }],
    [a, b],
    0.3,
    { question: "State Gauss's law", retriever: r }
  );
  assert.match(ck.failures.join(), /phy12-1-3: contributes no distinctive term/);
});

test("grounded model answer with matching citation still passes (no blanket rejection)", async () => {
  const a = await answerDoubt(r, "State Gauss's law", model("Gauss's law: the total electric flux through any closed surface equals the charge enclosed divided by epsilon_0.", "phy12-1-13", [29, 30]));
  assert.equal(a.mode, "model");
  assert.equal(a.check?.ok, true);
});
