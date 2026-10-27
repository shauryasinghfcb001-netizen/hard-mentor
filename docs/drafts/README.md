# Hard Mentor: draft README (not final, not submitted)

CBSE Class 11-12 study agent. One agent per student ranks weak topics, drafts a plan, checks it with deterministic rules, explains why, and keeps per-student memory the student can list and forget. Everything below ran offline on synthetic data with mocked inputs. Line citations were re-read on 2026-10-25 against the uncommitted working tree on `wip/offline-loop`.

## What is wired

A model can propose a study plan, and the proposal can be validated before anyone sees it. This is **opt-in**:

- `plannerFromEnv` with `HM_PLANNER=model` and a model present turns validation on (`src/agent/modelPlanner.ts:140-141`).
- `createModelPlanner` defaults to lenient (`validate: false`) so existing callers behave as before (`src/agent/modelPlanner.ts:99`, `:118`).
- With validation on, the model draft goes through `validateModelDraft` (`src/agent/modelPlanner.ts:125`, defined at `src/agent/modelSafety.ts:46`). It must be well formed, use only known topics, fit the time budget, and cite evidence that exists for this student.
- If validation rejects the draft, or the model call errors, the plan falls back to the rule baseline. The plan's `producedBy` reads `rules; model rejected: <codes>` or `rules; model failed: ...`, and the trace shows it (`src/agent/modelPlanner.ts:123`, `:131-134`).
- Only a validated draft counts as model success: the `onProposal` event reports `modelSuccess: true` for it and `false` for rejections and errors (`src/agent/modelPlanner.ts:122`, `:127`, `:133`).
- Topic and time rules reuse the existing `checkPlan` rather than a second validator (`src/agent/modelSafety.ts:64`).
- The planner sits on the real conversation path: `converse` passes `env.planner` to the graph (`src/agent/conversation.ts:359`), which calls `planner.draft` (`src/agent/graph.ts:243`) and then `checkPlan` (`src/agent/graph.ts:261`).
- **Baseline beside the model proposal, in the conversation's why card (validation on only).** The validating planner attaches a `comparison` to the draft, built with `compareProposal` (`src/agent/modelPlanner.ts:104`, `:129`, `src/agent/modelSafety.ts:157`, `src/agent/planner.ts:29`). The graph's safe fallback keeps it (`src/agent/graph.ts:274`), `buildWhyCard` copies it (`src/agent/whyCard.ts:50`) and `renderWhyCard` prints a "Plan comparison:" block before the loop (`src/agent/whyCard.ts:57-68`, `:73`). `converse` returns that card as `TurnResult.why` (`src/agent/conversation.ts:439`) and `scripts/chat.ts:128` prints it. The reply text itself is unchanged.
  - **Validated:** "Rule baseline: ..." and "Model proposal: validated: <decision>: <blocks>", then "Plan sent: the model's validated proposal".
  - **Rejected:** "Model proposal: rejected (<reason codes>); not used, not shown as a plan", then "Plan sent: the rule baseline". Only the codes are printed. The rejected draft's blocks and raw text are never shown.
  - **Model error:** "Model proposal: model error (...); no proposal", then "Plan sent: the rule baseline".
  - **Safe fallback after the checker rejects every draft:** "Plan sent: safe fallback".
  - **Off (default rule planner, or `createModelPlanner` without `validate`):** no comparison and no new text. A golden test checks the reply and the whole why card (`test/model-compare.test.ts:114`).
  - **Normal chat entry point (`npm run chat`).** `scripts/chat.ts` now chooses its planner with `choosePlanner` (`scripts/chat.ts:51`), called from `runChat` (`scripts/chat.ts:80`, `:94`). With `HM_PLANNER` unset it uses `rulePlanner` and prints exactly the output the unmodified script printed (a golden captured from the script before this edit: `test/fixtures/chat-default.golden.txt`, checked at `test/chat-cli.test.ts:64`). With `HM_PLANNER=model` it builds a model only then, with the existing `modelFromEnv` (`src/llm/client.ts`: reads provider settings from the environment; construction makes no network call) and `plannerFromEnv`, so the comparison shows (`test/chat-cli.test.ts:74`, `:86`, `:94`). If `HM_PLANNER=model` is set but `modelFromEnv` returns null or throws (no key, unknown `LLM_PROVIDER`), the first printed line says so, the banner reads "rule-planner-v1 (no model; HM_PLANNER=model was requested but unavailable)", and every plan is the rule baseline (`scripts/chat.ts:110`, `:112`; `test/chat-cli.test.ts:102`). The script never falls back silently. The script does not load `.env`; export the variables or start node with `--env-file`.
  - Nothing in this repo's tests or docs shows a live model in this output. What a real model still needs: provider settings in the environment that `modelFromEnv` reads (`NVIDIA_API_KEY` or `OPENROUTER_API_KEY`, optional `LLM_MODEL` / `LLM_BASE_URL`, or `LLM_PROVIDER=meterless` with its runtime token), network access, and a first live run, which has not happened.

