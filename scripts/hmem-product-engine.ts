// Conformance uses the same engine loader as openStudentMemory. No store is
// opened here; the upstream runner creates only its in-memory test instances.
import { loadHMEM } from "../src/engine.ts";
export const { HMEM } = await loadHMEM();
