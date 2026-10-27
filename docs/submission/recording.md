# Personalised Mentor: local browser recording

This is an offline, fictional-only loopback prototype using the actual conversation core. It is not public hosting or the separate pre-existing Mentor AI service. No video or deck asset is included.

## Start and stop

In an already prepared `hard-mentor` checkout with installed locked dependencies and the pinned H-MEM copy, run:

```sh
npm run record
```

Open **http://127.0.0.1:4317** on the same machine. Keep the terminal running; Ctrl+C stops it. Restart with the same command and reload. Port 4317 must be free. [Setup and dependency requirements](setup.md) describe the unresolved clean-install DNS failure; the successful local run reused installed dependencies, and no clean clone acceptance is claimed.

The launcher clears inherited provider settings, chooses CSV/offline fixtures/rules and binds only `127.0.0.1`. It starts memory off. Keep the “Local prototype | fictional data | rule-based/offline” label visible while recording. Do not enter real student data. The fixed simulated study date is **2026-10-23**; the builder recorded this journey on **28 October 2026, Asia/Calcutta**.

## Type this fictional case

Enter each line separately (Enter or Send; Shift+Enter inserts a newline):

```text
12th boards
India
90% in PCM
15 Feb 2027
CBSE
Plan my study for today.
why this plan?
quiz me
B, B
Q3: directions, Q4: A, Q5: D
Q3: directions, Q4: A, Q5: D
Plan my study for today.
quiz me
C, B, B, C, C
Plan my study for today.
my progress
```

These choices correspond to the actual generated questions for this fixture/date; read each question if using different input. The first completion scores 4/5, moving mastery .35 → .485. Its repeated completion adds nothing. The second scores 5/5, moving .485 → .64, after which Integrals ranks first. [Actual typed output](evidence/recording-20261028/final-transcript.txt), [two persisted attempts](evidence/recording-20261028/final-quiz-attempts.jsonl), [score log](evidence/recording-20261028/final-quiz-log.csv) and [updated study records](evidence/recording-20261028/final-study-records.csv) are available. These quizzes check recall of note wording, not problem solving or learning efficacy.

## Memory, reset and errors

Click Memory on, request another plan, then List memories. Memory off stops new summary writes/recall and keeps existing summaries. List memories and Forget plan summaries work while off. The recorded journey creates one plan summary, retains it while off, then forgets it; both quiz scores remain. No quiz summary existed in that run because the quizzes were completed with memory off. Forgetting summaries does not delete scores, attempts or the fictional transcript. The browser has no general student-record deletion control.

Begin fresh fictional demo creates isolated temporary state with original mastery, zero scores and memory off; it preserves earlier scratch files. Reload retains the session while its server runs; restarting the server starts fresh. Tabs in a browser profile share a session cookie. Old temporary files are not automatically reopened and may be cleaned by the OS. The process caps creation at 64 sessions; restart if reached.

Only fictional Riya and the local fixture/notes are supported. The [actual unsupported case](evidence/recording-20261028/unsupported-transcript.txt) declines a quiz after an unresolved exam and explicit continuation without research. A stopped server shows an error and retains typed input; restart/reload to continue with a fresh session.

## Verification and boundaries

Builder-recorded browser-build checks: typecheck passed; 43 focused tests passed; 1 actual loopback HTTP boundary test passed. The [evidence record](evidence.md) distinguishes these from earlier broad tests and conformance. This release check inspected local files/hashes and did not rerun models or tests. Nightshift is intended primary with live integration in progress; NVIDIA generation has never run. Public access, platform integration, clean installation, third-party permissions, recording/deck publication and submission remain unresolved.
