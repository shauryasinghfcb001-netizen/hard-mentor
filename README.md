# Personalised Mentor

**Know what to study next. See why. Watch the plan adapt.**

A student has two hours and a pile of chapters. Personalised Mentor turns that into an explained next step: rank the topics, show the evidence, quiz from cited material, then change the plan after the score.

Different exams are the product goal. The verified demo case is a fictional board-exam student, not proof that every exam is supported.

**[Watch the 2:44 prototype walkthrough](https://youtu.be/lRF69y5Ztmw)**

There is no hosted Personalised Mentor demo. The available review surface is a typeable, loopback-only local browser, with the terminal conversation also available. Start `npm run record` in an already prepared checkout; follow the [recording guide](docs/submission/recording.md). The offline journey uses synthetic study records, mock exam research and a rule planner; it does not exercise the live Zetaris connector or Nightshift. The full live model loop has not passed.

## Review it in five minutes

1. Read the [student journey and why-card](docs/submission/reviewer-guide.md): a cited quiz changes mastery and eventually the next topic.
2. Inspect the [typed browser journey and two saved attempts](docs/submission/samples.md), then the [earlier actual offline chat output](docs/submission/evidence/chat-actual.txt) and its [run provenance](docs/submission/evidence/runs.json). The repeated completion is saved once; the second completed quiz changes the top topic.
3. Follow the [setup and offline usage guide](docs/submission/setup.md) to reproduce the conversation. No model credentials are required for this offline route. Clean installation remains unverified because dependency and H-MEM downloads failed DNS resolution during this packaging run.
4. Read [sponsor roles and component declarations](docs/submission/declarations.md), then the [evidence and limits](docs/submission/evidence.md).

The repository and package identifiers remain `hard-mentor`; the product name is Personalised Mentor. Slide deck: assets pending; no deck is included in this checkout.

## One student, one changing plan

Riya is fictional. Her scripted demo budget is **three hours**, her exam date is student-stated, and the marks weights are synthetic placeholders. She chooses CBSE after the ambiguous phrase “12th boards”.

| Step | Actual offline result |
|---|---|
| Rank the topics | Electrostatics first: mastery 0.35, marks weight 0.8, priority 0.656; the why-card cites `csv:study-records.csv#2`. |
| Quiz from cited notes | Five rule-built questions cite NCERT chapter, section and printed pages. These are recall questions over local paraphrased notes. |
| Complete quiz 1 | 4/5; mastery 0.35 → 0.485; one score is saved. Repeating the completion does not save it again. Electrostatics stays first. |
| Complete quiz 2 | 5/5; mastery 0.485 → 0.64; Integrals becomes first, priority 0.441 versus Electrostatics 0.363. |
| Inspect and control memory | List the per-student H-MEM summaries, turn memory off, and forget them. Forgetting memory does not erase the separate quiz records. |

These are results of fresh execution on fictional inputs, not model-generated study advice or evidence of improved learning outcomes.

Natural-language onboarding still misreads some inputs. Improving intake and recovery is the next step before wider use. See the [exact input](scripts/quiz-conversation.txt) and [actual output](docs/submission/evidence/chat-actual.txt).

## What supports the loop

The conversation routes through a LangGraph agent, ranked study records, a planner, a deterministic checker and a why-card. Reasons reference data rows, quiz results, local notes or memory IDs. The default planner is `rule-planner-v1`. Model proposals have a separate validation path; a rejected proposal or a provider error must not be presented as model success.

Zetaris supplies the live data-layer seam; H-MEM supplies working local per-student memory. Nightshift is the intended primary model provider, with unaccepted live proposals and a later timeout in inspected historical receipts. NVIDIA is a candidate generation lane and has not run. [Full declarations](docs/submission/declarations.md) separate new work, starter code, external dependencies and the separate pre-existing Mentor AI product.

## Current evidence and material limits

| Area | Status and review limit |
|---|---|
| Offline loop | Builder-recorded typed browser journey: 4/5 then 5/5, no duplicate, two persisted attempts, mastery .35 → .485 → .64, then Integrals. Memory-summary forgetting preserves scores. Existing dirty checkout, fictional CSV, fixtures and rules; no live inference. |
| Memory and distress | Earlier Oct 27 H-MEM conformance passed 13/13; it was not rerun for the browser build or this release check. Application tests cover isolation, forgetting, deletion and distress paths without data writes; this is not clinical validation or production consent approval. |
| Verification | Oct 28 browser-build typecheck, 43 focused tests and 1 HTTP integration test passed. Historical broader run: 302 passed, 2 failed, 2 skipped, two external files excluded. Both failures remain; no full-suite pass. [Scope and causes](docs/submission/evidence.md). |
| Live sponsors | Historical live-loop receipts confirm a Zetaris read check, rejected model proposals and a later model timeout. The separately reported four-row, zero-model-call query receipt was not found. No full live-loop pass. |
| Setup and assets | Public source is available on this branch. The walkthrough is linked above. The slide deck is supplied separately with the submission. Clean setup remains unverified after download failures. |
| Coverage and rights | Demonstrated notes cover NCERT Class 12 Physics Ch 1. Corpus provenance is repository-stated; upstream Meterless Apache-2.0 text is now preserved, but project licensing, modification notices and NCERT reuse rights remain unresolved. |

The submission requirements include Nightshift as primary provider with a working integration. Offline packaging does not establish that requirement or eligibility. Mentor AI is a separate pre-existing product, not a hosted version of this project.

Planned work: with explicit student permission, activity across days and self-reported focus patterns could inform future recommendations. This is not shipped functionality or cognitive-state measurement.
