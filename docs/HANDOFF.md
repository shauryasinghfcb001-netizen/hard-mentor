# Hard Mentor: portable handoff

Updated 2026-10-25 (live-integration batch slice) on branch `wip/offline-loop`. Lists what is real, rule-based, mock-tested and not done. Contains no credentials, tokens, org IDs or logins. The older root `HANDOFF.md` is the milestone-9 checkpoint and is not replaced.

## Purpose

Hard Mentor is a CBSE Class 11-12 CLI study agent (Open Agent Hackathon 2026, Track 03). Per student it turns study data (mastery, marks weight, days to exam) into a daily plan, shows why, answers NCERT doubts with citations, runs short quizzes that update mastery, and keeps per-student memory the student can list and forget. A distress message bypasses everything else. Everything run so far was offline on synthetic data. Not ready to submit.

## Architecture and key files

- `src/agent/graph.ts`, `conversation.ts`: LangGraph flow and chat turn handling.
- `src/agent/planner.ts`: `Planner` interface, rule planner (default), `Draft`. `Draft.comparison` is a new optional exported field.
- `src/agent/modelPlanner.ts`: `createModelPlanner`, `plannerFromEnv` (`HM_PLANNER=model` uses the existing model factory plus the validating planner).
- `src/agent/modelSafety.ts`: `validateModelDraft`, `runModelProposal`, `compareProposal`. Outcomes: validated, rejected, model_error, fallback.
- `src/agent/whyCard.ts`: why card. In model mode it shows baseline versus model proposal with status validated, rejected or error. Rejected raw model text is not shown.
- `scripts/chat.ts`: CLI entry (`npm run chat`).
- `scripts/live-loop.ts`: Standalone live integration runner (Nightshift probe, Zetaris fail-closed query, model proposal validation, rule baseline comparison, scored quiz, progress read-back, redacted receipt).
- `src/core/`: priority score, checker, distress rules. `src/quiz/`: quiz loop (writes CSV only).
- `src/memory/studentMemory.ts`: H-MEM student memory, offline.
- `src/data/studyData.ts` (CSV, default) and `src/data/zetarisStudyData.ts` (opt-in connector).
- `src/llm.ts`, `src/llm/client.ts`, `src/llm/meterless.ts`: model factory and providers.
- `src/context/`: exam research (fixture list; web research gated off). `eval/`: regression sets.

## Test results (this session, run with a scrubbed environment: `env -i` with PATH and HOME only)

- `npm test`: 237 pass, 0 fail, 0 cancelled, 0 skipped (227 baseline + 3 in `test/memory-off.test.ts` + 4 in `test/wiring-failures.test.ts` + 3 in `test/alias-mapping.test.ts`).
- `npm run typecheck`: exit 0.
- Progress tests are offline, rule planner only, fictional students, fetch stub fails the test if called.
- Model-related tests (`test/model-wiring`, `model-compare`, `model-safety`, `chat-cli`, `memory-off`, `wiring-failures`, `alias-mapping`) replace `fetch` with a stub that fails the test if called, and pass the CLI an explicit env object.

## Commands (verified in package.json)

- `npm test`, `npm run typecheck`, `npm run chat`
- `node --import tsx scripts/live-loop.ts`: Standalone live integration loop runner.
- Offline demos and proofs: `demo:chat`, `demo:csv`, `demo:journey`, `demo:turns`, `demo:swap`, `proof:forget`, `proof:riya`, `notebook`
- `eval:heldout`, `eval:frozen`: offline eval runs, write to `evidence/`
- `smoke:model`: loads `.env` and calls a live provider. Do not run without explicit approval.
- `node --import tsx scripts/zetaris-query.ts <studentId>`: live Zetaris query. Not run by this checkpoint.

## Default and opt-in behavior

- Default: rule planner (`rule-planner-v1`), local CSV study data, no network. Default chat output is byte-identical to the golden file `test/fixtures/chat-default.golden.txt`.
- `HM_PLANNER=model`: model proposal is validated, then shown beside the baseline. If no model can be built, a message is printed first, the banner is labelled, and the rule plan is used. On a model error or a rejected draft, the baseline is the plan.
- `HM_STUDY_SOURCE=zetaris`: opt-in Zetaris read, fails closed, no CSV fallback. Any other value than `csv` or `zetaris` throws.
- `HM_LIVE_RESEARCH=1`: opt-in web exam research. Keep OFF (DNS rebinding flaw is not fixed in `src/context/webResearch.ts`).

## Configuration variable names (names only; values go in a local, uncommitted `.env`; see `.env.example`)

`HM_PLANNER`, `HM_STUDY_SOURCE`, `HM_LIVE_RESEARCH`, `HM_ZETARIS_URL`, `HM_ZETARIS_USER`, `HM_ZETARIS_PASSWORD`, `HM_ZETARIS_TABLE`, `LLM_PROVIDER` (`nvidia`, `openrouter`, `meterless`), `LLM_MODEL`, `LLM_BASE_URL`, `NVIDIA_API_KEY`, `OPENROUTER_API_KEY`, `METERLESS_TOKEN`, `meterless_runtime_token`, `METERLESS_MODEL`, `METERLESS_BASE_URL`, `METERLESS_TIMEOUT_MS`, `METERLESS_STATE_DIR`.

## Status Matrix (REAL / RULE-BASED / MOCK-TESTED / NOT DONE)

