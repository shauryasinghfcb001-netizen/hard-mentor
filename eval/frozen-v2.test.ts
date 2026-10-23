// Frozen internal set v2 (DECISIONS.md D20). Run ONCE after the fixes; a second
// run is refused unless HM_FROZEN_FORCE=1 (a forced rerun is not a first result).
// Internal synthetic evaluation by the same author: not independent validation,
// not clinical validation, not evidence of learning gains. No model is called.
// Distress cases are reported by id and rule ids only; their wording is never
// written to the output.

import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMentor, type StudentContext } from "../src/agent/graph.ts";
import type { Planner } from "../src/agent/planner.ts";
import { detectDistress } from "../src/core/distress.ts";
import { csvStudyData } from "../src/data/studyData.ts";
import { bm25Retriever, loadCorpus, type Retriever } from "../src/rag/ncert.ts";
import { RIYA, RIYA_DAYS_TO_EXAM } from "../src/synthetic/riya.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const raw = fs.readFileSync(path.join(root, "eval", "frozen-v2-cases.json"));
const cases = JSON.parse(raw.toString("utf-8"));
const outFile = process.env.HM_EVAL_OUT;
const prior = fs.readdirSync(path.join(root, "evidence")).filter((f) => f.startsWith("frozen-v2-run-"));
if (prior.length && process.env.HM_FROZEN_FORCE !== "1") throw new Error(`frozen set already run (${prior.join(", ")}); set HM_FROZEN_FORCE=1 to rerun (not a first result)`);

const base = bm25Retriever(loadCorpus(path.join(root, "corpus", "ncert-phy12-ch1.json")));
const topics = (await csvStudyData(path.join(root, "seed", "study-records.csv")).topicsFor(RIYA.studentId)).rows;
const student: StudentContext = { studentId: RIYA.studentId, name: RIYA.name, hoursPerDay: RIYA.dailyStudyHours, daysToExam: RIYA_DAYS_TO_EXAM, topics };
const rulePlannerImport = (await import("../src/agent/planner.ts")).rulePlanner;

interface Row { category: string; id: string; pass: boolean; note: string }
const rows: Row[] = [];
const rec = (category: string, id: string, pass: boolean, note: string) => {
  rows.push({ category, id, pass, note });
  assert.ok(pass, `${id}: ${note}`);
};

describe("distress_positive", () => {
  for (const c of cases.distress_positive.cases) {
    test(c.id, async () => {
      let planCalls = 0;
      let retrieveCalls = 0;
      const planner: Planner = { name: "spy", kind: "rules", draft: async (i) => (planCalls++, rulePlannerImport.draft(i)) };
      const spy: Retriever = { ...base, retrieve: (q, k) => (retrieveCalls++, base.retrieve(q, k)) };
      const s = await runMentor({ planner, memory: null, retriever: spy }, student, c.q);
      const ids = detectDistress(c.q).matched;
      const pass = s.outcome === "distress_override" && planCalls === 0 && retrieveCalls === 0;
      rec("distress_positive", c.id, pass, `outcome ${s.outcome}; rule ids [${ids.join(",")}]; planner calls ${planCalls}; retrieval calls ${retrieveCalls}${c.bypass ? `; bypass:${c.bypass}` : ""}`);
    });
  }
});

describe("distress_negative", () => {
  for (const c of cases.distress_negative.cases) {
    test(c.id, async () => {
      const s = await runMentor({ planner: rulePlannerImport, memory: null, retriever: base }, student, c.q);
      rec("distress_negative", c.id, s.outcome !== "distress_override", `outcome ${s.outcome}; rule ids [${detectDistress(c.q).matched.join(",")}]; text: ${c.q}`);
    });
  }
});

describe("doubt_valid", () => {
  for (const c of cases.doubt_valid.cases) {
    test(c.id, async () => {
      const s = await runMentor({ planner: rulePlannerImport, memory: null, retriever: base }, student, c.q);
      const cited = s.doubt?.citations[0]?.chunkId ?? "none";
      rec("doubt_valid", c.id, s.intent === "doubt" && s.outcome === "doubt_answered" && c.accept.includes(cited), `intent ${s.intent}; outcome ${s.outcome}; cited ${cited}; accept [${c.accept.join(",")}]; text: ${c.q}`);
    });
  }
});

describe("scope_negative", () => {
  for (const c of cases.scope_negative.cases) {
    test(c.id, async () => {
      const s = await runMentor({ planner: rulePlannerImport, memory: null, retriever: base }, student, c.q);
      const explains = /do not cover it|does not support|not covered/.test(s.reply);
      rec("scope_negative", c.id, s.outcome !== "doubt_answered", `intent ${s.intent}; outcome ${s.outcome}; scope explanation ${explains}; gate: ${s.doubt?.grounding.reason ?? "n/a"}; text: ${c.q}`);
    });
  }
});

describe("plan_not_doubt", () => {
  for (const c of cases.plan_not_doubt.cases) {
    test(c.id, async () => {
      const s = await runMentor({ planner: rulePlannerImport, memory: null, retriever: base }, student, c.q);
      rec("plan_not_doubt", c.id, ["plan", "swap_request"].includes(s.intent) && !s.outcome.startsWith("doubt"), `intent ${s.intent}; outcome ${s.outcome}; text: ${c.q}`);
    });
  }
});

describe("memory_intents", () => {
  for (const c of cases.memory_intents.cases) {
    test(c.id, async () => {
      const s = await runMentor({ planner: rulePlannerImport, memory: null, retriever: base }, student, c.q);
      rec("memory_intents", c.id, s.intent === c.intent, `intent ${s.intent}; expected ${c.intent}; text: ${c.q}`);
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
    label:
      process.env.HM_FROZEN_FORCE === "1"
        ? "REGRESSION rerun of v2, an internal development set (its failures were reviewed while changing the code on 2026-10-23); not held-out accuracy; same author; distress rows are synthetic routing coverage, not clinical reliability; no model called"
        : "internal synthetic evaluation, same author, run once after fixes; not independent or clinical validation; no model called",
    forced: process.env.HM_FROZEN_FORCE === "1",
    scores: by,
    failures: rows.filter((r) => !r.pass),
    rows,
  };
  console.log("\nFROZEN V2 SCORES:");
  for (const [k, v] of Object.entries(by)) console.log(`  ${k}: ${v.pass}/${v.total}`);
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(summary, null, 2) + "\n");
});
