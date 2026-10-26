import { test } from "node:test";
import assert from "node:assert/strict";
import { isVerifiedProductProposal } from "../scripts/verify-product-path.ts";

const valid = {
  modelProvider: "meterless",
  modelRouted: "meterless/auto",
  proposalStatus: "validated",
  rawModelSnippet: '{"decision":"daily_plan"}',
  source: "Zetaris baseline + local attempt log (Zetaris table hard_mentor.study_records)",
  sql: "SELECT topic_id FROM hard_mentor.study_records",
};

test("product verification gate accepts only a validated Meterless proposal with Zetaris evidence", () => {
  assert.equal(isVerifiedProductProposal(valid), true);
});

test("product verification gate rejects rule fallbacks and missing Zetaris evidence", () => {
  assert.equal(isVerifiedProductProposal({ ...valid, producedBy: "rule-planner-v1 (rules; model rejected: malformed)" }), false);
  assert.equal(isVerifiedProductProposal({ ...valid, proposalStatus: "rejected" }), false);
  assert.equal(isVerifiedProductProposal({ ...valid, source: undefined }), false);
  assert.equal(isVerifiedProductProposal({ ...valid, sql: null }), false);
});
