# Hard Mentor: decision log

Format: date, decision, reason, who decided. Open questions for Shaurya are at the bottom.

## Made

**D1. 2026-10-23. Project folder is `~/hard-mentor` (new).** No existing Hard Mentor folder or starter download was found. Kept separate from `~/zetaris-setup` and from production Mentor AI (`cbse-90-board-mentor`). Decided by Claude Code under Shaurya's "proceed with local implementation" instruction; easy to move.

**D2. 2026-10-23. Vendor H-MEM by sparse git clone at a pinned commit, not `npx degit`.** degit downloads the full monorepo tarball and stalled for over 3 minutes. Sparse clone took seconds. Pinned commit: `1742dec56a66e58eef9dda2d2b865823758ca8cd`. `npm run setup` reproduces it.

**D3. 2026-10-23. Recall threshold 0.1, not H-MEM's default 0.35.** The reference embedder is a deterministic hash mock, so natural-language queries score low (Riya's pattern: 0.2814). 0.1 is the threshold the starter's own `ask` command uses. Revisit if a real embedder is added. Disclose in README.

**D4. 2026-10-23. Store patterns with `hmem.add` and explicit provenance, not `mine()`.** Mining is a sentence heuristic that drops sentences without signal words. Explicit records give the why card an exact, auditable memory id. `mine()` is still available for free-text chat capture later.

**D5. 2026-10-23. Tests use Node's built-in runner (`node --test`) via `tsx`.** Only one dev dependency. Node 26 here supports `--strip-types` only, and H-MEM uses TypeScript parameter properties, so `tsx` is required.

**D6. 2026-10-23. Production Mentor AI persistence issue stays parked.** Per handoff section 7. No Supabase work.

**D7. 2026-10-23. Orchestration: LangGraph.js (`@langchain/langgraph` 1.4.21, MIT). Not CrewAI, not LangChain chains.** Shaurya asked Claude Code to choose. Reasons:
- The blueprint fixes the stack to TypeScript. CrewAI is Python-only.
- The agent loop in blueprint section 5 is a graph: sense, distress short-circuit, recall, draft, check, revise at most 2 times, fallback. LangGraph `StateGraph` with conditional edges models that directly, and Track 03 judges the reasoning architecture.
- Full LangChain (chains, vector-store wrappers) adds weight without a need. Only `@langchain/core` comes in, as LangGraph's peer dependency.
- Runs fully local. No LangSmith or cloud tracing configured.
Versions pinned exactly and chosen at least two weeks old where possible (core 1.2.17, zod 4.6.5).

**D8. 2026-10-23. Deterministic rule planner until a model is approved.** The graph takes a `Planner` interface. `rule-planner-v1` (kind `rules`) fills it now, so the loop, checker, why card and memory-on/off diff are testable at $0. Every trace row names the planner and its kind, so rule output is never presented as model reasoning. The Nemotron planner plugs into the same interface after Q2.

**D9. 2026-10-23. RAG plan: own retriever behind an interface, not a LangChain vector store.** Corpus is small (NCERT Physics plus one Maths unit). Start with a local lexical retriever (BM25) so citation tests run offline at $0. Add embeddings (sqlite-vec or LanceDB, per blueprint) behind the same interface once an embedding source is approved: local model download or NVIDIA embeddings API. Not built yet.

**D10. 2026-10-23. Topic data comes from a local fixture until Zetaris is wired.** `RIYA_TOPICS` in `src/synthetic/riya.ts`. Marks weights are synthetic placeholders, not official CBSE weightage. The why card shows `SQL: not available` rather than an invented query.

**D11. 2026-10-23. Model client: own OpenAI-compatible client over `fetch`, no SDK.** `src/llm/client.ts`. NVIDIA (`integrate.api.nvidia.com/v1`) is primary, and OpenRouter is the fallback. Retries happen only on 429, 5xx and network errors, with backoff of 0.5 s, 1 s and 2 s. The key is redacted from every error. The starter's Anthropic path in `src/llm.ts` now uses this client; this also cleared the last typecheck error. The model planner sits behind `HM_PLANNER=model`, and the default is `rules`. If the model call or JSON parse fails, the rule planner drafts instead, and the trace says "model failed". Evidence ids come only from reasons whose ids were given to the model. Shaurya approved one test call on 2026-10-23.