| Component | Status | Evidence / Notes |
|---|---|---|
| Nightshift Runtime Smoke Test | REAL | Streamed POST /v1/chat/completions returned HTTP 200, WebLLM Llama-3.2-1B, "Ready.", 0 cloud keys. |
| Historical Zetaris Connector Read | REAL (historical) | User-supplied output of 4 rows from study_records table. Contract observed. |
| Priority Scoring & Urgency | RULE-BASED | Deterministic formula `(1-mastery)*marks_weight*urgency`. Verified in `src/core/priority.ts`. |
| Rule Planner Baseline | RULE-BASED | `rulePlanner` generates deterministic study blocks without an LLM. |
| Deterministic Plan Checker | RULE-BASED | `checkPlan` validates budget, top priority, known topics, tone. |
| Model Draft Safety Validation | RULE-BASED & MOCK-TESTED | `validateModelDraft` enforces schema, topic existence, student evidence, budget. Rejections fall back to baseline. |
| Memory-Off Prompt Omission | MOCK-TESTED | `test/memory-off.test.ts` proves `Memories: - (none)` in prompt when memory is off. |
| Meterless Adapter & Wiring | MOCK-TESTED | Normalizes `<host>/v1`, sends `meterless-app` and `meterless-scope`, supports `METERLESS_TOKEN`, configurable timeout (default 900s). |
| Zetaris Fail-Closed Connector | MOCK-TESTED | `src/data/zetarisStudyData.ts` throws `Zetaris unavailable`; `converse()` returns `Zetaris unavailable`, never silent CSV. |
| Live Product Loop Runner | REAL / MOCK-TESTED | `scripts/live-loop.ts` performs Nightshift probe + audit, Zetaris fail-closed query, model proposal validation, quiz attempt, progress read-back. |
| Live Web Exam Research | NOT DONE (GATED) | `HM_LIVE_RESEARCH=1` kept off due to DNS rebinding vulnerability. |
| Zetaris Live Write-Back | NOT DONE | Quizzes update local CSV / quiz log; Zetaris write-back not implemented. |

## Quiz attempts and progress view (this slice, rule planner, offline)

Already existed before this slice (verified from disk): quiz built from NCERT Ch 1 notes, deterministic exact-match scoring, mastery write-back (m = 0.7m + 0.3 x score) into `study-records.csv`, `quiz-log.csv` row, H-MEM summary, and a next plan that ranks by the saved mastery and cites the quiz. Mastered means mastery >= 0.85 and the rule planner skips it.

Added:
- `src/quiz/attempts.ts`: `quiz-attempts.jsonl` beside the quiz log, one line per scored quiz: quizId, studentId, topicId, takenAt, correct, total, score, per-question `{given, answer, ok, chunkId}`, logRef. `given` is the option text parsed from the quiz, never free text. Written by `submitQuiz` only on a completed, scored quiz (not on cancel, distress or repeat).
- `src/quiz/progress.ts`: `buildProgress`, `renderProgress`. Read-only. Replays saved mastery history backwards to show, per attempt, the first-ranked topic just before and after it, plus the current recommendation and weak/mastered lists.
- Chat: "my progress", "show my quiz history", "scores" (`detectProgress` in `src/agent/conversation.ts`). Handled before the graph, per student, no write, an open quiz stays open.
- `npm run progress -- <dataRoot> [studentId] [--days N] [--limit N]` (`scripts/progress.ts`): same view from a chat data root. Writes nothing.
- `scripts/quiz-conversation.txt` ends with "my progress" so `npm run demo:chat` shows it.

Persisted per data root: `study-records.csv` (mastery), `quiz-log.csv`, `quiz-attempts.jsonl` (new), `sessions/`, `students/` (H-MEM). Attempts taken before this slice have no per-question answers; the view says so.

Limits: replay assumes the quiz log is the only thing that changed mastery. The view reads local CSV/quiz log; with `HM_STUDY_SOURCE=zetaris` it ranks the Zetaris baseline with the local log replayed on top, nothing is written to Zetaris. Only Ch 1 has notes, so only Electrostatics is quizzable. No model is involved anywhere in this slice.

## Quarantine

Incompatible Antigravity drafts are preserved as `.txt` files in `docs/drafts/quarantine/` (`modelProposal.ts.txt`, `model-proposal.test.ts.txt`). They are not compiled, not tested, and not part of this commit. Other `docs/drafts/` files (README, sponsor explanation, video script) are also uncommitted drafts.

## Known gaps

- README is still the starter README. No slides, video or submission.
- Telegram, nudges, consent flow, dashboard: not started.
- Exam research facts are unverified. Some older eval failures stand (for example the "in place of" swap phrase).
- Meterless adapter fixes app id `hard-mentor` and does not check the model against `/v1/models`.

## Next three steps for the next coding tool

1. Decide the fate of the quarantined drafts: either port the useful claim-validation ideas into `src/agent/modelSafety.ts` with tests against the real `Planner` and `ChatModel` interfaces, or delete the `.txt` files. Do not copy them in as-is.
2. With explicit user approval and provider eligibility confirmed, run one live `HM_PLANNER=model` turn on synthetic data and record the real validated/rejected/error outcome. Until then keep claiming mock-tested only.
3. Add a second NCERT note corpus and a `CORPUS_TOPIC` entry so quizzes and the progress view cover more than Electrostatics. Then wire `HM_STUDY_SOURCE=zetaris` into a live read test with a loaded student table (CSV stays default); add Zetaris write-back only after that read is demonstrated in-product.
