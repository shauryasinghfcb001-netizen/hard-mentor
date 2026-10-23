#!/bin/sh
# Forget proof (DECISIONS.md Q7/D15): save, restart and retrieve, check another
# student cannot see it, forget through the agent graph, restart and search
# every app-controlled file for the marker. Each step is a new Node process.
set -eu
ROOT="$(mktemp -d)"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p evidence
OUT="evidence/forget-proof-${STAMP}.txt"
for STEP in save retrieve isolation forget verify; do
  node --import tsx scripts/forget-proof.ts "$ROOT" "$STEP"
  echo
done 2>&1 | tee "$OUT"
{
  echo "--- independent grep for the marker under the data root ---"
  grep -rli "zephyr-77" "$ROOT" || echo "no file under the data root contains zephyr-77"
  echo "files: $(cd "$ROOT" && find . -type f | sort | tr '\n' ' ')"
  echo "data root: $ROOT"
  echo "evidence: $OUT (this file holds the marker text by design)"
} | tee -a "$OUT"
