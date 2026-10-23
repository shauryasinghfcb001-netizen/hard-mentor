// Two-process memory proof. Run `write` in one process, let it exit, then run
// `read` in a fresh process against the same data root. Each mode prints one
// JSON line so the test (and the evidence log) can compare them.
//
//   npx tsx scripts/riya-memory-proof.ts write <dataRoot>
//   npx tsx scripts/riya-memory-proof.ts read  <dataRoot>

import fs from "node:fs";
import path from "node:path";
import { openStudentMemory, recall, rememberPattern } from "../src/memory/studentMemory.ts";
import { RIYA, RIYA_EVENING_SKIP_PATTERN, RIYA_PATTERN_QUERY } from "../src/synthetic/riya.ts";

async function main(): Promise<void> {
  const [mode, dataRoot] = process.argv.slice(2);
  if (!dataRoot || (mode !== "write" && mode !== "read")) {
    console.error("usage: riya-memory-proof.ts write|read <dataRoot>");
    process.exit(2);
  }
  const mem = await openStudentMemory(RIYA.studentId, { dataRoot: path.resolve(dataRoot) });

  if (mode === "write") {
    const record = rememberPattern(mem, RIYA_EVENING_SKIP_PATTERN);
    print({ mode, pid: process.pid, engineSource: mem.engineSource, memoryId: record.id, content: record.content, source: record.source, stateFile: path.join(mem.dir, "state.json") });
    return;
  }

  const result = recall(mem, RIYA_PATTERN_QUERY);
  const ledger = mem.hmem.ledger.all().map((e: any) => ({ memoryId: e.memoryId, action: e.action, actor: e.actor }));
  print({
    mode,
    pid: process.pid,
    engineSource: mem.engineSource,
    stateFileExisted: fs.existsSync(path.join(mem.dir, "state.json")),
    query: RIYA_PATTERN_QUERY,
    memories: result.memories.map((r: any) => ({ id: r.memory.id, relevance: Number(r.relevance.toFixed(4)), content: r.memory.content, source: r.memory.source, tags: r.memory.tags })),
    trace: result.trace,
    ledger,
  });
}

function print(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
