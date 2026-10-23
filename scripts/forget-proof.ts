// One step of the forget proof. scripts/forget-proof.sh runs each step in a
// new Node process, so every step after "save" reads H-MEM back from disk.
// Synthetic data only: "Tara" and "Kabir" are fictional demo students.
//
//   node --import tsx scripts/forget-proof.ts <dataRoot> <save|retrieve|isolation|forget|verify>

import path from "node:path";
import { runMentor, type StudentContext } from "../src/agent/graph.ts";
import { rulePlanner } from "../src/agent/planner.ts";
import { findCopies, listMemories, openStudentMemory, recall, rememberPattern } from "../src/memory/studentMemory.ts";

const MARKER = "Zephyr-77";
const FACT = `Tara (fictional) keeps a purple abacus named ${MARKER} on her desk and only revises Integrals after using it.`;
const QUERY = `Which abacus does Tara use, ${MARKER}?`;
const OWNER = "demo-tara";
const OTHER = "demo-kabir";

function show(label: string, value: unknown): void {
  console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
}

async function main(): Promise<void> {
  const [root, step] = process.argv.slice(2);
  const dataRoot = path.resolve(root);
  console.log(`--- step ${step} (pid ${process.pid}) ---`);
  const mem = await openStudentMemory(step === "isolation" ? OTHER : OWNER, { dataRoot });
  show("student", mem.studentId);
  show("engine", mem.engineSource);

  if (step === "save") {
    const rec = rememberPattern(mem, { content: FACT, subject: "maths", topic: "integrals", source: "synthetic:forget-proof", synthetic: true });
    show("saved", `${rec.id}: ${rec.content}`);
  } else {
    const found = recall(mem, QUERY).memories.map((r: any) => `${r.memory.id} (relevance ${r.relevance.toFixed(3)})`);
    show("H-MEM query hits", found);
    show("records listed", listMemories(mem).map((m) => m.id));
  }

  if (step === "forget") {
    const student: StudentContext = { studentId: OWNER, name: "Tara (fictional)", hoursPerDay: 3, daysToExam: 120, topics: [] };
    const s = await runMentor({ planner: rulePlanner, memory: mem }, student, `Forget ${MARKER}`);
    show("intent", s.intent);
    console.log(`reply:\n${s.reply}`);
  }

  show(`files under ${mem.studentId}/ containing "${MARKER}"`, findCopies(mem, MARKER));
  if (step === "verify" || step === "forget") {
    for (const e of mem.hmem.ledger.all() as any[]) console.log(`ledger: ${JSON.stringify(e)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