**D12. 2026-10-23. NCERT corpus is new work, not the Lyzr chunks.** `corpus/ncert-phy12-ch1.json` has 14 paraphrased notes on NCERT Class 12 Physics Part I, Ch 1 (`leph101.pdf`, Reprint 2026-27). Claude Code wrote them on 2026-10-23, with Shaurya's approval. Each page number was checked against the PDF text; in this file, PDF page n is printed page n. These are study notes, not copied textbook passages. Declare as new work in the README and submission. The blueprint's "chunks reused from Lyzr" line no longer applies.

**D13. 2026-10-23. RAG is BM25 with an out-of-syllabus gate and a citation check.** The gate answers only when the best chunk scores at least 2.0 and covers at least 60% of the question's content words. At 50%, "Ohm's law" and "integrate x squared" passed, so the bar was raised. The thresholds were set on the same 22 questions the tests use. A model answer must cite retrieved chunks, using pages inside those chunks, and must share at least 30% of its content words with the cited text. Otherwise the extractive answer is sent, labelled as such.

**D14. 2026-10-23. Memory write-back stores a decision summary, not the student's words.** After each plan turn, the graph adds an H-MEM `episode` record built from intent, decision and topics. Distress turns write nothing. "Forget X" uses H-MEM `store.delete`: it deletes records whose id equals X or whose content or tags contain all of X's words. See Q7. **Correction (~4:30 PM):** the claim "not the student's words" was incomplete. H-MEM's retrieval logs each query on a `read` ledger entry, and the graph queries with the raw message, so raw messages did reach `ledger.jsonl`. Fixed in D15.

**D15. 2026-10-23. Privacy layer over the H-MEM ledger (resolves Q7).** Shaurya asked not to claim complete forgetting while readable text stays in logs, and preferred a deletion record with only id, time and status. `src/memory/studentMemory.ts` now:
- `recall` replaces the query text on new `read` entries with `[query not stored]` and rewrites `ledger.jsonl`.
- `forgetMatching` no longer calls H-MEM `store.delete` (which logs the full content). It removes the records with `store.restoreAll` (rewrites `state.json`), drops links to them, strips `newState`, `previousState` and `details` from every earlier ledger entry for those ids (marks them `redacted: true`), appends a tombstone `{memoryId, action: "delete", timestamp, details: {status: "forgotten"}}`, and rewrites `ledger.jsonl` via a temp file and rename.
Trade-off: the ledger is no longer strictly append-only for those fields; entry count and order are kept. The vendored engine is not modified. Copies outside the app's control are listed in BUILD_STATUS.md (milestone 4).

**D16. 2026-10-23. Study records come through a `StudyDataSource` adapter.** `src/data/studyData.ts`. First implementation reads synthetic rows from `seed/study-records.csv` (riya, kabir), filtered by `student_id`, with `sourceRow = csv:<file>#<line>`. A Zetaris source can implement the same interface later. `sql` is null for the CSV source; the why card still shows no SQL. Not yet wired into the demos, which still use the in-code `RIYA_TOPICS` fixture (same numbers).

**D17. 2026-10-23. Demos read study records through the CSV adapter.** `riya-swap-demo`, `riya-turns-demo` and the new `csv-plan-demo` load Riya's rows from `seed/study-records.csv` via `csvStudyData`. Why-card data reasons now cite `csv:<file>#<line>`. `RIYA_TOPICS` stays in code only as the reference that `test/study-data.test.ts` compares the CSV against. Every demo prints "local CSV (synthetic, not Zetaris)" and the planner name and kind.

**D18. 2026-10-23. Held-out evaluation, frozen before the first run.** `eval/heldout-cases.json`, 44 synthetic cases: 14 doubt paraphrases, 8 word variants, 10 off-chapter questions, 6 memory on/off cases (one control), plus 6 distress cases as an extra. sha256 `b4d9c3ce33c8e1402171867c9fb111d45c15866ab0373faa97a0e05feedaa0e8`, recorded before the first run. No case text appears in `test/`. Runner: `eval/heldout.test.ts` (`npm run eval:heldout`), outside `npm test`, so a miss is a measurement, not a regression. Rules for using it:
- Do not change thresholds, intent rules or the planner to make these exact strings pass. Fix from separate dev examples, then re-measure once and label the result "after fix; held-out set seen once".
- No model is called. Scores describe rules + BM25 + H-MEM only, never model accuracy. A fake-model run must not be reported as model accuracy.

