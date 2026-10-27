# H-MEM conformance verification, Oct 26

`npm run test:hmem-conformance` ran the unmodified upstream conformance runner
and vectors at `1742dec56a66e58eef9dda2d2b865823758ca8cd`, the revision already
pinned in `vendor/HMEM_SOURCE_COMMIT`. All 13 checks passed. This is the actual
upstream conformance suite, not the vendored smoke tests.

The runner and vectors were missing because setup copied only upstream's
`reference/` directory. They now live in `vendor/hmem-conformance/` with source
paths and SHA-256 hashes in `SOURCE.json`. The local entry point checks these
hashes and the revision match, then loads the engine using the same
`loadHMEM()` function as the product. No dependency or engine update was made.
All vectors run in memory; no existing student root is opened or altered.

Covered: provenance validation, feedback deltas/clamps, ranking order,
sleep guardrails, conflict resolution, ledger snapshots and dream approval.
Receipt: `evidence/hmem-conformance-20261026.txt`.

Limits: these 13 checks are the upstream suite's coverage, not proof of every
spec sentence or the full product. The application's privacy wrapper still
redacts ledger fields on recall/forget under the existing approved D15 policy.
That intentionally differs from strict append-only ledger content; the engine
suite does not exercise those wrapper operations. Existing application memory
tests cover persistence, recall, listing, forgetting and student isolation.
The full product acceptance, consent and live model lane remain separate.
