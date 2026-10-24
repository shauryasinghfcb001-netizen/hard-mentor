# Hard Mentor: honest handoff

Written 2026-10-24 on branch `checkpoint/research-gate-20261024`. This file lists what is real, what is rule-based, what is only mock-tested and what is not done. It contains no credentials, tokens, org IDs or default logins. The older root `HANDOFF.md` is the milestone-9 checkpoint and is not replaced.

## Purpose

Hard Mentor is a CBSE Class 11-12 study agent for the Open Agent Hackathon 2026, Track 03 (Reasoning Architecture). One agent per student turns study data (mastery, marks weight, days to exam) into a daily plan, shows why it chose that plan, answers doubts from NCERT notes with citations, runs short quizzes that update mastery, and keeps per-student memory that the student can list and forget. A distress message bypasses everything else. Everything that has run so far ran offline on synthetic data. No live model, no live Zetaris query and no live Meterless runtime has ever been called. The agent is not ready to submit.

## Status table

| Area | Status | Evidence in repo |
|---|---|---|
| LangGraph flow, rule planner, checker | REAL (offline) | `src/agent/graph.ts`, `planner.ts`, `src/core/`; `npm test` |
| Why card (data rows, quiz citations) | REAL (offline) | `src/agent/whyCard.ts`; CSV default |
| Why card source/SQL provenance | MOCK-TESTED | `test/why-card-provenance.test.ts`; not reached from `conversation.ts` |
| H-MEM student memory (remember, list, forget) | REAL (offline) | `src/memory/studentMemory.ts`; forget and Riya proofs in `evidence/` |
| NCERT Ch 1 doubt answering with citations | RULE-BASED | BM25 over 14 notes, phrase gate; not a model |
| Distress override | RULE-BASED | `src/core/distress.ts`; keyword/phrase rules |
| Priority score and plan ordering | RULE-BASED | `src/core/priority.ts` |
| Conversational quiz loop | REAL (offline) | `src/quiz/`; scores written to the local CSV |
| Study data source | REAL for CSV only | `src/data/studyData.ts`, `seed/study-records.csv` (synthetic) |
| Zetaris study data connector | MOCK-TESTED | `src/data/zetarisStudyData.ts`, `test/zetaris-study-data.test.ts`; fake fetch only |
| `scripts/zetaris-query.ts` runner | MOCK-TESTED | formatting tests only; never run against a server |
| Model planner (`HM_PLANNER=model`) | MOCK-TESTED | `src/agent/modelPlanner.ts`; never called against a real model |
| LLM client (NVIDIA, OpenRouter) | MOCK-TESTED | `test/llm-client.test.ts` |
| Meterless Runtime adapter | MOCK-TESTED | `src/llm/meterless.ts`, `test/meterless.test.ts`; mocked fetch, not Meterless connection evidence |
| Exam research, fixture list | MOCK | `src/context/fixtureExams.ts`; facts UNVERIFIED |
| Web exam research | MOCK-TESTED, default OFF | `src/context/webResearch.ts`; mocked fetch and DNS; gate off unless `HM_LIVE_RESEARCH=1` |
| Eval sets | REAL (offline) | `eval/`; frozen v2 and held-out cases are regression checks |
| Live Zetaris student query | NOT DONE | no student table is loaded |
| Zetaris connector wired into conversation | NOT DONE | `src/agent/conversation.ts` builds the CSV source |
| Quiz write-back to Zetaris | NOT DONE | `src/quiz/writeBack.ts` writes CSV only |
| Any live model or Nightshift call | NOT DONE | never made |
| Telegram, nudges, consent flow, dashboard | NOT DONE | not started |
| README, slides, video, submission | NOT DONE | the README is still the starter README |

## Commits on this branch

From `git log --oneline --reverse`:

```
bf6f609 Checkpoint: Hard Mentor through the conversational quiz-to-plan loop
1d896cf Let a student correct intake answers after onboarding
8f36f93 Add memory on/off control and a no-research path for unknown exams
8fa391c Fix verifier findings: quiz-open date correction, narrower memory and correction wording
2dc968a Update handoff after controls pass
5a6d703 Add bounded web exam research from public official pages
568f82f Add default-OFF gate over all outbound exam-research traffic
7f1b152 Add Zetaris study data connector and runner (offline mock-tested only)
20a8a83 Add optional source/SQL provenance to why-card (CSV default unchanged, offline mock-tested)
8a2c621 Align Meterless adapter to Runtime provider contract (offline mock-tested only)
```

## Environment variable names

Names only. Set values in a local `.env` that is never committed. `.env.example` lists the safe defaults.

- `HM_ZETARIS_URL`
- `HM_ZETARIS_USER`
- `HM_ZETARIS_PASSWORD`
- `HM_ZETARIS_TABLE`
- `HM_LIVE_RESEARCH` (research gate; unset means OFF)
- `LLM_PROVIDER` (`nvidia`, `openrouter` or `meterless`)
- `HM_PLANNER` (`rules` is the default; `model` turns on the model planner)
- `METERLESS_STATE_DIR`

## How to run

- Tests: `npm test` (last run: 170 pass, 0 fail, 5 suites, all offline).
- Typecheck: `npm run typecheck` (last run: clean).
- Zetaris runner: `node --import tsx scripts/zetaris-query.ts <studentId>`. It reads the four `HM_ZETARIS_*` variables, runs one query and prints the rows and the exact SQL. On any failure it prints "Zetaris unavailable" and exits 1. It has no CSV fallback. It has never been run against a real server, so do not read a green test run as proof that it works live.
- Other scripts are listed in `package.json` (`demo:chat`, `demo:csv`, `demo:journey`, `proof:forget`, `proof:riya`). They use the rule planner and local data.

## Known gaps

- No live Zetaris student query has ever run. The connector contract comes from one observed run; error shapes, pagination, token expiry and table loading are unproven.
- No student table is loaded in Zetaris.
- The connector is not wired into `src/agent/conversation.ts`. It still builds the CSV source, and it drops the source/SQL provenance when it builds the why card.
- Quiz results still write to the CSV, not to Zetaris.
- No live Nightshift or model call has ever been made. The model planner and the Meterless adapter are tested against mocked HTTP only.
- Research gate is OFF by default. When it is turned on, the DNS rebinding flaw is NOT fixed: `src/context/webResearch.ts` checks the host's DNS answer for public addresses, then `fetch` resolves the name again, so a hostile name could answer differently the second time. Pinning the resolved address needs a new package or a custom agent. Keep `HM_LIVE_RESEARCH` unset until it is fixed.
- Exam research facts are unverified, and web research reads HTML only.
- The Meterless adapter fixes the app id to `hard-mentor`, drops any URL path prefix, and does not check the chosen model against the `/v1/models` list. It can also read a token from `<METERLESS_STATE_DIR>/proxy-token`.
- The chat is a terminal demonstration, not a student interface.
- Known eval failures from the older handoff still stand (for example the "in place of" swap phrase).

## Open external gates

- Zetaris: the method for loading a student table is still unknown.
- Nightshift: the M3 build and its token are not available yet.
- Under-18 provider eligibility: not confirmed. The students are minors, so confirm that each model provider allows this use before any live call.
