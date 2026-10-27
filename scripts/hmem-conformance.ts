import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const suite = path.join(root, "vendor/hmem-conformance");
const source = JSON.parse(fs.readFileSync(path.join(suite, "SOURCE.json"), "utf8"));
if (source.commit !== fs.readFileSync(path.join(root, "vendor/HMEM_SOURCE_COMMIT"), "utf8").trim()) {
  throw new Error("H-MEM suite and engine pins differ");
}
for (const [name, entry] of Object.entries(source.files) as [string, { sha256: string }][]) {
  const actual = createHash("sha256").update(fs.readFileSync(path.join(suite, name))).digest("hex");
  if (actual !== entry.sha256) throw new Error(`upstream conformance file changed: ${name}`);
}
console.log(`Unmodified upstream conformance suite at ${source.commit}; product engine loader; in-memory synthetic vectors only.`);
const result = spawnSync(process.execPath, ["--import", "tsx", path.join(suite, "runner.ts")], {
  cwd: root,
  env: { ...process.env, HMEM_IMPL: path.join(root, "scripts/hmem-product-engine.ts") },
  stdio: "inherit",
  timeout: 30_000,
});
if (result.error) throw result.error;
process.exit(result.status ?? 2);
