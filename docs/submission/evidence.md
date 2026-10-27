# Personalised Mentor: evidence and limits

## Oct 28 typed browser execution — builder recorded, locally inspected

The [public recording guide](recording.md) and [samples](samples.md) identify the actual typed inputs/output and persisted files from the existing checkout. The browser starts memory off. Partial answers save nothing; completion scores 4/5 (.35 → .485), repetition stays at one score, then 5/5 (.485 → .64) yields two attempts and Integrals first. Turning memory on creates a plan summary; off retains it; forgetting it leaves the scores intact. Reset and an unsupported-exam response were recorded. These are local fictional/rules executions, not live-provider or independent educational validation.

Browser-build outputs record typecheck, **43 passed / 0 failed / 0 skipped** focused tests and **1 passed / 0 failed / 0 skipped** HTTP integration test. The release check inspected their stored outputs/hashes and source; it did not rerun tests or models. Broader 302/2/2 and H-MEM 13/13 below have their own earlier dates and scopes. A clean clone was not tested; the earlier HEAD-archive install remained DNS-blocked.

## Earlier Oct 27 packaging execution (historical relative to the browser build)

Source: `fix/web-research-dns-pin` at `537d80cb4c7e0ae92b30c03e62295b66436ed453`, with pre-existing modified/untracked tests and documentation. All results here are from the existing dirty checkout unless explicitly labeled clean. Run timestamps, commands, exits, hashes and exclusions are in [runs.json](evidence/runs.json). Simulated study time is 2026-10-23, distinct from the Oct 27 execution date.

| Execution | Result | What it proves |
|---|---|---|
| Journey with existing `fictionalSandbox` wrapper | Exit 0; [actual output](evidence/journey-actual.txt) | Mock exam intake, ranked why-card, cited quiz, score/mastery write-back, second quiz and changed plan using real local H-MEM. No model or live data read. |
| `chat.ts --fictional-scratch --today 2026-10-23` with [scripted input](../../scripts/quiz-conversation.txt) | Exit 0; [actual output](evidence/chat-actual.txt) | Multi-message answers, other-student separation, one saved score per completion, duplicate suppression, cancellation without score, two saved attempts and changed top topic. |
| Same chat plus memory-control turns | Exit 0; [input](evidence/controls-input.txt), [actual output](evidence/controls-actual.txt) | Memory off, list, forget plan/quiz memories, empty list, memory on. Not deletion of separate quiz records. |
| `npm run typecheck` | Exit 0 | Current TypeScript sources/tests compile with existing dependencies. |
| `npm run test:hmem-conformance` | Exit 0; [actual output](evidence/hmem-conformance-actual.txt), 13/13 | Upstream vectors/runner hash and pin checks plus in-memory engine conformance. Existing vendored engine, not a fresh download verification. |
| Scoped offline tests, 33 selected files | Exit 1; 306 tests: 302 passed, 2 failed, 2 skipped | Broad local tests, including memory, consent/deletion, no-data-write distress, quiz persistence, why provenance and mocked connectors. No full-suite pass. |
| Direct legacy journey with an ordinary fresh directory | Exit 1, `ConsentRequired` | Legacy npm demo routes need the documented classified fictional scratch mode; their `tee` exit code can mask Node failure. |
| Fresh HEAD archive + fresh dependency cache, `npm ci --ignore-scripts --no-audit --no-fund` | Exit 1, npm registry DNS failure | Clean install attempted without reused dependencies. Does not prove clean setup. |
| `npm run setup` in that clean archive | Exit 128, GitHub DNS failure | H-MEM download attempted; clean demo/tests could not run. |

The test command excluded `test/mentor-ai.test.ts` (separate external project imports) and `test/live-run-safety.test.ts` (installed Nightshift source dependency). Two web-research loopback tests were skipped with `HM_TEST_NO_NETWORK=1`. A temporary preload blocked real fetch/HTTP/HTTPS/socket connections; mock transports remained injectable. No real provider requests were authorized or made.

Two existing checks failed and were left unchanged because this batch is packaging-only:

- `test/verify-product-path.test.ts`: “product verification gate accepts only a validated Meterless proposal with Zetaris evidence” expected true and received false.
- `test/zetaris-query-format.test.ts`: “bounded executable terminates on either outcome and never loads a model module” failed because its child import hook detected `forbidden_model_import`.

Current source inspection explains the failures: the verifier test’s valid fixture omits required `graphChecked: true`; the query-only runner imports live-run helpers which import `modelPlanner.ts`, `llm/client.ts` and `llm/meterless.ts`, triggering its forbidden-model-import hook before the mocked query. That is an import-isolation failure, not proof of an outbound provider request. Neither was repaired or rerun here. Full `npm test` remains unknown. Earlier builder-reported focused 143/143 and conformance 13/13 are historical claims, not a substitute for the fresh scoped run above.

## Inspected historical live evidence

Two existing Oct 27 live-loop receipts were read and reduced to [allowlisted fields](evidence/historical-live-summary.json). This is a newly prepared summary of historical execution, **not a new live run**. Both mark `zetarisRead: true`, each has one model request, and neither passes the loop. The earlier response was rejected at proposal validation; the later request timed out. Only outcome/check/category fields are included: no credentials, raw prompts, model responses, endpoints, registry dumps or private config.

No standalone successful four-row, zero-model-call Zetaris query receipt was found among this project's evidence files. The owner's account of it remains reported-only here. The two live-loop check flags do not prove its row count or zero-call property. Raw receipts remain local and outside the proposed release assets.

## Stored expected output and interpretation limits

[chat-default.golden.txt](../../test/fixtures/chat-default.golden.txt) is **STORED EXPECTED OFFLINE OUTPUT**, covering intake and initial plan. The fresh transcripts above were generated separately. Synthetic data, scripted answers, mock exam facts and rule-produced plans remain labeled throughout.

A successful local test does not establish live Nightshift acceptance, NVIDIA generation, deployment, official exam accuracy, real-student consent, independent educational efficacy or cleared third-party rights. There is no hosted Personalised Mentor service or finished video/deck in this package.
