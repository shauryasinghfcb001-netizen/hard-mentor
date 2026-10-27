import { fictionalSandbox } from "../src/consent/storageGate.ts";
// Regression tests for wiring and failure cases:
// 1. Meterless adapter failure handling & fallback
// 2. Zetaris opt-in fail-closed behavior (no silent CSV fallback)
// 3. Model validation rejection handling & rule-baseline fallback

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { converse, type ConversationEnv } from "../src/agent/conversation.ts";
import { createModelPlanner, plannerFromEnv } from "../src/agent/modelPlanner.ts";
import { rulePlanner } from "../src/agent/planner.ts";
import { validateModelDraft } from "../src/agent/modelSafety.ts";
import { fixtureResearch } from "../src/context/fixtureExams.ts";
import { zetarisStudyData } from "../src/data/zetarisStudyData.ts";
import { meterlessChatModel } from "../src/llm/meterless.ts";
import { openStudentMemory } from "../src/memory/studentMemory.ts";
import { bm25Retriever, loadCorpus } from "../src/rag/ncert.ts";
import { RIYA } from "../src/synthetic/riya.ts";
import type { ChatModel, ChatMessage, ChatResult } from "../src/llm/client.ts";

function stubChatModel(reply: string | Error): ChatModel {
  return {
    provider: "meterless",
    model: "meterless/auto",
    async chat(_messages: ChatMessage[]): Promise<ChatResult> {
      if (reply instanceof Error) throw reply;
      return {
        text: reply,
        model: "meterless/auto",
        provider: "meterless",
        latencyMs: 5,
        attempts: 1,
      };
    },
  };
}

function makeTestEnv(dir: string, planner = rulePlanner): ConversationEnv {
  const records = path.join(dir, "study-records.csv");
  fs.copyFileSync("seed/study-records.csv", records);
  const corpus = loadCorpus("corpus/ncert-phy12-ch1.json");
  return {
    planner,
    retriever: bm25Retriever(corpus),
    research: fixtureResearch,
    corpora: [corpus],
    records,
    quizLog: path.join(dir, "quiz-log.csv"),
    sessionsDir: path.join(dir, "sessions"),
    async memoryFor(id) {
      return openStudentMemory(id, { dataRoot: path.join(dir, "students"), clock: () => Date.now() });
    },
    now: () => "2026-10-25T10:00:00Z",
  };
}

test("Meterless failure case: network error falls back cleanly to rule baseline", async () => {
  const failingModel = stubChatModel(new Error("connect ECONNREFUSED 127.0.0.1:8088"));
  const planner = createModelPlanner(failingModel, {}, { validate: true });

  const input = {
    name: "Riya (fictional)",
    hoursPerDay: 3,
    message: "Plan my day",
    intent: "plan" as const,
    ranked: [
      {
        topicId: "physics:electrostatics",
        subject: "Physics",
        name: "Electrostatics",
        mastery: 0.35,
        marksWeight: 0.8,
        priority: 0.65,
        urgency: 1.25,
        sourceRow: "fixture:riya_topics#1",
      },
    ],
    memories: [],
    attempt: 1,
    feedback: [],
  };

  const draft = await planner.draft(input);
  assert.ok(draft.producedBy?.includes("rules; model failed: connect ECONNREFUSED"));
  assert.equal(draft.blocks[0].topicId, "physics:electrostatics");
  assert.equal(draft.comparison?.proposal.status, "model_error");
});

test("Validation failure case: invalid topic or over time falls back to rule baseline", () => {
  const ctx = {
    rows: [
      {
        topicId: "physics:electrostatics",
        subject: "Physics",
        name: "Electrostatics",
        mastery: 0.35,
        marksWeight: 0.8,
        priority: 0.65,
        sourceRow: "row-1",
      },
    ],
    hoursPerDay: 1, // 60 min budget
    memories: [],
  };

  // Over budget draft (120 min > 60 min)
  const overTime = JSON.stringify({
    decision: "daily_plan",
    blocks: [{ topicId: "physics:electrostatics", minutes: 120, activity: "Study" }],
    message: "Two hours on electrostatics",
    reasons: [{ text: "Weak", ref: { kind: "data_row", id: "row-1" } }],
  });
  const v1 = validateModelDraft(overTime, ctx);
  assert.equal(v1.ok, false);
  if (!v1.ok) {
    assert.ok(v1.issues.some((i) => i.code === "over_time"));
  }

  // Unknown topic draft
  const unknownTopic = JSON.stringify({
    decision: "daily_plan",
    blocks: [{ topicId: "physics:quantum_gravity", minutes: 30, activity: "Study" }],
    message: "Study quantum gravity",
    reasons: [{ text: "Interesting", ref: { kind: "data_row", id: "row-1" } }],
  });
  const v2 = validateModelDraft(unknownTopic, ctx);
  assert.equal(v2.ok, false);
  if (!v2.ok) {
    assert.ok(v2.issues.some((i) => i.code === "unknown_topic"));
  }
});

test("Zetaris failure case: unconfigured Zetaris throws 'Zetaris unavailable' without calling network", async () => {
  const ds = zetarisStudyData({ env: {} });
  await assert.rejects(
    async () => ds.topicsFor("riya"),
    (err: Error) => {
      assert.equal(err.message, "Zetaris unavailable: not configured");
      return true;
    }
  );
});

test("Zetaris fail-closed wiring: converse() returns 'Zetaris unavailable' on failure, never silent CSV fallback", async () => {
  const origSource = process.env.HM_STUDY_SOURCE;
  process.env.HM_STUDY_SOURCE = "zetaris";
  try {
    const dir = fictionalSandbox("hm-wire-fail-");
    const env = makeTestEnv(dir);
    const profile = { studentId: RIYA.studentId, name: RIYA.name, hoursPerDay: RIYA.dailyStudyHours };

    // Set session stage to ready so converse() attempts to read topics from Zetaris
    fs.mkdirSync(path.join(dir, "sessions"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "sessions", "riya.json"),
      JSON.stringify({
        studentId: profile.studentId,
        stage: "ready",
        intake: { step: "exam", goal: {} },
        exam: {
          exam: { id: "cbse_12", name: "CBSE Class 12", body: "CBSE", country: "IN" },
          goal: { exam: "CBSE Class 12" },
          corpora: ["ncert-phy12-ch1"],
          facts: [],
          research: { kind: "fixture" },
        },
        activeQuiz: null,
        lastPlan: null,
      })
    );

    // Zetaris is unconfigured, so converse() must fail closed
    const res = await converse(env, profile, "Plan my study for today.");
    assert.equal(res.reply, "Zetaris unavailable");
    assert.equal(res.state, null);
    assert.equal(res.why, null);
  } finally {
    if (origSource !== undefined) process.env.HM_STUDY_SOURCE = origSource;
    else delete process.env.HM_STUDY_SOURCE;
  }
});
