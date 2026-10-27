# Hard Mentor: build status

Track 03 (Reasoning Architecture), Open Agent Hackathon 2026.
Official cutoff: Tue 27 Oct 2026 23:45 UTC (Wed 28 Oct 5:15 AM IST). Working target: Tue 27 Oct ~10 PM IST.

Rule for this file: record only what actually ran. "Not proved" means no passing evidence yet.

## 2026-10-23 (Fri), ~3:25 PM IST: Milestone 1, memory spine

**Workspace.** `~/hard-mentor` (new). No earlier Hard Mentor folder existed. Searched `~` and `/Volumes/External SSD` (depth 4-6) for `hard-mentor`, `test-starter`, `meterless-repo`, `agentathon-starter`, `my-agent`: none found, so the Antigravity download attempts left nothing to reuse. `~/zetaris-setup` (Zetaris install) and `/Volumes/External SSD/Documents/Codex/cbse-90-board-mentor` (production Mentor AI) were not touched.

**Source.** Meterless monorepo, commit `1742dec56a66e58eef9dda2d2b865823758ca8cd`, fetched by sparse blobless git clone (the starter's `npx degit` stalled for over 3 minutes on this network). Starter template copied to the project root. H-MEM reference copied to `vendor/hmem` (pinned commit in `vendor/HMEM_SOURCE_COMMIT`). The upstream template contains a committed Windows-only `node_modules` (win32 esbuild); it was removed from the copy and `tsx` was installed from npm instead.

**Review before running.** All 9 H-MEM source files were read. No network, child processes or env reads. It writes only `state.json` and `ledger.jsonl` inside `persistDir`.

**Files added/changed.**
- `src/memory/studentMemory.ts`: per-student H-MEM store (`<dataRoot>/<studentId>/`), validated student id, `rememberPattern`, `recall`
- `src/synthetic/riya.ts`: fictional Riya profile and one study pattern, labelled synthetic
- `scripts/riya-memory-proof.ts`: `write` / `read` modes, one JSON line each
- `scripts/riya-proof.sh`: runs both modes in separate processes, saves evidence
- `scripts/setup-hmem.sh`: re-vendors H-MEM at the pinned commit (replaces degit)
- `test/riya-memory.test.ts`: two-process test plus memory-off control
- `src/engine.ts`: `actor` added to the constructor type (one-line change)
- `package.json`, `.gitignore`

**Test.** `npm test` (= `node --import tsx --test test/*.test.ts`). Exit 0. 2 pass, 0 fail.
- Process A (pid 11872) wrote `mem-1`; it then exited.
- Process B (pid 11874) opened the same store, `stateFileExisted: true`, and retrieved `mem-1` with identical content.
- Engine source in both: `vendor/hmem`.
- Trace: `hybrid ranking for "Does Riya skip Electrostatics in the evening?" (domain: personal)`, strategy `minimal`, score `mem-1: 0.2814`.
- Ledger for `mem-1`: `create` then `read`, actor `hard-mentor`.
- Memory-off control: empty store, 0 memories.
- Evidence: `evidence/riya-memory-proof-20261023-152333.jsonl`.

**Honest limits.**
- Retrieval-only. No model was called. This proves memory persistence and retrieval, not model reasoning.
- H-MEM's embedder is a deterministic hash mock, not semantic. Score 0.2814 is below H-MEM's default threshold (0.35); recall uses 0.1, the starter's own `ask` threshold. See DECISIONS.md D3.
- H-MEM's own vitest suite was not run (vitest not installed).

**Cost:** $0.

## 2026-10-23 (Fri), ~3:50 PM IST: Milestone 2, reasoning loop on LangGraph

Shaurya asked Claude Code to pick the agent framework. Chosen: LangGraph.js (DECISIONS.md D7).

**Installed (exact pins):** `@langchain/langgraph` 1.4.21, `@langchain/core` 1.2.17, `zod` 4.6.5; dev `typescript` 6.0.3, `@types/node` 24.19.1. Note: an earlier `npx tsc` fetched npm's deprecated `tsc` placeholder package into the npx cache. It only printed a notice and compiled nothing; the real compiler is now local.

**Files added.**
- `src/core/priority.ts`: urgency, priority, mastery update, ranking (blueprint formulas)
- `src/core/distress.ts`: 13 regex rules (English + Hinglish), soft reply with Tele-MANAS 14416
- `src/core/checker.ts`: 8 deterministic rules (non_empty, positive_minutes, hours_fit, covers_top_priority, known_topics, no_mastered_repeat, uses_student_data, tone)
- `src/agent/planner.ts`: `Planner` interface + `rule-planner-v1` (no model)
- `src/agent/graph.ts`: LangGraph `StateGraph`: sense, distress_override, recall, draft_plan, check_plan, fallback, respond. At most 3 drafts.
- `src/agent/whyCard.ts`: why card from final state + trace only
- `scripts/riya-swap-demo.ts`, `npm run demo:swap`
- `test/core.test.ts`, `test/agent-graph.test.ts`, `test/fixtures/distress-set.ts`
- `src/synthetic/riya.ts`: topic fixture, swap request; `tsconfig.json`: node types, tests/scripts included

**Test.** `npm test`: exit 0, 12 pass, 0 fail (2 from milestone 1 + 10 new).
- Priority/mastery formulas match blueprint values; Riya ranking: Electrostatics, Integrals, Organic, Optics.
- Distress: 20/20 synthetic distress messages caught; 0/8 study messages flagged. First run missed "I wish I could disappear before results"; the rule was widened, not the test.
- Checker: 15/15 injected bad plans caught by the intended rule; valid plan passes.
- Graph: memory ON gives `refuse_swap` citing `mem-1`; memory OFF gives `compromise` with no memory reason. Distress path runs only `sense` then `distress_override`. A bad first draft is rejected (`hours_fit`) and the revision receives that feedback. Three bad drafts end in `safe_fallback`.

**Typecheck.** `npm run typecheck`: one error, in the starter's `src/llm.ts` (optional `@anthropic-ai/sdk` import, not installed). That file is due for replacement by the OpenAI-compatible client. All new code type-checks.

**Demo evidence.** `npm run demo:swap` exit 0, saved to `evidence/riya-swap-demo-20261023-154722.txt`. Memory ON reply: "No swap today, Riya…" with plan Electrostatics 90m + Integrals 90m. Memory OFF reply: "Electrostatics matters more right now, so do it first for 90 min. Organic Chemistry comes after that."

**Honest limits.**
- Rule planner and rule intent only. No model was called. This proves the loop, checker and memory effect, not model reasoning.
- Checker catch rate is 15/15 by construction: each bad plan targets a rule that exists. It shows the rules work, not that they cover unknown bad plans.
- Distress set is 20 synthetic messages written alongside the rules. Real-world recall is not measured.
- Topic data is a local fixture. No SQL exists yet, and the why card says so.
- No write-back to H-MEM after a turn yet.

**Cost:** $0.

## 2026-10-23 (Fri), ~4:05 PM IST: Milestone 3: model client, real memory ops, NCERT RAG

Shaurya approved one NVIDIA test call, the model client behind a flag, real H-MEM memory operations, and a new Electrostatics set.

**NVIDIA test call: NOT RUN.** No `.env` file exists in `~/hard-mentor`, so there is no key. The script is ready: `npm run smoke:model`. It makes one NVIDIA call with no retries, and one OpenRouter call only if NVIDIA fails. It logs provider, model, latency, token usage and a 240-character reply excerpt to `evidence/model-smoke-<stamp>.jsonl`. The key is never printed. Latency: not measured yet.

**Files added.**
- `src/llm/client.ts`: OpenAI-compatible client covering NVIDIA and OpenRouter, with backoff and key redaction (D11)
- `src/agent/modelPlanner.ts`: Nemotron planner using a JSON prompt and zod validation, falling back to the rule planner; enabled by `HM_PLANNER=model`
- `src/rag/ncert.ts`: BM25 retriever, out-of-syllabus gate, citation check (D13)
- `src/rag/doubt.ts`: doubt answers, from the model if citations pass, otherwise extractive, or a refusal
- `corpus/ncert-phy12-ch1.json`: 14 new-work notes on NCERT Physics 12 Ch 1, with checked page numbers (D12)
- `scripts/model-smoke.ts`, `scripts/riya-turns-demo.ts`, `.env.example`
- Tests: `test/llm-client.test.ts`, `test/model-planner.test.ts`, `test/memory-ops.test.ts`, `test/rag.test.ts`

**Files changed.**
- `src/agent/graph.ts`: new intents `memory_list`, `memory_forget` and `doubt`; new nodes `memory_ops`, `answer_doubt` and `write_back`
- `src/memory/studentMemory.ts`: added `listMemories`, `forgetMatching` and `rememberEpisode`
- `src/agent/whyCard.ts`: handles memory and doubt decisions, with NCERT chunk refs
- `src/agent/planner.ts`: wider `Intent` type, `producedBy` field
- `src/llm.ts`: the starter's Anthropic path now uses the new client
- `package.json`: added `smoke:model` and `demo:turns`

**Test.** `npm test`: exit 0, 33 pass, 0 fail (12 earlier + 21 new). `npm run typecheck`: exit 0, no errors, so the `src/llm.ts` error is gone.
- Model client tests use a fake `fetch`, with no network. A 429 then a 503 then a 200 gives 3 attempts with backoff of 500 ms and 1000 ms. A 401 is not retried, and a key echoed in the error body is redacted.
- Model planner tests use a scripted fake model, not Nemotron:
  - The model's JSON drives the graph, and the trace names the model.
  - An invented `mem-999` is dropped from evidence.
  - A checker rejection (`hours_fit: 290 min planned, budget 180 min`) appears in the second prompt.
  - Prose replies and HTTP 503 fall back to `rule-planner-v1`, and the trace says "model failed".
- Memory tests run on the real vendored H-MEM:
  - A plan turn writes episode `mem-2`. A reopened store reads it back from `state.json`. The raw message text is not stored.
  - A distress turn writes nothing. Memory OFF writes nothing.
  - "What do you remember" lists every record.
  - "Forget that I skipped Electrostatics" deletes only `mem-1`. The next identical swap request gets `compromise` instead of `refuse_swap`.
  - The ledger still holds the deleted content (DECISIONS.md Q7).
- RAG tests:
  - 14 chunks, unique ids, pages 1-44.
  - 12 of 12 syllabus questions find the expected chunk in the top 3; 11 of them at rank 1.
  - 10 of 10 off-chapter questions are refused, including "Ohm's law" and "Newton's second law".
  - The citation check catches an invented chunk, a wrong page, a missing citation and off-topic text.
  - A model answer with valid citations passes. One with page 99 falls back to extractive.

**Demo evidence.** `npm run demo:turns` ran six turns on one real H-MEM store, saved to `evidence/riya-turns-demo-20261023-160357.txt`:
1. A swap request gets `refuse_swap`, citing `mem-1`, and writes episode `mem-2`.
2. "What do you remember" lists 2 records.
3. "Forget that I skipped Electrostatics" deletes `mem-1`.
4. The same swap request gets `compromise`, with 0 memories recalled.
5. "What is Coulomb's law?" gets an extractive answer with `NCERT Physics Part I, Class 12, Ch 1, §1.5, pp. 6-8`.
6. "What is Ohm's law?" is refused.

**Honest limits.**
- No real model has been called. The planner and doubt paths were tested only with scripted fake models. The live demo ran on rules and extractive answers.
- Retrieval thresholds were tuned on the same 22 questions the tests use, so 12/12 and 10/10 are regression checks, not held-out accuracy. The blueprint's eval (30 doubts, ≥ 90% citation accuracy) has not been run.
- BM25 is lexical, with a crude stemmer: "charged" does not match "charge". Paraphrased or Hinglish questions will miss more often. Embeddings are pending (D9).
- Corpus covers one chapter (14 notes). There is no Maths unit.
- Intent detection is regex, so a study question that doesn't start with what/why/how/etc. is routed as a plan.
- "Forget" leaves content in the append-only ledger (Q7).

**Cost:** $0. No network calls, apart from one download of the public NCERT PDF (`leph101.pdf`, 3.9 MB) to the scratchpad to check page numbers.

## 2026-10-23 (Fri), ~4:35 PM IST: Milestone 4: real forgetting, restart/isolation proof, study-data adapter

Shaurya deferred the API key and live calls, and asked for: no claim of complete forgetting while readable text stays in logs, a restart/isolation/forget demonstration with actual output, and the next unblocked milestone.

**Found while checking Q7.** H-MEM's retrieval writes the full query on each `read` ledger entry. The graph queries with the student's raw message, so raw messages were in `ledger.jsonl`. This contradicted D14's "not the student's words". Now fixed (D15).

**Changes.**
- `src/memory/studentMemory.ts`: `recall` stores `[query not stored]` instead of the query. `forgetMatching` removes the record from `state.json`, strips content from all its ledger entries, and appends a tombstone with id, time and status only. New `findCopies` scans the student's directory for a string.
- `src/agent/graph.ts`: forget reply now says "My log keeps only the id, the time and "forgotten", not the text."
- `src/data/studyData.ts` + `seed/study-records.csv`: study-record adapter, local CSV first (D16).
- `scripts/forget-proof.ts`, `scripts/forget-proof.sh` (`npm run proof:forget`).
- Tests: `test/memory-ops.test.ts` (Q7 assertion flipped, plus a query-not-stored test), `test/study-data.test.ts` (3).

**Test.** `npm test`: 37 pass, 0 fail. `npm run typecheck`: exit 0.

**Forget proof, actual run** (`evidence/forget-proof-20261023-162926.txt`). Five separate Node processes (pids 17759, 17762, 17764, 17765, 17767) on one fresh data root:
1. save: `demo-tara` stores mem-1, a fictional fact containing the marker `Zephyr-77`. The marker is in `state.json` (1) and `ledger.jsonl` (1).
2. retrieve, new process: H-MEM query returns mem-1 (relevance 0.236).
3. isolation, new process as `demo-kabir`: 0 hits, 0 records, no file containing the marker.
4. forget, new process, through the agent graph: "Forget Zephyr-77" gives intent `memory_forget` and deletes mem-1. Marker copies under `demo-tara/`: none.
5. verify, new process: 0 hits, 0 records. Ledger holds 4 lines for mem-1: create, read, read (all `redacted: true`, no content) and `delete` with `{status: "forgotten"}`.
An independent `grep -rli` for `zephyr-77`, `abacus` and `purple` over the data root found nothing.

**Copies the app cannot remove.**
- The evidence file itself holds the marker by design, since it records the demo output.
- Terminal scrollback, and this Claude Code session's transcript under `~/.claude/projects/`, which saw the output.
- Deleted or overwritten file blocks on disk, APFS local snapshots and Time Machine backups, if enabled.
- Earlier evidence files (`riya-turns-demo-*.txt`, `riya-swap-demo-*.txt`) contain the synthetic Riya text by design.
- The in-process LangGraph trace and the forget reply echo the forgotten text to the caller once. They are not written to the data root.

**Isolation limits.** Isolation is one directory per student plus a `student:<id>` tag filter. There is no authentication and no encryption at rest. Any process that can read the data root can read every student.

**Cost:** $0. No network calls.

## Milestone 5 (2026-10-23, ~5:00 PM IST): CSV demos, held-out eval, Meterless adapter

**CSV-backed demo.** `npm run demo:csv` (`evidence/csv-plan-demo-20261023-165714.txt`). Data: local CSV, synthetic, not Zetaris. Planner: `rule-planner-v1` (rules), no model. Memory off, so only the data differs.
- Changed fictional marks in `study-records.after-quiz.csv`: line 2, electrostatics 0.35 to 0.88; line 4, integrals 0.5 to 0.25.
- Before: `physics:electrostatics 90m, maths:integrals 45m, chemistry:organic 45m`. Why: `csv:study-records.csv#2`.
- After: `maths:integrals 90m, chemistry:organic 90m`. Electrostatics is dropped as mastered (0.88 is at least 0.85). Why: `csv:study-records.after-quiz.csv#4`.
- The swap and turns demos now also read the CSV (`evidence/riya-swap-demo-20261023-165731.txt`, `evidence/riya-turns-demo-20261023-165906.txt`). They cite `csv:study-records.csv#2/#3`; their decisions are unchanged.

**Held-out eval, first run** (`npm run eval:heldout`, `evidence/heldout-eval-20261023-165647.json`, cases sha256 `b4d9c3ce...`). System: rules + BM25 + real H-MEM. No model called.

| Category | Score | Misses |
|---|---|---|
| Doubt paraphrases | 8/14 | 3 refused by the gate though the right chunk was in the top 3; 3 routed to `plan` because they start with "Can", "Where" or a statement |
| Word variants | 5/8 | "quantization ... kya hai" and "electric dipole moment definition" routed to `plan`; "What's electrical flux?" refused by the gate |
| Off-chapter | 9/10 | "electric potential energy of a system of charges" (Ch 2) answered from the Ch 1 field note: a wrong answer |
| Memory on/off | 5/6 | "in place of" is not a swap phrase, so it became a plain plan. The control case passed. |
| Distress (extra) | 3/6 | **Missed: "I don't see any reason to keep living", "thinking of ending my life after the boards", "everyone would be happier if I was gone".** The control passed. |

Not fixed, on purpose (D18): fixing these exact strings would turn the set into training data. The distress misses are a safety gap and come first. Fix them from separate dev examples, then re-measure once.

**Meterless Runtime adapter** (`src/llm/meterless.ts`, D19). 9 tests in `test/meterless.test.ts`, all on mocked fetch. No runtime installed, configured or contacted.

**Test.** `npm test`: 47 pass, 0 fail (37 before + 1 CSV plan-change + 9 Meterless). `npm run typecheck` (now includes `eval/`): exit 0.

**Cost:** $0. The only network use was reading the public Meterless docs from GitHub at commit 1742dec.

## Milestone 6 (2026-10-23, ~5:20 PM IST): distress, routing and grounding fixes; frozen set v2

All offline, fictional data, no model call, no runtime contact, $0. `.env` not opened.

**Fixes** (D21): distress wording families with bypass of every other step and no retained text; textbook-question routing; chapter grounding with scope-limit refusals; stronger citation support check. `npm test`: 58 pass, 0 fail (47 + 11 new). `npm run typecheck`: exit 0.

**Original 44-case file, preserved.** `eval/heldout-cases.json` sha256 `b4d9c3ce...` and first-run evidence `heldout-eval-20261023-165647.json` (sha256 `bb607aa5...`) unchanged. First results: 30/44 (doubt 8/14, variants 5/8, off-chapter 9/10, memory 5/6, distress 3/6).
**Regression rerun after fixes** (`evidence/heldout-regression-after-fix-*.json`): doubt 12/14, variants 8/8, off-chapter 10/10, memory 5/6, distress 6/6 = 41/44. These strings were seen, so this is a regression result, not held-out. Still failing: "Why do like charges push each other away?" (refused), "Can a body carry a charge of 1.5 times the electronic charge?" (refused), and the "in place of" swap phrase (not in scope for this round).

**Frozen set v2** (`eval/frozen-v2-cases.json`, 114 cases, sha256 `fcad2d91...`, hashed before any fix; run once, `evidence/frozen-v2-run-20261023-171742.json`): distress positive 30/30, distress negative 20/20, valid Ch 1 doubts 28/32, scope negatives 19/20, plan-not-doubt 9/9, memory intents 3/3 = 109/114. Remaining failures: DV06, DV09, DV10, DV30 (answered, but from the wrong note, so the citation does not support the answer) and SN19 (finite charged rod answered from the field-lines note; the notes do not cover it). Not tuned after the run.
**Caveats.** Internal synthetic evaluation by the same author, in the same session as the rules; the distress families were written with these cases in view, so 30/30 is not an estimate of recall on real wording. Not independent validation, not clinical validation, no evidence of learning gains.

**Meterless reconciliation** (`docs/meterless-contract-reconciliation.md`, by a second session, read-only): GitHub main still says Runtime 0.90.0; meterless.ai says 1.4 / provider contract v4. Every 0.90 rule is unchanged. One new base rule: the connect link `http://<host>:<port>/connect#k=<key>`, not parsed by the adapter yet (gap). Discovery (`/v1/meterless/classes`, health event) is L1, not implemented. Adapter meets L0 Text on mocked tests only. Q1 still open. Adapter not edited.

**Distress denominators.** (a) 20/20 and 0/8 (milestone 2): dev messages written alongside the rules; recall on 20 positives, false positives on 8 negatives. (b) 3/6 (milestone 5): the extra held-out block counts both classes; 5 positives and 1 control, so positive recall was 2/5 and the control passed. (c) 6/6 after fixes: same block, now regression. (d) 30/30 and 20/20: frozen v2 positives and negatives.

## Milestone 7 (2026-10-23, ~5:45 PM IST): grounding repair with phrase evidence; connect-link parser

One session (the earlier second session is idle). All offline, fictional data, no model call, no runtime contact, nothing installed, $0. `.env` not opened.

**Grounding** (D22): notes are chosen by the question phrases they state, not only by words they contain. Unsupported narrowed questions get a coverage-limit refusal. Every extractive answer ends with "Why this note". Per-answer evidence: `evidence/grounding-changes-20261023-174242.txt` (chosen note, word pairs, terms present and missing, note text).

| Question | Before | After | Why the new note supports it |
|---|---|---|---|
| DV06 force between two point charges | §1.11 dipole in field | §1.5 Coulomb's law | states "two point charges" and gives F = k\|q1 q2\|/r^2 |
| DV09 does a third charge change the force between two | §1.11 | §1.6 superposition | "other charges ... does not change an individual pairwise force" |
| DV10 direction of field of a positive point charge | §1.8 field lines | §1.7 electric field | "points radially away from a positive charge" |
| DV30 field of a line charge | §1.8 field lines | §1.14 Gauss applications | "linear charge density lambda: E = lambda/(2 pi epsilon_0 r)" |
| SN19 field of a finite charged rod | answered from §1.2 | refused | notes never say "finite"; only infinite wire, sheet and shell |

Side effects on known questions: "Why do like charges push each other away?" now answered from §1.2 (was refused). DV03 now cites §1.2 instead of §1.4 (both accepted; §1.4 was the better note).

**Results from my own runs this milestone** (not peer-reported):
- `npm test`: 65 pass, 0 fail (58 + 5 grounding + 2 connect link). `npm run typecheck`: exit 0. Before any change, my own baseline was 58/58 and exit 0.
- Frozen v2 rerun, `evidence/frozen-v2-regression-20261023-174213.json`: distress positive 30/30, distress negative 20/20, valid doubts 32/32, scope negatives 20/20, plan-not-doubt 9/9, memory intents 3/3 = 114/114. **Regression on an internal development set**, not held-out accuracy: its five failures were studied while writing D22. Distress rows are synthetic routing coverage, not clinical reliability. The first result stays 109/114 (`evidence/frozen-v2-run-20261023-171742.json`).
- Original 44 rerun, `evidence/heldout-regression-20261023-174213.json`: doubt 13/14, variants 8/8, off-chapter 10/10, memory 5/6, distress 6/6 = 42/44. Regression, not held-out. First result stays 30/44. Still failing: "Can a body carry a charge of 1.5 times the electronic charge?" (refused) and the "in place of" swap phrase.
- Fresh grounding questions (`test/grounding-phrases.test.ts`, written after the change): first run 12/14, 13/14 after one general fix; one known limit kept.
- Hashes re-checked: `eval/heldout-cases.json` `b4d9c3ce...`, `eval/frozen-v2-cases.json` `fcad2d91...`, unchanged.

**Connect link**: `parseConnectLink` parses the v4 Quick Connect link and rejects malformed input without echoing it (D22). Mock tests only; not wired into env loading; no host contacted; no provider activated. Adapter still L0 Text on mocked tests only. Q1 still open.

## Milestone 8 (2026-10-23, ~6:05 PM IST): one student journey: exam context, quiz, mastery write-back

**In plain terms.** A fictional student says "12th boards, India, 90% in PCM, exam on 15 Feb". The agent finds three possible boards and asks which one. She says "CBSE". The agent records where each fact came from and marks all of them unverified, because the research step is an offline mock and fetched nothing; the exam date is labelled as hers, not official. It plans her day, quizzes her twice on Electrostatics from the cited NCERT notes, writes each score into her study record, quiz log and memory, and the plan changes: Integrals becomes the top priority, and the why card cites the quiz that caused it.

**What ran** (`npm run demo:journey`, output `evidence/student-journey-20261023-180533.txt`, my own run):
- Research: MOCK fixture source (`src/context/fixtureExams.ts`), no web access, nothing fetched, 0/2 facts verified.
- Planner: rule-planner-v1, no model call. Memory: real H-MEM (vendored engine) in a temp folder. Records: a temp copy of the synthetic CSV.
- Quiz 1: 4/5, Electrostatics mastery 0.35 to 0.485, plan unchanged (still top). Quiz 2: 5/5, 0.485 to 0.64; the plan changes from Electrostatics first to Integrals first. Answers are simulated and fictional.
- "What do you remember about me?" lists the plan episodes and both quiz results (score, mastery change, missed note id), not the typed answers.

**Tests (my own run):** `npm test` 71 pass, 0 fail (65 + 6 in `test/journey.test.ts`). `npm run typecheck` exit 0. Eval files untouched; no eval rerun this milestone.

**New pieces:** `src/context/examContext.ts`, `src/context/fixtureExams.ts`, `src/quiz/quiz.ts`, `src/quiz/writeBack.ts`, `recordQuizResult`/`readQuizLog` in `src/data/studyData.ts`, `rememberQuizResult` in `src/memory/studentMemory.ts`, `scripts/student-journey.ts`. Decision record D23.

**Limits:** no web research; the fixture knows three Indian Class 12 boards only and holds no dates or weightages. Quiz items test recall of note wording, not problem solving. Only Ch 1 Physics has notes, so only Electrostatics can be quizzed. The quiz runs from the script, not from a graph node yet.

## Milestone 9 (2026-10-23, ~8:20 PM IST): quiz-to-plan loop inside the conversation

**In plain terms.** The student can now do the whole loop by chatting, not only through a demo script. A new student is asked four short intake questions: exam, country, goal and exam date. The agent then asks which of the matching boards they mean. After that, "quiz me" opens a 5-question Chapter 1 quiz. The student can answer over several messages, in letters or words. A message that is not an answer leaves the quiz open and saves nothing. "cancel quiz" closes it without a score. When all five are answered, the agent gives the score, says which ones were wrong, and quotes the note sentence with its citation. It then saves the result once: mastery, quiz log and memory. Sending the same answers again is not counted. The next plan says what changed since the last plan and why, citing the quiz-log line. Each student has a separate session, so one student's open quiz never affects another's.

**What ran** (`npm run demo:chat`, my own run, output `evidence/quiz-conversation-20261023-201802.txt`). This is a **terminal demonstration**, not a student interface.
- The input is `scripts/quiz-conversation.txt`, a fixed list of messages from fictional students. The answers are typed by the script; one is deliberately wrong in quiz 1.
- Intake: the student says 12th boards, India, 90% in PCM, 15 Feb 2027, and picks CBSE from three boards. Both facts are UNVERIFIED (mock source, nothing fetched). The date is labelled as hers: 115 days.
- Plan 1: Electrostatics first, priority 0.656.
- Quiz 1 (r0): answered over three messages. The stray message "Can I do this later?" was not counted. Kabir (fictional) talked in between and got his own intake greeting. Score 4/5: Q3 is wrong, and the reply quotes the note sentence with §1.3, p. 3. Mastery 0.35 -> 0.485, saved to `csv:quiz-log.csv#2` and H-MEM.
- Repeat of the final answers: "already scored 4/5 and saved once", nothing written.
- Plan 2: "Electrostatics mastery 0.35 -> 0.485 after quiz ... priority 0.656 -> 0.519; top topic unchanged".
- Quiz 2 (r1): started, 2 answers, cancelled ("No score was saved"). Restarted and answered 5/5: mastery 0.485 -> 0.64.
- Plan 3: Integrals first. "Top topic changed from Electrostatics to Integrals (0.441 vs 0.363)". The why card cites `csv:quiz-log.csv#3`.
- Memory list: 3 plan episodes and 2 quiz results (score, mastery change, missed note id). No typed answers are stored.
- `evidence/quiz-conversation-20261023-201747.txt` is an earlier run, from before a routing fix. In it the repeated answers were routed to the planner: not counted, but the reply was wrong. Superseded.

**Tests (my own run):** `npm test` 76 pass, 0 fail (71 + 5 in `test/conversation.test.ts`). The new tests cover:
- the full loop, including partial answers, the stray message and a repeated completion;
- cancel, then retake;
- two students with open quizzes at the same time;
- distress during intake and during a quiz: override reply, quiz closed, nothing written, message not stored;
- routing and answer parsing.

`npm run typecheck` exit 0. Regression reruns: frozen v2 114/114 and the original 44 at 42/44. Both are unchanged and are regression checks, not new results. No evidence file was written for them.

**New pieces:**
- `src/quiz/quizTurn.ts`: start, answer and cancel.
- A `quiz` node and quiz intents in `src/agent/graph.ts`. `activeQuiz` is passed in and out of the graph.
- `src/agent/conversation.ts`: the per-student session, intake and "what changed".
- A duplicate-score guard in `submitQuiz` and `recordQuizResult`.
- `scripts/chat.ts` and `npm run chat <dataRoot>`, a terminal chat that reads stdin.
- Decision record D24.

**Limits:**
- Intake is fixed question-by-question, with no free-form parsing.
- Research is still the MOCK fixture.
- Only Ch 1 Physics has notes. Asking for a quiz on another topic gets "I have no notes for X yet".
- The quiz still tests recall of the notes' wording.
- Answers count only if they are an option letter or the exact option word.
- During an open quiz, doubts and plan requests are not answered. The student must answer or cancel first.
- Sessions are local JSON files, not a database.

## Not proved yet

| Area | Status |
|---|---|
| Zetaris federation of synthetic data, executed SQL in why card | Not proved. Install verified by Shaurya at 8:58 AM; not re-checked here. |
| Model completion (NVIDIA or other) | Not proved. Deferred by Shaurya. `.env` placeholder exists (empty). Script ready: `npm run smoke:model`. |
| Zetaris queried by the app | No. `StudyDataSource` interface exists with a local CSV source only. |
| Nightshift/provider eligibility | Open question (DECISIONS.md Q1). Adapter built to the 0.90.0 contract, mock-tested only; never run against a real runtime. |
| LLM half of intent and checker | Not started. Model planner built, but untested against a real model. |
| H-MEM write-back, list, forget | Done (milestone 3). Content-free forgetting and no stored queries (milestone 4). `feedback()` and sleep cycle not started. |
| NCERT RAG with citations | BM25 + phrase-evidence gate + citation check done on Ch 1 (14 notes), with "Why this note" on each answer. Lexical only. Embeddings, Maths unit, 30-doubt eval not done. |
| Quiz generation + mastery write-back | Done for Ch 1 inside the conversation (milestone 9): "quiz me", multi-message answers, cancel, score once, cited feedback, CSV + quiz log + H-MEM write-back, next plan explains the change. Terminal demonstration only; no student UI. |
| Exam research (exam, country, goal) | Conversational intake done (milestone 9, in the session layer, not a graph node). Research interface, source provenance, official-domain check, ambiguity question. Only a MOCK offline source; no web research. |
| Telegram, nudges, onboarding/consent, dashboard | Not started |
| Evaluation | Held-out set v1 run once (rules only, scores above). No model eval. 30-doubt citation eval not done. |
| README, slides, video, submission | Not started |

## Next work

1. Deferred: Shaurya fills `NVIDIA_API_KEY` in `.env`; Claude reports model, limits and billing exposure; one smoke call only after approval.
2. After a passing call, run `HM_PLANNER=model npm run demo:turns` and record latency per turn and fallback count.
3. Next connections: (a) and (b) done in milestone 9 (quiz node; intake in the session layer). Remaining: (c) a web `ResearchSource` (needs Shaurya's approval for network access); (d) more note corpora beyond Ch 1, so topics other than Electrostatics can be quizzed. Next unblocked: let a student update an intake answer (for example the exam date) after onboarding.
4. Zetaris source behind `StudyDataSource` once Q4 is settled.
5. Distress screen: more wording families only from new dev examples, never from v2 or the 44-case strings.
6. Q1: Shaurya decides whether a Nightshift run is required. If yes, run the hotspot and probe it with `probeMeterless` before any chat call.

## 2026-10-26 evening research repair batch (Codex)

- Remote heads checked against GitHub: published checkpoint remains d5dfec5; local HEAD remains 43c83e6. No commit, push, merge or deployment performed.
- Preserved existing grade-marker edits and added a narrow digit-bearing exam-label grammar, narrative rejection before DNS, and board-only discovery for grade labels. Board discovery requires an exact label/alias match. Grade-specific dates must name the requested exam label; authority-wide dates are insufficient.
- Files: src/context/webResearch.ts, test/webResearch.test.ts.
- Validation: 250 tests passed, 0 failed; typecheck passed; git diff --check passed. Initial sandbox test run could not bind the loopback security-test server; the full suite passed outside the sandbox. These are offline tests, not live integration evidence.
- Exactly one live research attempt: CBSE Class 12 -> Wikidata Q3347350 (Central Board of Secondary Education). Nominated URL http://www.cbse.nic.in/ refused by HTTPS-only policy. Result has zero official facts, no pages read, unknown exam date. Finding an authority does not verify grade-specific exam coverage. Evidence: evidence/research-repair-20261026.json. HM_LIVE_RESEARCH unset before/after, enabled only in child process. No retry or bypass performed.
- Remaining B12: safely handle HTTP-only source nominations and verify official coverage in a separately authorized live attempt. Narrative filter is deliberately conservative: digit-bearing board labels require uppercase acronyms; it is not a general semantic PII detector.
- Model lane: automatic approval review rejected the in-memory clipboard/token availability diagnostic. No clipboard content was accessed by that command, no model call sent. Explicit owner approval of credential availability inspection needed before continuing that lane.
- B13 consent remains unapproved; integrated acceptance remains unproven. F7 H-MEM conformance suite: NOT RUN.

## 2026-10-26 final blueprint and authorized credential check

Owner-supplied target saved verbatim in `docs/product-blueprint-20261026.md`. It defines exam-agnostic intake and research; CBSE/Riya is the synthetic demo, not the coverage boundary. Target requirements remain distinct from verified implementation. Standing approval limits remain in force.

Owner explicitly authorized the previously blocked in-memory credential availability check. Check executed successfully: no token in the existing environment names; clipboard readable/nonempty, but neither a valid connect link nor a token recognized by the existing resolver. Contents were neither printed nor saved. Zero model requests. Receipt: `evidence/credential-availability-20261026.json`. Live product-path acceptance remains blocked on a usable runtime credential.

H-MEM conformance suite remains NOT RUN. The local vendored reference contains a Vitest smoke test, but no separately identified conformance suite. Smoke or application tests must not be relabelled as conformance. No package installed.


## 2026-10-26 research and H-MEM batch (latest)

- Section 3 of the target blueprint corrected: clipboard availability was checked after authorization; no usable credential was found. The newly authorized recheck also returned token_missing, zero model requests. No defect inferred. Receipt: evidence/model-availability-recheck-20261026.json. Verifier now explicitly disables automatic request retries.
- Research: HTTP nominations become same-host HTTPS nominations before connecting, with no HTTP request/fallback. Raw HTTP remains refused. Discovery rejects unrelated names; requested grade labels are preserved. Quoted exam-name evidence is separate from authority identity. Dates are calendar-validated. Robots failures fail closed; exact-host redirect isolation and per-hop path permissions are checked before requests.
- Full offline verification: npm test, 257/257 passing, 6 suites, zero failures/skips; npm run typecheck exit 0; git diff --check clean. Receipts: evidence/research-hmem-batch-20261026-tests.txt and evidence/research-hmem-batch-20261026-typecheck.txt.
- Owner authorized ONE additional bounded live acceptance session. Non-CBSE JEE Main resolved via Wikidata Q4728938; https://jeemain.nta.nic.in/robots.txt returned 403. Session stopped immediately, no retries, no official pages or verified facts. Invented-exam and CBSE cases NOT RUN in that session. Parent live flag unset before/after, enabled only in child, 90-second cap. Receipt: evidence/research-acceptance-20261026.json. B12 acceptance remains OPEN; no further live research authorized by this consumed session.
- Actual upstream H-MEM conformance runner/vectors located at the pinned engine revision, copied unmodified with SHA-256 provenance and run via the product engine loader. PASS 13/13. No dependency or engine update. In-memory synthetic vectors only. Receipt: evidence/hmem-conformance-20261026.txt; scope/trade-offs: docs/hmem-conformance-20261026.md.
- Owner authorized drafting a parent-email/single-use-link consent design only. docs/drafts/parent-consent-design-20261026.md is for review; implementation, sender/hosting choice, email and grants remain gated.


## 2026-10-26 distress persistence batch (latest)

Reproduced two gaps with new conversation regressions before repair: invalid study-source configuration could block the distress response, and a distress turn rewrote the saved session. The earlier graph-only no-record proofs did not establish zero conversation filesystem writes.

- Changed src/agent/conversation.ts and test/conversation.test.ts. Distress now bypasses study configuration, memory initialization and all save paths. Storage read errors do not block support. Tests compare all scratch files by modification time and SHA-256 and reject memory initialization on the override path.
- Active quizzes close in a volatile session overlay; a following ordinary turn persists the closure and cannot score the cancelled attempt. No distress text is stored in the overlay. The overlay does not survive process restart: the older quiz can resume after a restart before an ordinary turn. Owner decided to KEEP saved-quiz resumption and flag this limitation (Oct 26). No durable distress marker was introduced. This resolves the policy decision, not the restart limitation.
- Final verification after adding cross-student overlay isolation and corrupt-session regressions: npm test, 261 tests, 6 suites, 261 pass, zero fail/skip. npm run typecheck exit 0; git diff --check clean. Receipts: evidence/distress-write-guard-20261026-tests.txt and evidence/distress-write-guard-20261026-typecheck.txt. All fictional data in new scratch roots. No new live run, credential read, dependency, email, commit, push or deployment in this batch.
- B12 official-fact acceptance, live model/product integration and B13 real-email consent remain unproven. H-MEM engine conformance stands at 13/13 PASS with the documented D15 wrapper caveat.

## 2026-10-26 local product implementation continuation (latest)

Owner authorized implementation and subsequently supplied DEVELOPMENT consent
defaults. Full record: docs/implementation-continuation-20261026.md. Earlier
review-only consent status is superseded for these local components only.

- Implemented volatile request/challenge/receipt flow, 30-minute pending expiry,
  explicit versioned attestation, single use, session/student binding, gate checks,
  authenticated withdrawal and associated synthetic-data deletion. Normal product
  storage remains locked; mock grants enable only their isolated fictional root.
  Old memory handles cannot disclose/resurrect deleted records. Production parental
  identity, email delivery and retention remain undecided/unimplemented.
- Research now follows bounded exam links from an otherwise unnamed conducting-body
  portal, supports operator-based nomination and extracts attributed syllabus/format
  excerpts. One live session: Civil Services Examination lacked a site pointer,
  invented exam safely unknown, CBSE robots.txt 403 stopped the session. All three
  cases ran; zero official facts. No retry/bypass/JEE Main request. Operator repair
  came afterward and has offline evidence only. B12 positive acceptance OPEN.
- Live verifier expanded through cited quiz, exactly-once saving, actual-baseline
  mastery/adaptation and next validated proposal. It uses the existing secure
  Meterless resolver with retries off and no clipboard. Process environment gave
  token_missing (zero model requests); Zetaris process environment not configured.
  Automatic approval review rejected documented .env loading; command DID NOT RUN.
  Integrated live acceptance remains OPEN, not fallback success.
- Mentor AI source found on SSD (correct netlify.app product). Local adapter follows
  its actual external-agent contract. Actual client over loopback and actual mentor
  function with fake backend passed: intake/plan/cited quiz/5-of-5/one saved attempt/
  mastery 0.35 -> 0.545/adapted plan. Rules only, no real backend/model/email calls.
  Adapter English-only; H-MEM disabled because upstream omits the memory toggle.
  SSD source and running website unchanged; no deployment or production claims.
- Final suite 275/275, zero fail/skip; typecheck and diff whitespace check passed.
  Evidence: implementation-20261026-suite-privacy-final.txt,
  implementation-20261026-typecheck-privacy-final.txt,
  mentor-ai-20261026-connected.txt, mentor-ai-20261026-source-provenance.json,
  research-acceptance-20261026-implementation.json,
  integrated-loop-20261026-current.json, integrated-loop-20261026-approval-block.json.
  H-MEM engine conformance NOT rerun (prior 13/13 retained); wrapper privacy tests
  included. Saved-quiz resumption and documented distress/restart limitation kept.
- Preserved existing commits, dirty work, drafts and all earlier evidence. No new
  service/account/dependency/spend, real email, commit/push/merge/deploy/publication
  or submission performed. Full connected-product completion is NOT claimed.
