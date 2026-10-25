// Explicit proof that memory is absent from model prompts when memory is off (control condition).
// Tested using mocked model and synthetic test data; no network access.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runMentor, type StudentContext } from "../src/agent/graph.ts";
import { buildPlannerPrompt, createModelPlanner } from "../src/agent/modelPlanner.ts";
import { RIYA_TOPICS } from "../src/synthetic/riya.ts";
import type { ChatModel, ChatMessage, ChatResult } from "../src/llm/client.ts";
import type { PlannerInput } from "../src/agent/planner.ts";

function createCapturingModel(replyJson: string, capturedPrompts: string[]): ChatModel {
  return {
    provider: "meterless",
    model: "meterless/auto",
    async chat(messages: ChatMessage[]): Promise<ChatResult> {
      for (const m of messages) {
        if (m.role === "user") capturedPrompts.push(m.content);
      }
      return {
        text: replyJson,
        model: "meterless/auto",
        provider: "meterless",
        latencyMs: 10,
        attempts: 1,
      };
    },
  };
}

test("buildPlannerPrompt: memories are completely absent when memories list is empty (memory off)", () => {
  const input: PlannerInput = {
    name: "Riya (fictional)",
    hoursPerDay: 3,
    message: "Plan my study for today.",
    intent: "plan",
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
    memories: [], // memory off
    attempt: 1,
    feedback: [],
  };

  const prompt = buildPlannerPrompt(input);

  // Proves memory section is strictly "- (none)"
  assert.match(prompt, /Memories:\n- \(none\)/);
  assert.ok(!prompt.includes("[memory "));
  assert.ok(!prompt.includes("mem-"));
  assert.ok(!prompt.includes("tags:"));
});

test("buildPlannerPrompt: memories ARE present when memories list is provided (memory on)", () => {
  const input: PlannerInput = {
    name: "Riya (fictional)",
    hoursPerDay: 3,
    message: "Can I do Optics instead?",
    intent: "plan",
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
    memories: [
      {
        id: "mem-skip-123",
        content: "Student skipped Electrostatics on Tuesday evening",
        tags: ["skip", "evening"],
        relevance: 0.95,
      },
    ],
    attempt: 1,
    feedback: [],
  };

  const prompt = buildPlannerPrompt(input);

  assert.ok(!prompt.includes("Memories:\n- (none)"));
  assert.match(prompt, /\[memory mem-skip-123\] \(tags: skip, evening\) Student skipped Electrostatics on Tuesday evening/);
});

test("graph runMentor: memory=null guarantees prompt sent to ChatModel has no memories", async () => {
  const captured: string[] = [];
  const validDraft = {
    decision: "daily_plan",
    blocks: [{ topicId: "physics:electrostatics", minutes: 90, activity: "NCERT examples" }],
    message: "Focus on Electrostatics first.",
    reasons: [{ text: "Top priority weak topic", ref: { kind: "data_row", id: "fixture:riya_topics#1" } }],
  };

  const model = createCapturingModel(JSON.stringify(validDraft), captured);
  const planner = createModelPlanner(model, {}, { validate: true });
  const student: StudentContext = {
    studentId: "riya",
    name: "Riya (fictional)",
    hoursPerDay: 3,
    daysToExam: 120,
    topics: RIYA_TOPICS,
  };

  // memory is explicitly null (memory off)
  const result = await runMentor({ planner, memory: null }, student, "Plan my study for today.");

  assert.equal(result.outcome, "sent");
  assert.equal(captured.length, 1);
  const sentPrompt = captured[0];

  // Assert prompt has zero memory items
  assert.match(sentPrompt, /Memories:\n- \(none\)/);
  assert.ok(!sentPrompt.includes("[memory "));
  assert.ok(!sentPrompt.includes("mem-"));
  assert.ok(!sentPrompt.includes("tags:"));
});
