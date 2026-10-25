// Tests for topic alias mapping and rejecting template echo in model planner outputs.
// Offline mock-tested; no network access.

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateModelDraft } from "../src/agent/modelSafety.ts";
import { createTopicAliases, mapAliasesToCanonical } from "../scripts/live-loop.ts";
import { RIYA_TOPICS } from "../src/synthetic/riya.ts";

test("alias mapping: replaces T1..T4 aliases with canonical topicId and sourceRow", () => {
  const aliasMap = createTopicAliases(RIYA_TOPICS);
  assert.equal(aliasMap.size, RIYA_TOPICS.length);
  assert.equal(aliasMap.get("T1")?.topicId, "physics:electrostatics");
  assert.equal(aliasMap.get("T1")?.sourceRow, "fixture:riya_topics#1");

  const rawModelReply = JSON.stringify({
    decision: "daily_plan",
    blocks: [
      { topicId: "T1", minutes: 90, activity: "NCERT examples" },
      { topicId: "T2", minutes: 45, activity: "Integration problems" },
    ],
    message: "Electrostatics first, then Integrals.",
    reasons: [
      { text: "Top priority weak topic", ref: { kind: "data_row", id: "T1" } },
      { text: "Secondary priority", ref: { kind: "data_row", id: "T2" } },
    ],
  });

  const canonical = mapAliasesToCanonical(rawModelReply, aliasMap);
  const parsed = JSON.parse(canonical);

  assert.equal(parsed.blocks[0].topicId, "physics:electrostatics");
  assert.equal(parsed.blocks[1].topicId, "chemistry:organic");
  assert.equal(parsed.reasons[0].ref.id, "fixture:riya_topics#1");
  assert.equal(parsed.reasons[1].ref.id, "fixture:riya_topics#2");

  // Validate that the mapped output passes validateModelDraft
  const validation = validateModelDraft(canonical, {
    rows: RIYA_TOPICS,
    hoursPerDay: 3,
    memories: [],
  });

  assert.equal(validation.ok, true);
});

test("reject template echo: validateModelDraft strictly rejects pipe-separated template echo in decision", () => {
  const templateEcho = JSON.stringify({
    decision: "daily_plan|refuse_swap|compromise|nothing_due",
    blocks: [
      { topicId: "physics:electrostatics", minutes: 90, activity: "NCERT examples" },
    ],
    message: "Here is your plan.",
    reasons: [
      { text: "Electrostatics weak", ref: { kind: "data_row", id: "fixture:riya_topics#1" } },
    ],
  });

  const validation = validateModelDraft(templateEcho, {
    rows: RIYA_TOPICS,
    hoursPerDay: 3,
    memories: [],
  });

  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.equal(validation.issues[0].code, "malformed");
    assert.match(validation.issues[0].detail, /decision/);
  }
});

test("reject template echo: validateModelDraft strictly rejects placeholder values like '...'", () => {
  const placeholderEcho = JSON.stringify({
    decision: "daily_plan",
    blocks: [
      { topicId: "...", minutes: 90, activity: "..." },
    ],
    message: "...",
    reasons: [
      { text: "...", ref: { kind: "data_row", id: "..." } },
    ],
  });

  const validation = validateModelDraft(placeholderEcho, {
    rows: RIYA_TOPICS,
    hoursPerDay: 3,
    memories: [],
  });

  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.ok(validation.issues.some((i) => i.code === "unknown_topic" || i.code === "missing_evidence"));
  }
});
