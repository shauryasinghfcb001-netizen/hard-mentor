# Hard Mentor: handoff

Checkpoint written 2026-10-23 (~8:45 PM IST) so a fresh Claude Code chat can continue, not restart. Detailed history is in `BUILD_STATUS.md` (what ran, milestone by milestone) and `DECISIONS.md` (D1-D24, open questions Q1-Q7). Read those before changing anything.

## Purpose and blueprint

Hard Mentor is a CBSE Class 11-12 study agent for the Open Agent Hackathon 2026, Track 03 (Reasoning Architecture). Deadline: Tue 27 Oct 2026 23:45 UTC.

Full blueprint, one adaptive agent per student:
- Onboarding: exam, country, goal and date; research the exam with source provenance; consent.
- Study data federated through Zetaris (synthetic sources), with the executed SQL shown in a "why card".
- Daily plan from mastery, marks weight and urgency; a checker validates every plan.
- Doubt answering grounded in NCERT notes with citations, refusing outside note coverage.
- Quizzes that update mastery, a quiz log and memory, so the next plan changes and says why.
- Real H-MEM memory per student (remember, recall, list, forget), with memory on/off evals.
- Distress override that bypasses everything else.
- Surfaces planned: Telegram, nudges, dashboard. Then evaluation, README, slides and video.

Cut order if time runs short: Google Sheet source, then the Maths unit, then the dashboard, then the Scout eval. Never cut: the distress override, the why card with SQL, the memory on/off evals.

## Architecture

- TypeScript on Node 26, run with `tsx`. Tests use `node --test`.
- `src/agent/graph.ts`: LangGraph.js StateGraph. Nodes: sense (intent, distress first), distress_override, plan / checker, doubt (RAG), memory list/forget, quiz. The graph is stateless per message.
- `src/agent/conversation.ts`: per-student session layer around the graph. A JSON file per student (`sessions/<id>.json`) holds intake answers, resolved exam context, the open quiz and the last plan. Intake runs here, not in the graph.
- `src/agent/planner.ts`: `rule-planner-v1` (default). `src/agent/modelPlanner.ts` exists but has never been called against a real model.
- `src/core/`: priority (`(1-m)·weight·urgency`, urgency `1 + 30/days`), checker, distress detection.
- `src/rag/ncert.ts`, `src/rag/doubt.ts`: BM25 over 14 NCERT Physics Ch 1 notes (`corpus/ncert-phy12-ch1.json`), phrase-evidence gate, citation check, "Why this note".
- `src/quiz/`: quiz build, `quizTurn.ts` (start / answer / cancel), `writeBack.ts` (score once; mastery `0.7m + 0.3·score`).
- `src/data/studyData.ts`: `StudyDataSource` interface with a local CSV source only; quiz log CSV; duplicate-score guard.
- `src/memory/studentMemory.ts`: per-student H-MEM store on the vendored engine.
- `src/context/`: exam research interface and the offline MOCK fixture.
- `src/llm/`: model client and Meterless Runtime adapter, mock-tested only.
- Starter files from the Meterless agentathon-starter (Apache-2.0) are kept: `README.md`, `notebook.ts`, `src/engine.ts`, `src/llm.ts`, `images/`, `seed/example-session.txt`.

## Completed versus mocked

Real and tested (offline):
- LangGraph flow, rule planner, checker and why card (data and quiz citations).
- H-MEM persistence across processes, list, content-free forget, per-student isolation.
- NCERT Ch 1 doubt answering with citations and coverage refusals.
- Distress override in the graph, during intake and during an open quiz.
- **Conversational quiz loop (landed, milestone 9):** intake, then "quiz me", answers over several messages, score with cited feedback, saved once to CSV + quiz log + H-MEM, and the next plan states what changed and why. Cancel and incomplete attempts save nothing. Repeated completion messages are not counted. Each student's open quiz is separate.

Mocked or not done:
- Exam research is an offline MOCK list of three Indian boards. Every fact is UNVERIFIED. Student-given dates are labelled student-stated.
- No model has been called. No Meterless Runtime contacted. No Zetaris query; data is a local synthetic CSV.
- Telegram, nudges, consent flow, dashboard, slides, video and submission: not started.
- The chat is a **terminal demonstration**, not a student interface.

## Latest tests (actual)

Run at this checkpoint:
- `npm test`: 76 pass, 0 fail.
- `npm run typecheck`: exit 0.

Last regression reruns (milestone 9, no new evidence file; regression checks, not held-out results):
- Frozen v2 (114 cases): 114/114. First result stays 109/114.
- Original 44-case set: 42/44. First result stays 30/44. Known failures: "Can a body carry a charge of 1.5 times the electronic charge?" is refused; the "in place of" swap phrase is not recognised.

Eval case files and their first-run evidence must stay unchanged. Distress results are synthetic routing coverage, not clinical reliability.

## Offline demo commands

All run with no keys, no network and no model:

```sh
npm install            # first time only
npm run setup          # vendors H-MEM into vendor/hmem (git-ignored) at the pinned commit; needs network once
npm test
npm run typecheck
npm run demo:chat      # terminal demonstration: intake -> plan -> quiz -> score -> saved progress -> next plan
npm run chat /tmp/hm-chat   # type messages yourself; "kabir> text" switches to the second fictional student
npm run demo:journey   # scripted journey without the conversation layer
npm run demo:csv
npm run proof:forget
```

Reference output: `evidence/quiz-conversation-20261023-201802.txt`. The `-201747` file is an earlier, superseded run.

## Next incomplete task

Done and committed locally (1d896cf, 8f36f93, 8fa391c; not pushed): intake corrections after onboarding; conversational "turn memory off/on" (stored memories kept, still listable and forgettable); "continue without research" for exams the offline list lacks (no exam facts claimed); honest reply for a student with no study records. All rule-based; fixture exam list only. Tests: 90 pass. Next unblocked: none; live exam research (needs network approval) is the next dependency.

Then:
- More note corpora beyond Ch 1, so topics other than Electrostatics can be quizzed.
- A web `ResearchSource`: needs Shaurya's approval for network access.
- Model smoke call: needs a key from Shaurya and approval of model, limits and billing first.
- Zetaris source behind `StudyDataSource` once Q4 is settled.

Open decisions: Q1 (Nightshift eligibility) is unresolved and must not be silently waived. Q2, Q4, Q5 and Q6 are also open; see `DECISIONS.md`.

## Accidental-session status

- Antigravity: an inspection prompt was pasted there by mistake earlier. It attempted a starter download (`test-starter`) and a sparse clone (`meterless-repo`). A search found neither folder; nothing was reused (BUILD_STATUS milestone 1).
- Other Claude sessions: at this checkpoint every listed peer session was idle or offline, including `shauryasingh-29`, which earlier received the same hard-mentor prompt and was coordinated with by message. No process held files in the repo, and no file changed after the milestone 9 docs.

## Rules that stay in force

- Fictional student data only. No keys in chat, files or commits; `.env` stays git-ignored and unread.
- Ask before paid use, live model calls, network access, new packages or accounts, merges or deploys.
- Never fabricate scores, eval rows, SQL, screenshots or integrations. Never present rule or retrieval output as model reasoning.
- Production Mentor AI (`cbse-90-board-mentor`) is separate work and is not part of this repo. Do not reopen the Supabase investigation.
- Keep `BUILD_STATUS.md` and `DECISIONS.md` current.
