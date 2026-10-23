// Milestone 1: Riya's study pattern written by one process is retrieved by a
// second, separate process through real H-MEM (vendor/hmem), with trace and
// ledger. A third process on an empty store is the memory-off control.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts", "riya-memory-proof.ts");

function run(mode: "write" | "read", dataRoot: string): any {
  const out = execFileSync(process.execPath, ["--import", "tsx", script, mode, dataRoot], { cwd: root, encoding: "utf-8" });
  return JSON.parse(out.trim().split("\n").pop()!);
}

test("Riya's pattern survives process restart via H-MEM", () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hm-riya-"));
  const written = run("write", dataRoot);
  const read = run("read", dataRoot);

  assert.notEqual(written.pid, read.pid, "write and read must be separate processes");
  assert.equal(written.engineSource, "vendor/hmem");
  assert.equal(read.engineSource, "vendor/hmem");
  assert.equal(read.stateFileExisted, true);

  const hit = read.memories.find((m: any) => m.id === written.memoryId);
  assert.ok(hit, `second process must retrieve ${written.memoryId}; got ${JSON.stringify(read.memories)}`);
  assert.equal(hit.content, written.content);
  assert.equal(hit.source, "synthetic:riya-seed");
  assert.ok(hit.tags.includes("synthetic"));
  assert.match(read.trace.retrievalReason, /hybrid ranking/);
  assert.ok(read.trace.scores[written.memoryId] > 0);

  const actions = read.ledger.filter((e: any) => e.memoryId === written.memoryId).map((e: any) => e.action);
  assert.deepEqual(actions.slice(0, 2), ["create", "read"]);

  fs.writeFileSync(path.join(dataRoot, "proof.json"), JSON.stringify({ written, read }, null, 2));
  console.log(`evidence: ${path.join(dataRoot, "proof.json")}`);
});

test("memory-off control: empty store retrieves nothing", () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "hm-riya-off-"));
  const read = run("read", empty);
  assert.equal(read.stateFileExisted, false);
  assert.equal(read.memories.length, 0);
});
