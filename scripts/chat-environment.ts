// Shared by the interactive CLI and the loopback recording surface.
import fs from "node:fs";
import path from "node:path";
import type { ConversationEnv } from "../src/agent/conversation.ts";
import type { Planner } from "../src/agent/planner.ts";
import { fixtureResearch } from "../src/context/fixtureExams.ts";
import type { ResearchSource } from "../src/context/examContext.ts";
import { assertStudentStorage } from "../src/consent/storageGate.ts";
import { openStudentMemory, type StudentMemory } from "../src/memory/studentMemory.ts";
import { bm25Retriever, loadCorpus } from "../src/rag/ncert.ts";

export function chatEnvironment(root: string, today: string, planner: Planner, research: ResearchSource = fixtureResearch): ConversationEnv {
  const records = path.join(root, "study-records.csv");
  assertStudentStorage(records, "riya");
  fs.mkdirSync(root, { recursive: true });
  if (!fs.existsSync(records)) fs.copyFileSync("seed/study-records.csv", records);
  let t = Date.parse(`${today}T09:00:00Z`);
  const clock = () => (t += 60_000);
  const corpus = loadCorpus("corpus/ncert-phy12-ch1.json");
  const memories = new Map<string, StudentMemory>();
  return {
    planner, retriever: bm25Retriever(corpus), research, corpora: [corpus], records,
    quizLog: path.join(root, "quiz-log.csv"), sessionsDir: path.join(root, "sessions"),
    async memoryFor(id) {
      if (!memories.has(id)) memories.set(id, await openStudentMemory(id, { dataRoot: path.join(root, "students"), clock }));
      return memories.get(id)!;
    },
    now: () => new Date(clock()).toISOString(),
  };
}