**D19. 2026-10-23. Meterless Runtime adapter behind the existing model interface.** `src/llm/meterless.ts`, written to the official contract for Meterless Runtime 0.90.0 (`docs/agent-ready/add-meterless-provider.md` in meterless/meterless at commit 1742dec; copied to `docs/meterless-provider-contract.md`). It covers:
- URL normalisation to `<host>/v1`.
- Bearer token from `meterless_runtime_token`, or from `<METERLESS_STATE_DIR>/proxy-token`; `rt-local` is refused.
- The `meterless-app: hard-mentor` header on every request, and `meterless-scope: user` on chat.
- Routing-mode model ids (default `meterless/auto`), with unknown `meterless/*` ids kept.
- Status from `GET /v1/models`, not `/healthz`.
- Auto Detect on ports 8088/8090/8787/11434 and hosts 127.0.0.1/localhost/[::1].
- A 180 s timeout.

`LLM_PROVIDER=meterless` never falls back to NVIDIA or OpenRouter. If the runtime fails, the planner falls back to the rule planner, labelled as rules. The smoke script refuses to run under `LLM_PROVIDER=meterless`. H-MEM and the LangGraph flow are unchanged. Nothing was installed or configured, and no runtime was contacted. Tests use mocked fetch only. This does not resolve Q1.

**D20. 2026-10-23. Frozen internal set v2 written and hashed before any fix.** `eval/frozen-v2-cases.json`, 114 synthetic cases (30 distress positive, 20 distress negative, 32 valid Ch 1 doubts, 20 scope negatives, 9 plan-not-doubt, 3 memory intents). sha256 `fcad2d91d3199def1892afe7e66564f75a28031e5220adc56a25be07ff03156c`, recorded before the distress, routing and grounding changes. Fix development uses a separate dev set in `test/`. The frozen set runs once after the fixes. It is an internal evaluation by the same author in the same session: not independent validation, not clinical validation, not evidence of learning gains. The original 44-case file (`eval/heldout-cases.json`, sha256 `b4d9c3ce...`, first results in `evidence/heldout-eval-20261023-165647.json`) is unchanged; reruns of it after fixes are regression results, not held-out results.

