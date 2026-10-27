// Provenance plumbing for the why card. OFFLINE MOCK - no Zetaris, no network, no model.
// The "supplied provenance" strings below are test fixtures, not evidence of any live query.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { MentorState } from "../src/agent/graph.ts";
import { buildWhyCard, renderWhyCard } from "../src/agent/whyCard.ts";

const student = { studentId: "riya", name: "Riya (fictional)", hoursPerDay: 3, daysToExam: 120, topics: [] };
const base = {
  outcome: "sent",
  draft: { decision: "swap", reasons: [{ text: "Mastery is low", ref: { kind: "data_row", id: "csv:study-records.csv#2" } }] },
  trace: [{ node: "plan", detail: "ranked 3 topics" }],
};
const state = (extra: Record<string, unknown>) => ({ ...base, student: { ...student, ...extra } }) as unknown as MentorState;

// No provenance must make no claim about connector availability.
const GOLDEN_NO_PROVENANCE = [
  "Decision: swap (sent)",
  "Why:",
  "  - Mastery is low  [data_row: csv:study-records.csv#2]",
  "Loop:",
  "  1. [plan] ranked 3 topics",
  "SQL: (not available for this turn; see source provenance)",
].join("\n");

describe("OFFLINE MOCK - not Zetaris connection evidence: why card provenance", () => {
  test("no provenance (CSV default): card reports missing per-turn SQL honestly", () => {
    const card = buildWhyCard(state({}));
    assert.equal(renderWhyCard(card), GOLDEN_NO_PROVENANCE);
    assert.equal(card.sql, null);
    assert.ok(!("source" in card));
  });

  test("provenance with sql null shows the supplied source and keeps the no-SQL line", () => {
    const card = buildWhyCard(state({ provenance: { source: "local CSV study-records.csv (synthetic)", sql: null } }));
    assert.equal(card.sql, null);
    assert.equal(card.source, "local CSV study-records.csv (synthetic)");
    assert.equal(renderWhyCard(card), GOLDEN_NO_PROVENANCE.replace("SQL:", "Source: local CSV study-records.csv (synthetic)\nSQL:"));
  });

  test("supplied provenance displays exactly that source and SQL", () => {
    const sql = "SELECT topic_id FROM t WHERE student_id = 'x' ORDER BY topic_id";
    const card = buildWhyCard(state({ provenance: { source: "MOCK FIXTURE source", sql } }));
    assert.equal(card.sql, sql);
    assert.equal(card.source, "MOCK FIXTURE source");
    const out = renderWhyCard(card);
    assert.ok(out.endsWith(`Source: MOCK FIXTURE source\nSQL: ${sql}`));
    assert.ok(!out.includes("not available"));
  });

  test("provenance never changes decision, outcome, reasons or loop", () => {
    const a = buildWhyCard(state({}));
    const b = buildWhyCard(state({ provenance: { source: "s", sql: "q" } }));
    const { sql: _s, source: _o, ...restB } = b;
    const { sql: _s2, ...restA } = a;
    assert.deepEqual(restB, { ...restA, ...{} });
  });
});
