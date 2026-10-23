#!/bin/sh
# Human-readable version of the milestone 1 test: two separate node processes
# against a fresh data root. Output is saved under evidence/.
set -eu
ROOT="$(mktemp -d)"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p evidence
OUT="evidence/riya-memory-proof-${STAMP}.jsonl"
node --import tsx scripts/riya-memory-proof.ts write "$ROOT" | tee "$OUT"
node --import tsx scripts/riya-memory-proof.ts read "$ROOT" | tee -a "$OUT"
echo "data root: $ROOT"
echo "evidence: $OUT"
