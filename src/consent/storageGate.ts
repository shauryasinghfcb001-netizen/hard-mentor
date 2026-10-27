// No production grant issuer exists until parental verification and retention
// policy are approved. Synthetic capabilities are confined to newly-created
// OS temporary directories; a mock grant can never unlock a product data root.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const scopes = new Map<string, (studentId: string) => boolean>();
const sandboxes = new Set<string>();
const scopeGenerations = new Map<string, number>();
export class ConsentRequired extends Error {
  constructor() { super("Verified parental consent required; student storage is locked"); }
}
export function fictionalSandbox(prefix = "hm-fictional-", fixturesAuthorized = true): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), path.basename(prefix))));
  sandboxes.add(root);
  if (fixturesAuthorized) {
    fs.writeFileSync(path.join(root, ".fictional-fixture-only"), "synthetic fixtures only\n", { flag: "wx" });
    scopes.set(root, () => true);
  }
  return root;
}
export function setSimulatedAccess(root: string, validate: (studentId: string) => boolean): void {
  if (!sandboxes.has(root) || fs.existsSync(path.join(root, ".fictional-fixture-only"))) throw new ConsentRequired();
  scopeGenerations.set(root, (scopeGenerations.get(root) ?? 0) + 1);
  scopes.set(root, validate);
}
export function assertStudentStorage(file: string, studentId: string): void {
  const target = path.resolve(file);
  // Explicit fixture classification can be reopened by the separate-process
  // synthetic memory proof. A consent challenge never writes this marker.
  let parent = path.dirname(target);
  const temp = fs.realpathSync(os.tmpdir());
  while (parent.startsWith(temp + path.sep)) {
    if (fs.existsSync(path.join(parent, ".fictional-fixture-only")) && !scopes.has(parent)) {
      const real = fs.realpathSync(parent);
      if (real === parent) scopes.set(parent, () => true);
      break;
    }
    parent = path.dirname(parent);
  }
  for (const [root, validate] of scopes) {
    if (!target.startsWith(root + path.sep) || !validate(studentId)) continue;
    // Reject symlink escapes, including a symlink at an existing parent.
    let existing = target;
    while (!fs.existsSync(existing)) existing = path.dirname(existing);
    const real = fs.realpathSync(existing);
    if (real === root || real.startsWith(root + path.sep)) return;
  }
  throw new ConsentRequired();
}

const generations = new Map<string, Map<string, number>>();
export function storageGeneration(file: string, studentId: string): number {
  const target = path.resolve(file);
  for (const root of sandboxes) if (target.startsWith(root + path.sep)) return (scopeGenerations.get(root) ?? 0) * 1_000_000 + (generations.get(root)?.get(studentId) ?? 0);
  return 0;
}
export function invalidateStudentHandles(root: string, studentId: string): void {
  if (!sandboxes.has(root)) throw new ConsentRequired();
  let ids = generations.get(root);
  if (!ids) generations.set(root, ids = new Map());
  ids.set(studentId, (ids.get(studentId) ?? 0) + 1);
}
export function assertFictionalPath(root: string, file: string): void {
  if (!sandboxes.has(root) || !path.resolve(file).startsWith(root + path.sep)) throw new ConsentRequired();
  let existing = path.resolve(file);
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  const real = fs.realpathSync(existing);
  if (real !== root && !real.startsWith(root + path.sep)) throw new ConsentRequired();
}