## Tests

Last observed `npm test` run (this session, after the comparison change): exit 0, 219 tests, 219 pass, 0 fail, 0 skipped. `npm run typecheck`: exit 0. Doc-only edits came after that run and `npm test` was not repeated. All inputs are mocked: stub models and temp copies of the local CSV. This is not live integration proof.

The wiring tests are in `test/model-wiring.test.ts`; the validator unit tests are in `test/model-safety.test.ts`; the comparison output tests are in `test/model-compare.test.ts`; the CLI tests are in `test/chat-cli.test.ts`. All four replace `globalThis.fetch` with a function that throws and counts calls, and assert zero calls afterwards (`test/model-wiring.test.ts:20-32`, `test/model-safety.test.ts:17`, `test/model-compare.test.ts:18-28`, `test/chat-cli.test.ts:14-26`). That check covers `fetch` use inside those four test files only. It does not rule out other network routes.

## Status table

| Status | Claim | Source |
|---|---|---|
| REAL (live verified) | Nightshift local WebLLM Llama-3.2-1B smoke test succeeded: HTTP 200, "Ready.", zero cloud keys configured. | `evidence/` |
| REAL (historical, user-supplied) | One Zetaris connector-runner read happened once. The user supplied its real connector output (4 rows from hard_mentor.study_records); error shapes, pagination, token expiry and table loading are unproven. | `docs/HANDOFF.md` |
| RULE-BASED | Topic priority = (1 - mastery) x marks weight x urgency. | `src/core/priority.ts:42` (`rankTopics`) |
| RULE-BASED | Baseline planner drafts the plan without a model. | `src/agent/planner.ts:56` (`rulePlanner`) |
| RULE-BASED | Deterministic plan checker (time budget, top priority covered, known topics, evidence cited, tone), run on every draft by the graph. | `src/core/checker.ts:42` (`checkPlan`), `src/agent/graph.ts:261` |
| MOCK-TESTED & VERIFIED | Model draft validation on the conversation path (`validateModelDraft`). Accepted draft is used and counted as model success; rejected draft falls back to rule baseline beside proposal comparison. | `src/agent/modelSafety.ts`; `test/model-wiring.test.ts`, `test/wiring-failures.test.ts` |
| MOCK-TESTED | Memory off through the real path: memories completely omitted from prompt (`Memories: - (none)`), and a model citing a stored memory is rejected. | `test/memory-off.test.ts:32-110` |
| MOCK-TESTED | Meterless Runtime adapter (`src/llm/meterless.ts`) normalized to `<host>/v1`, default model `meterless/auto`, headers `meterless-app` and `meterless-scope: user`, configurable timeout (default 900s for cold model loads). | `test/meterless.test.ts` |
| MOCK-TESTED | Zetaris study connector (`src/data/zetarisStudyData.ts`) fails closed on missing config, HTTP errors, or non-JSON responses. Never silently falls back to CSV. | `test/wiring-failures.test.ts` |
| MOCK-TESTED | Live integration loop runner (`scripts/live-loop.ts`) executing runtime probe, cloud audit, Zetaris fail-closed query, model proposal validation, rule baseline comparison, scored quiz attempt, and progress read-back. | `scripts/live-loop.ts` |
| NOT DONE (GATED) | Live web exam research (`HM_LIVE_RESEARCH=1`) kept off due to DNS rebinding vulnerability. | `src/context/webResearch.ts` |
| NOT DONE | Remote Zetaris write-back (quizzes update local CSV and attempts log only). | `src/quiz/writeBack.ts` |

## `ref.field` contract

`DraftSchema` is unchanged and has no `field`. The validator reads an optional string `ref.field` from the raw model JSON. It is not required and the prompt does not ask for it. If supplied, it must be an own property of the cited record (a `data_row` topic row or a recalled memory). On a `rule` ref, or with a non-string or unknown name, the draft is rejected as `unknown_field` (`src/agent/modelSafety.ts:75-91`).

## Known documentation conflict

`docs/HANDOFF.md` was not edited. Line 7 says no live Zetaris query has ever been called, line 23 says the runner was "never run against a server", and line 76 says no live Zetaris student query has run while also saying the contract "comes from one observed run". These conflict with, or are at best unclear about, the one real connector read recorded above. Reconcile the wording before submission.
