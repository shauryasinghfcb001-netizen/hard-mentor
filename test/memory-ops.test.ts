import { fictionalSandbox } from "../src/consent/storageGate.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runMentor, type StudentContext } from "../src/agent/graph.ts";
import { rulePlanner } from "../src/agent/planner.ts";
import { buildWhyCard } from "../src/agent/whyCard.ts";
import { findCopies, listMemories, openStudentMemory, QUERY_NOT_STORED, rememberPattern } from "../src/memory/studentMemory.ts";
import { RIYA, RIYA_DAYS_TO_EXAM, RIYA_EVENING_SKIP_PATTERN, RIYA_SWAP_REQUEST, RIYA_TOPICS } from "../src/synthetic/riya.ts";

const student: StudentContext = { studentId: RIYA.studentId, name: RIYA.name, hoursPerDay: RIYA.dailyStudyHours, daysToExam: RIYA_DAYS_TO_EXAM, topics: RIYA_TOPICS };

async function seeded() {
  const dataRoot = fictionalSandbox("hm-memops-");
  const mem = await openStudentMemory(RIYA.studentId, { dataRoot, clock: () => Date.UTC(2026, 9, 23, 14) });
  const rec = rememberPattern(mem, RIYA_EVENING_SKIP_PATTERN);
  return { mem, dataRoot, memId: rec.id as string };
}

test("write-back: a planning turn stores an episode summary in H-MEM, not the raw message", async () => {
  const { mem, dataRoot } = await seeded();
  const s = await runMentor({ planner: rulePlanner, memory: mem }, student, RIYA_SWAP_REQUEST);
  const row = s.trace.find((t) => t.node === "write_back")!;
  assert.match(row.detail, /H-MEM episode mem-2 written/);

  // a fresh handle on the same directory sees it (persisted to state.json)
  const reopened = await openStudentMemory(RIYA.studentId, { dataRoot });
  const ep = listMemories(reopened).find((m) => m.id === "mem-2")!;
  assert.ok(ep.tags.includes("episode") && ep.tags.includes("decision:refuse_swap"));
  assert.equal(ep.content, "On 2026-10-23 the student sent a swap request; the mentor decided refuse_swap (sent) with plan topics physics:electrostatics, maths:integrals.");
  assert.ok(!ep.content.includes("too hard"), "raw student text is not stored");
});

test("write-back is skipped with memory off and after a distress override", async () => {
  const off = await runMentor({ planner: rulePlanner, memory: null }, student, RIYA_SWAP_REQUEST);
  assert.equal(off.trace.find((t) => t.node === "write_back")?.detail, "memory OFF: no write-back");

  const { mem } = await seeded();
  const d = await runMentor({ planner: rulePlanner, memory: mem }, student, "I can't take this anymore");
  assert.equal(d.outcome, "distress_override");
  assert.equal(listMemories(mem).length, 1, "nothing written for a distress turn");
});

test('"what do you remember" lists every H-MEM record for the student', async () => {
  const { mem, memId } = await seeded();
  const s = await runMentor({ planner: rulePlanner, memory: mem }, student, "What do you remember about me?");
  assert.equal(s.intent, "memory_list");
  assert.equal(s.outcome, "memory_op");
  assert.ok(s.reply.includes(RIYA_EVENING_SKIP_PATTERN.content) && s.reply.includes(`[${memId}]`));
  const card = buildWhyCard(s);
  assert.equal(card.decision, "memory_list");
  assert.deepEqual(card.reasons.map((r) => r.ref.id), [memId]);
});

test('"forget X" deletes the matching memory, and the swap decision changes back', async () => {
  const { mem, dataRoot, memId } = await seeded();
  const before = await runMentor({ planner: rulePlanner, memory: mem }, student, RIYA_SWAP_REQUEST);
  assert.equal(before.draft?.decision, "refuse_swap");

  const f = await runMentor({ planner: rulePlanner, memory: mem }, student, "Forget that I skipped Electrostatics.");
  assert.equal(f.intent, "memory_forget");
  assert.deepEqual(f.memoryOp?.items.map((m) => m.id), [memId], "only the skip pattern matches; the episode does not say 'skipped'");

  const reopened = await openStudentMemory(RIYA.studentId, { dataRoot });
  assert.ok(!listMemories(reopened).some((m) => m.id === memId), "gone from state.json");

  const after = await runMentor({ planner: rulePlanner, memory: reopened }, student, RIYA_SWAP_REQUEST);
  assert.equal(after.draft?.decision, "compromise", "without the memory the mentor no longer refuses");

  // Q7: the ledger keeps a tombstone (id, time, status) and no copy of the text.
  const hist = reopened.hmem.ledger.history(memId);
  assert.deepEqual(hist.map((e: any) => e.action), ["create", "read", "delete"]);
  assert.ok(hist.slice(0, 2).every((e: any) => e.redacted && !e.newState && !e.previousState && !e.details));
  assert.deepEqual(hist[2].details, { status: "forgotten" });
  assert.deepEqual(findCopies(reopened, "skipped her evening Electrostatics"), []);
});

test("recall never writes the student's message to the ledger", async () => {
  const { mem, dataRoot } = await seeded();
  await runMentor({ planner: rulePlanner, memory: mem }, student, RIYA_SWAP_REQUEST);
  const ledger = fs.readFileSync(path.join(dataRoot, RIYA.studentId, "ledger.jsonl"), "utf-8");
  assert.ok(ledger.includes(QUERY_NOT_STORED));
  assert.ok(!ledger.includes("feel too hard"), "raw message not in ledger.jsonl");
});

test('"forget X" with no match deletes nothing; memory off says so', async () => {
  const { mem } = await seeded();
  const s = await runMentor({ planner: rulePlanner, memory: mem }, student, "forget my cricket scores");
  assert.equal(s.memoryOp?.items.length, 0);
  assert.equal(listMemories(mem).length, 1);
  const off = await runMentor({ planner: rulePlanner, memory: null }, student, "What do you remember about me?");
  assert.match(off.reply, /Memory is off/);
});
