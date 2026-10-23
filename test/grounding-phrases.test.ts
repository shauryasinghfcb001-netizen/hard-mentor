// Phrase-level evidence in grounding (DECISIONS.md D22). The questions here
// were written after the change and before it was run on them. First run:
// 12/14; the request verb "Write" was then added to the filler words and the
// first word of a question was excluded from the narrowed-phrase rule, so this
// file is a regression check from then on, not a measurement. Same author as
// the code. Frozen v2 strings are not repeated here.

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { answerDoubt } from "../src/rag/doubt.ts";
import { bm25Retriever, groundQuestion, loadCorpus } from "../src/rag/ncert.ts";

const r = bm25Retriever(loadCorpus(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "corpus", "ncert-phy12-ch1.json")));

const VALID: [string, string[]][] = [
  ["Write Coulomb's law for two point charges in vector form", ["phy12-1-6"]],
  ["What is the field due to a long straight charged wire?", ["phy12-1-14"]],
  ["Which way does the field of a positive charge point?", ["phy12-1-8", "phy12-1-9"]],
  ["What is the electric field of an infinite plane sheet?", ["phy12-1-14"]],
  ["What is the flux through a closed surface with no enclosed charge?", ["phy12-1-13"]],
  ["What is the torque on an electric dipole placed in a uniform field?", ["phy12-1-12"]],
  ["Is the field inside a charged spherical shell zero?", ["phy12-1-14"]],
];

const UNSUPPORTED = [
  "What is the field of a finite line charge?",
  "What is the field on the axis of a charged ring?",
  "What is the field of a non-uniform charged sphere?",
  "What is the field inside a solid charged sphere?",
  "What is the force between two charges inside water?",
  "What is the electric field of a finite plane sheet?",
];

// Known limit, not asserted: "adding" matches the additivity note (§1.4) more strongly
// than "another charge" matches superposition (§1.7), and the question is refused.
export const KNOWN_LIMITS = ["Does adding another charge nearby change the force between the first two?"];

test("phrase evidence: valid Ch 1 questions are answered from a note that states their phrases", () => {
  for (const [q, accept] of VALID) {
    const g = groundQuestion(r, q);
    assert.ok(g.inSyllabus, `${q}: ${g.reason}`);
    assert.ok(accept.includes(g.hits[0].chunk.id), `${q}: got ${g.hits[0].chunk.id}`);
    assert.equal(g.support?.chunkId, g.hits[0].chunk.id);
  }
});

test("phrase evidence: questions the notes do not support are refused, not answered from a related note", () => {
  for (const q of UNSUPPORTED) assert.equal(groundQuestion(r, q).inSyllabus, false, q);
});

test("a known phrase narrowed by a word the notes never use is refused with a coverage-limit explanation", async () => {
  const a = await answerDoubt(r, "What is the field of a finite line charge?", null);
  assert.equal(a.mode, "refusal");
  assert.match(a.text, /"finite line charge" \(the notes never say "finite"\)/);
  assert.match(a.text, /do not cover it/);
  assert.equal(a.citations.length, 0);
});

test("a word in a different phrase does not count as the same thing: 'line charge' is not answered from the field-lines note", () => {
  const g = groundQuestion(r, "What is the field due to a long straight charged wire?");
  assert.equal(g.hits[0].chunk.id, "phy12-1-14");
  assert.ok(g.support!.phrases.includes("charged wire"));
});

test("an extractive answer says why its note was chosen", async () => {
  const a = await answerDoubt(r, "What is the electric field of an infinite plane sheet?", null);
  assert.equal(a.mode, "extractive");
  assert.match(a.text, /Why this note: it has the question's word pairs .*"plane sheet".* close together; it contains /);
});
