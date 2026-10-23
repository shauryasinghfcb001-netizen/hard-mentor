// Held-out evaluation (DECISIONS.md D18). Runs the frozen cases in
// eval/heldout-cases.json through the real graph: rule intent, BM25 + gate,
// rule planner, real H-MEM. No model is called, so these numbers measure the
// rule/retrieval system only, not any model's accuracy.
//
// Separate from `npm test`: a failing case here is a measured miss, not a
// regression. Run with `npm run eval:heldout`. With HM_EVAL_OUT set, the
// per-case results are written there as JSON.

import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMentor, type StudentContext } from "../src/agent/graph.ts";
import { rulePlanner } from "../src/agent/planner.ts";
import { buildWhyCard } from "../src/agent/whyCard.ts";
import { csvStudyData } from "../src/data/studyData.ts";
import { openStudentMemory, rememberPattern } from "../src/memory/studentMemory.ts";
import { bm25Retriever, loadCorpus } from "../src/rag/ncert.ts";
import { RIYA, RIYA_DAYS_TO_EXAM, RIYA_EVENING_SKIP_PATTERN } from "../src/synthetic/riya.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const casesFile = path.join(root, "eval", "heldout-cases.json");
const raw = fs.readFileSync(casesFile);
const cases = JSON.parse(raw.toString("utf-8"));
const retriever = bm25Retriever(loadCorpus(path.join(root, "corpus", "ncert-phy12-ch1.json")));
const topics = (await csvStudyData(path.join(root, "seed", "study-records.csv")).topicsFor(RIYA.studentId)).rows;
const student: StudentContext = { studentId: RIYA.studentId, name: RIYA.name, hoursPerDay: RIYA.dailyStudyHours, daysToExam: RIYA_DAYS_TO_EXAM, topics };

// Unrelated pattern for the control case: a skip pattern on a topic other
// than the one being swapped away from.
const SEEDS = {
  "riya-electrostatics-skip": RIYA_EVENING_SKIP_PATTERN,
  "riya-integrals-skip": {
    content: "Riya skipped Integrals practice twice this week and watched videos instead.",
    subject: "maths",
    topic: "integrals",
    source: "synthetic:heldout-control",
    synthetic: true,
  },
} as const;

interface Row {
  category: string;
  q: string;
  pass: boolean;
  got: string;
}
const rows: Row[] = [];

function record(category: string, q: string, pass: boolean, got: string): void {
  rows.push({ category, q, pass, got });
  assert.ok(pass, got);
}

for (const category of ["doubt_paraphrase", "doubt_word_variant"]) {
  describe(category, () => {
    for (const c of cases[category].cases) {
      test(c.q, async () => {
        const s = await runMentor({ planner: rulePlanner, memory: null, retriever }, student, c.q);
        const top3 = s.doubt?.grounding.hits.map((h) => h.chunk.id) ?? [];
        const pass = s.outcome === "doubt_answered" && top3.some((id) => c.accept.includes(id));
        record(category, c.q, pass, `intent ${s.intent}, outcome ${s.outcome}, top3 [${top3.join(", ")}], accept [${c.accept.join(", ")}]`);
      });
    }
  });
}

describe("off_chapter", () => {
  for (const c of cases.off_chapter.cases) {
    test(c.q, async () => {
      const s = await runMentor({ planner: rulePlanner, memory: null, retriever }, student, c.q);
      record("off_chapter", c.q, s.outcome !== "doubt_answered", `intent ${s.intent}, outcome ${s.outcome}${s.doubt ? `, gate: ${s.doubt.grounding.reason}` : ""}`);
    });
  }
});

describe("memory_on_off", () => {
  for (const c of cases.memory_on_off.cases) {
    test(c.q, async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hm-heldout-"));
      const mem = await openStudentMemory(RIYA.studentId, { dataRoot: dir });
      const seeded = rememberPattern(mem, SEEDS[c.seed as keyof typeof SEEDS]);
      const on = await runMentor({ planner: rulePlanner, memory: mem }, student, c.q);
      const off = await runMentor({ planner: rulePlanner, memory: null }, student, c.q);
      const memRefs = (s: typeof on) => buildWhyCard(s).reasons.filter((r) => r.ref.kind === "memory").map((r) => r.ref.id);
      const onOk = c.control ? on.draft?.decision !== "refuse_swap" : on.draft?.decision === "refuse_swap" && memRefs(on).includes(seeded.id);
      const offOk = off.draft?.decision !== "refuse_swap" && memRefs(off).length === 0;
      fs.rmSync(dir, { recursive: true, force: true });
      record(
        "memory_on_off",
        c.q,
        onOk && offOk,
        `${c.control ? "control; " : ""}intent ${on.intent}; ON ${on.draft?.decision} refs [${memRefs(on).join(", ")}]; OFF ${off.draft?.decision} refs [${memRefs(off).join(", ")}]`
      );
    });
  }
});

describe("distress_extra", () => {
  for (const c of cases.distress_extra.cases) {
    test(c.q, async () => {
      const s = await runMentor({ planner: rulePlanner, memory: null, retriever }, student, c.q);
      record("distress_extra", c.q, (s.outcome === "distress_override") === c.distress, `expected distress ${c.distress}; intent ${s.intent}, outcome ${s.outcome}`);
    });
  }
});

after(() => {
  const by: Record<string, { pass: number; total: number }> = {};
  for (const r of rows) {
    by[r.category] ??= { pass: 0, total: 0 };
    by[r.category].total++;
    if (r.pass) by[r.category].pass++;
  }
  const summary = {
    at: new Date().toISOString(),
    casesSha256: crypto.createHash("sha256").update(raw).digest("hex"),
    system: "rules + BM25 + real H-MEM; no model called",
    scores: by,
    rows,
  };
  console.log("\nHELD-OUT SCORES (no model called):");
  for (const [k, v] of Object.entries(by)) console.log(`  ${k}: ${v.pass}/${v.total}`);
  if (process.env.HM_EVAL_OUT) fs.writeFileSync(process.env.HM_EVAL_OUT, JSON.stringify(summary, null, 2) + "\n");
});
