# Hard Mentor: portable handoff

Updated 2026-10-25 on branch `wip/offline-loop`. Lists what is real, rule-based, mock-tested and not done. Contains no credentials, tokens, org IDs or logins. The older root `HANDOFF.md` is the milestone-9 checkpoint and is not replaced.

## Purpose

Hard Mentor is a CBSE Class 11-12 CLI study agent (Open Agent Hackathon 2026, Track 03). Per student it turns study data (mastery, marks weight, days to exam) into a daily plan, shows why, answers NCERT doubts with citations, runs short quizzes that update mastery, and keeps per-student memory the student can list and forget. A distress message bypasses everything else. Everything run so far was offline on synthetic data. Not ready to submit.

## Architecture and key files

- `src/agent/graph.ts`, `conversation.ts`: LangGraph flow and chat turn handling.
- `src/agent/planner.ts`: `Planner` interface, rule planner (default), `Draft`. `Draft.comparison` is a new optional exported field.
- `src/agent/modelPlanner.ts`: `createModelPlanner`, `plannerFromEnv` (`HM_PLANNER=model` uses the existing model factory plus the validating planner).
- `src/agent/modelSafety.ts`: `validateModelDraft`, `runModelProposal`, `compareProposal`. Outcomes: validated, rejected, model_error, fallback.
- `src/agent/whyCard.ts`: why card. In model mode it shows baseline versus model proposal with status validated, rejected or error. Rejected raw model text is not shown.
- `scripts/chat.ts`: CLI entry (`npm run chat`).
- `src/core/`: priority score, checker, distress rules. `src/quiz/`: quiz loop (writes CSV only).
- `src/memory/studentMemory.ts`: H-MEM student memory, offline.
- `src/data/studyData.ts` (CSV, default) and `src/data/zetarisStudyData.ts` (opt-in connector).
- `src/llm.ts`, `src/llm/client.ts`, `src/llm/meterless.ts`: model factory and providers.
- `src/context/`: exam research (fixture list; web research gated off). `eval/`: regression sets.

## Test results (this session, run with a scrubbed environment: `env -i` with PATH and HOME only)

- `npm test`: 219 pass, 0 fail, 0 cancelled, 0 skipped (6 suites).
- `npm run typecheck`: exit 0.
- Model-related new tests (`test/model-wiring`, `model-compare`, `model-safety`, `chat-cli`) replace `fetch` with a stub that fails the test if called, and pass the CLI an explicit env object.

## Commands (verified in package.json)

- `npm test`, `npm run typecheck`, `npm run chat`
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

`HM_PLANNER`, `HM_STUDY_SOURCE`, `HM_LIVE_RESEARCH`, `HM_ZETARIS_URL`, `HM_ZETARIS_USER`, `HM_ZETARIS_PASSWORD`, `HM_ZETARIS_TABLE`, `LLM_PROVIDER` (`nvidia`, `openrouter`, `meterless`), `LLM_MODEL`, `LLM_BASE_URL`, `NVIDIA_API_KEY`, `OPENROUTER_API_KEY`, `METERLESS_MODEL`, `METERLESS_STATE_DIR`.

## Mocked versus demonstrated

- Demonstrated offline (synthetic data): rule planner, checker, why card, quiz loop, H-MEM memory list and forget (`evidence/`), NCERT BM25 doubts, distress override.
- Mock-tested only (stubbed model or fake fetch): model planner and validation, comparison output, LLM client, Meterless adapter, Zetaris connector, `scripts/zetaris-query.ts` formatting, web research.
- Not demonstrated: any live model call, any Nightshift call, any working H-MEM integration beyond the offline memory module, any in-product Zetaris use.
- Zetaris: the user supplied historical output of one successful connector read. That is user-supplied historical evidence, not a run performed by this checkpoint or by any test. In-product Zetaris use remains unproven: the connector is not wired into the default conversation, quiz results do not write back, and no student table is loaded.
- Provider permission: under-18 eligibility is unconfirmed for any model provider. Confirm before any live call.

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
3. Wire `HM_STUDY_SOURCE=zetaris` into a live read test with a loaded student table, keep the CSV path as the default, and add write-back only after the read is demonstrated in-product.