**D21. 2026-10-23. Distress families, textbook routing and evidence-based grounding.**
- `src/core/distress.ts`: rules are wording families (suicide and self-killing, ending one's life, death wishes, never-born, no reason to live, self-harm and means, burden/others-better-off, no way out, romanised Hinglish, Devanagari), applied to a normalised string. It stays a keyword screen: not clinical, misses indirect or coded wording, flags some non-crisis text (kept visible in `test/fixtures/distress-dev.ts` KNOWN_FALSE_POSITIVES). Distress is classified before every other intent, so it bypasses quizzes, plans, swaps, doubts, forget requests, retrieval and memory write-back. The returned state replaces the message with a placeholder. Trace and why card hold rule ids only.
- Routing: "study" alone is no longer a plan cue. Question leads (can, where, do, are, ...), Hinglish question words and definition words route to a doubt unless schedule wording is present. "Can I ..." questions are decided by whether the Ch 1 notes support them. Bare topic phrases route to a doubt only when the notes support at least two key terms.
- Grounding: IDF-weighted coverage of the question's key terms by the answering chunk (replaces the raw 60% word count), a small plain-language alias lexicon, stemmer and typo handling, and a list of out-of-chapter concepts (potential energy, capacitors, current electricity, magnetism, optics, ...) that must appear in the notes or the question is refused with a scope-limit message.
- Citations: beyond real chunk and pages, each cited chunk must add a distinctive answer term no other citation supplies, cited text must cover the question's key terms, and numbers in the answer must appear in the cited text.
- Thresholds were set on `test/fixtures/rag-dev.ts` and the earlier 22 questions, not on either eval file. Limit: matching is lexical. A concept mentioned once in a note counts as present.
- Sessions: the Meterless 1.4 / provider-contract v4 reconciliation was taken by another session (`docs/meterless-contract-reconciliation.md`); this session did not touch `src/llm/meterless.ts`.

**D22. 2026-10-23. Phrase-level evidence in grounding; v2 becomes a development set.**
- Problem: four valid Ch 1 questions in frozen v2 were answered from a related-looking note (the citation did not support the answer), and one question the notes do not cover (finite charged rod) was answered. The gate counted single words anywhere in a note, so "line" in "field lines" counted for "line charge".
- Change (`src/rag/ncert.ts`): the question is split into phrases (runs of adjacent content words; the last word is the head). A note "states" a modifier-head pair when both occur within three words in one clause. Every matching note is a candidate, not only the top 3. The answering note is the one with the highest support: weighted question terms plus weighted phrase pairs it states. The coverage gate is unchanged. A known modifier-head pair narrowed by a word the notes never use ("finite charged rod", "solid charged sphere") is refused with a coverage-limit explanation; the first word of the question is excluded because it is usually a request verb. Small additions: aliases third/another/additional to other, line to linear, direction to away/toward/radial/along; "each" as a stop word; write/describe/discuss/list as request words; a mechanics (laws of motion) out-of-chapter concept.
- Every grounded answer now records `support` (chosen note, phrase pairs, terms) and the extractive reply ends with a "Why this note" line. `scripts/grounding-why.ts` prints this for any question.
- Not a case blacklist: no case id or exact sentence appears in the code. But the aliases and the narrowed-phrase rule were written while looking at the five v2 failures. From now on frozen v2 is an internal development evaluation, not unseen held-out accuracy, and every rerun of v2 or of the original 44 is a regression check. Both case files and their first-run evidence stay unchanged.
- Fresh check: 14 new questions written after the change and run once (`test/grounding-phrases.test.ts`): first run 12/14. One miss was a rule flaw (the request verb "Write" read as a narrowing word), fixed generally; the other ("adding another charge nearby...", answered by neither note and refused) is kept as a known limit. After the fix 13/14; that file is now a regression check too.
- Limits: still lexical. "Write Coulomb's law ... in vector form" is answered from the Coulomb's-law note although the note has no vector form. The narrowed-phrase rule cannot tell a narrowing adjective from an unrelated unknown word.
- Connect link: `parseConnectLink` in `src/llm/meterless.ts` parses `http(s)://<host>:<port>/connect#k=<key>[&m=][&n=]`, pure and mock-tested. It rejects a key in the query string, credentials before the host, other schemes, the `rt-local` placeholder, non-`meterless/*` models and bad app ids. Errors never contain the link, key or fragment. It is not wired into env loading, contacts no host, and activates no provider.

**D23. 2026-10-23. One adaptive agent: exam context, quiz and mastery write-back on the existing graph.**
- Direction from Shaurya: one study agent where the student names exam, country and goal; the agent researches, checks official sources, resolves ambiguity, then plans with progress and memory. No per-exam builds or hand-loaded profiles.
- Structure (additive, no graph rewrite): `src/context/examContext.ts` defines `StudentGoal`, a `ResearchSource` interface, per-fact sources (URL, publisher, fetched-at, published-at, note), `checkFact` and `researchExam`. Several matches produce a question to the student; the reply or a distinct word in the goal resolves it. A fact counts as verified only if it was fetched from the web and its host is one of the exam body's official domains. The exam date is the verified official date if one exists, otherwise the date the student stated, labelled as such. `StudentContext.exam` carries the result into the graph, and the recall node writes one trace row with it.
- Only a MOCK research source exists: `src/context/fixtureExams.ts`, three Indian Class 12 boards written from general knowledge, no dates, weightages or cut-offs, nothing fetched. Every fixture fact is "unverified" by construction. Any other exam gets "not found; web research is not built yet". A web `ResearchSource` needs network access and is not built until Shaurya approves it.
- Quiz (`src/quiz/quiz.ts`): fill-in-the-blank items cut from Ch 1 note sentences; the blank is the sentence's rarest content word across the notes; distractors are other notes' blanks; each item cites chapter, section and pages. No model. Limit: it tests recall of the notes' wording, not problem solving, and some blanks are weak words ("comparatively").
- Write-back (`src/quiz/writeBack.ts`, `recordQuizResult` in `src/data/studyData.ts`): grade, `updateMastery`, rewrite the student's row in a working copy of the study-record CSV, append a quiz-log row (quiz id, score, mastery before and after, note ids), and store an H-MEM record with the score and the missed notes, never the typed answers. `csvStudyData(file, quizLog)` attaches the latest quiz to each topic, and the rule planner cites it as a `quiz` reason. Distress wording in any answer stops grading and writes nothing.
- The quiz is called from the journey script, not yet from a graph node. Next connection: a `quiz` intent and node.

**D24. 2026-10-23. Quiz inside the conversation; per-student session around the graph.**
- The quiz is a graph node. Three new intents are routed after the distress check: `quiz_start` ("quiz me", "start a quiz"), `quiz_answer` and `quiz_cancel`. While a quiz is open, every other message is read as answers, except cancel and memory requests. A message that is only answer letters, with no quiz open, is reported as already scored or as no quiz open; it is never sent to the planner.
- The open quiz is not kept inside the graph. The caller passes `activeQuiz` in and gets the updated one back. `src/agent/conversation.ts` keeps it in a small per-student session file (`sessions/<id>.json`), together with intake answers, the resolved exam context and the last plan. The student id goes through the same check as the H-MEM folders, so sessions cannot mix. No LangGraph checkpointer is used. This keeps the graph stateless per message, as before.
- Nothing is saved until every question has an answer. Cancel, distress or a stray message saves nothing. A quiz id is scored once per student: `submitQuiz` returns `already_recorded`, and `recordQuizResult` throws if the quiz log already has that id for that student.
- Answers are matched only as an option letter (A to D) or the exact option word. "pass" is recorded as no answer. Anything else is reported back to the student, not guessed.
- Feedback for a wrong item quotes the note sentence with the answer filled in, and its citation. The why card cites the quiz-log row, the study-record row, the H-MEM record and the note ids.
- Intake is a fixed question sequence in the session layer: exam, country, goal, then date ("not sure" allowed; 120 days assumed and stated). It then calls `researchExam`. Distress is checked before every intake step, and the step does not advance. Moving intake into a graph node is possible later, but it was not needed for this loop.
- After a plan, the session compares mastery and priority with the last plan and states what changed. The "top topic changed" or "unchanged" line comes from the ranked numbers, not from free text.

**D25. 2026-10-24. Web exam research from public pages, authority gated by domain type.**
- Shaurya authorized free, read-only reading of public official exam sites for this batch. Wikidata's keyless public API is used only to nominate the official site from the exam name (the one query sent out). This is a discovery step on a third-party site, not an exam site; flagged so Shaurya can object.
- A nominated site counts as an exam authority only if its host is under a government or education suffix. Wikidata alone never makes a fact verified. A body on .org/.com is read as nothing and reported as such.
- No exam profiles were added. Unknown or unreadable results stay unknown; the student can continue without research. A student-stated date stays labelled student-stated.
- Not done: PDFs, pinned-IP fetch, a model reading the pages, discovery beyond Wikidata (no search engine is available without a key).

## Open questions for Shaurya

**Q1. Nightshift / Meterless Runtime eligibility.** The setup resources describe Nightshift as the primary provider path. The latest announcement settles coding-tool choice only. Unresolved whether a final entry may skip Nightshift. Still unresolved after D19: the adapter shows Hard Mentor *can* use the Meterless Runtime; it does not establish whether a final entry *must*. Options: (a) Shaurya checks the platform/Discord himself; (b) approve a message to organizers; (c) proceed without Nightshift and disclose. No organizer contact without approval.

**Q2. Model provider and spend.** Approved 2026-10-23: one test call to NVIDIA with a made-up prompt; on failure, OpenRouter. The smoke script is ready (`npm run smoke:model`). ~4:35 PM: Shaurya asked to defer key setup and live calls. Claude created `~/hard-mentor/.env` from `.env.example` with empty placeholders (mode 600, git-ignored). Before any live call, Claude reports the exact model, request/token limits and billing exposure for approval. No model call has been made yet.

**Q3. Pre-existing NCERT chunks/prompts.** Resolved 2026-10-23: Shaurya chose a new Electrostatics set, declared as new work (D12).

**Q4. Zetaris data path.** Use the local Docker install at `~/zetaris-setup/zetaris-platform` for synthetic sources (Postgres + CSV). The blueprint's S3 and Google Sheet sources assume cloud resources; local CSV files replace them unless Shaurya approves otherwise.

**Q5. Consent design contradiction.** Blueprint says both "nothing persisted before consent" and "pending sessions in Postgres". Proposed: pending onboarding held in memory only, discarded on restart; demo uses a fictional account; no real emails sent. Needs Shaurya's OK.

**Q6. Confirm event-platform track is Track 03.**

**Q7. Resolved 2026-10-23 by D15** (Shaurya: deletion record with id, time and status only). Original question kept below.

**Q7 (original). "Forget" leaves content in the audit ledger.** H-MEM's ledger is append-only. A `delete` entry keeps the deleted content in `previousState`, so "forget" removes the memory from use and from `state.json` but not from `ledger.jsonl`. The reply tells the student that an audit entry remains. Options:
- (a) Keep it and disclose it.
- (b) Add a local wrapper that writes deletes with redacted content. This changes the engine's audit guarantee.
- (c) Propose a redaction feature upstream.

Leaning (a) for the hackathon, plus (b) before any real student uses it.
