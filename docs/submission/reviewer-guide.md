# Personalised Mentor: the student journey

A useful plan answers two questions: “What should I study next?” and “Why that topic?” The local browser and terminal routes follow one fictional student from intake through a changed recommendation. Start with the [typed browser recording guide](recording.md) and [actual samples](samples.md).

## Earlier terminal evidence — distinct from the Oct 28 browser run

Open [actual chat output](evidence/chat-actual.txt). Its banner identifies mock exam research, rule planning, local synthetic CSV records and per-student H-MEM. The execution date is in [runs.json](evidence/runs.json); the simulated study clock is fixed at 2026-10-23. The date 2027-02-15 is the fictional student's statement, not an official exam date.

Intake asks which board “12th boards” means. Choosing CBSE resolves the ambiguity; the supplied exam facts remain explicitly UNVERIFIED. The demo only has quiz notes for NCERT Class 12 Physics chapter 1.

The initial why-card prints this actual reason:

```text
Electrostatics is your top priority: mastery 0.35, marks weight 0.8, priority 0.656  [data_row: csv:study-records.csv#2]
```

The calculation in [priority.ts](../../src/core/priority.ts) is `(1 - mastery) * marksWeight * (1 + 30 / max(daysToExam, 1))`. The weights are demo inputs, not official CBSE weightage. The why-card is assembled from structured state and provenance, not a free-text claim of evidence. On the CSV demo it honestly reports that SQL is unavailable.

A quiz question asks the student to complete the statement about sparks and charge “discharging”, citing NCERT Physics Part I, Class 12, Ch 1, §1.1, p. 1. The question is built from the [local paraphrased corpus](../../corpus/ncert-phy12-ch1.json); it is not freshly retrieved textbook text or a live model's answer.

The first completion scores 4/5 and writes mastery 0.35 → 0.485, quiz-log row 2 and memory `mem-2`. The duplicate completion reports “already scored” and writes nothing. A second quiz is cancelled after two answers, with no score; its retake scores 5/5. There are exactly two saved attempts in the resulting progress view.

After that retake, the plan prints:

```text
Today: Integrals first for 90 min, then Electrostatics and Organic Chemistry.
Top topic changed from Electrostatics to Integrals: Integrals now has the highest priority (0.441 vs 0.363).
```

The why-card cites `csv:quiz-log.csv#3` for the quiz that changed Electrostatics mastery. The update is `0.7 * oldMastery + 0.3 * score`, rounded in the record to 0.64. This demonstrates plan adaptation; it does not establish educational effectiveness. The opening two-hour problem is illustrative; this recorded Riya fixture uses a three-hour budget and gives its top topic 90 minutes.

## Student control and safety

The [actual memory-control run](evidence/controls-actual.txt) repeats the journey, then turns memory off, lists existing summaries, forgets plan and quiz memories, confirms an empty list and turns memory on again. Its [input](evidence/controls-input.txt) is reproducible. Memory off stops recall and new H-MEM summaries while retaining existing memories for inspection/forgetting; it does not stop separate study-record and quiz-log updates.

Passing application tests in the [scoped verification](evidence.md) check student isolation, persistence across process restart, forgetting, authenticated synthetic withdrawal/deletion, stale handles and distress paths. Distress tests compare stored bytes and file metadata and assert no new session/memory/score writes. These are fictional tests; parental verification and production retention remain unresolved. There is no production consent issuer or deployed student interface here. The local browser is fictional-only, starts memory off and does not expose general student-record deletion.

## Source map

| Role | Owning source |
|---|---|
| Conversation and intake | [conversation.ts](../../src/agent/conversation.ts), [chat.ts](../../scripts/chat.ts), [shared environment](../../scripts/chat-environment.ts), [loopback server](../../scripts/record.ts), [browser](../../src/recording/index.html), [HTTP test](../../test/recording.test.ts) |
| Agent graph and checks | [graph.ts](../../src/agent/graph.ts), [checker.ts](../../src/core/checker.ts) |
| Ranking and why-card | [priority.ts](../../src/core/priority.ts), [whyCard.ts](../../src/agent/whyCard.ts) |
| Quiz, score and duplicate guard | [quiz.ts](../../src/quiz/quiz.ts), [writeBack.ts](../../src/quiz/writeBack.ts), [progress.ts](../../src/quiz/progress.ts) |
| Memory and storage scope | [studentMemory.ts](../../src/memory/studentMemory.ts), [storageGate.ts](../../src/consent/storageGate.ts) |
| Live data / model seams | [zetarisStudyData.ts](../../src/data/zetarisStudyData.ts), [modelPlanner.ts](../../src/agent/modelPlanner.ts) |

The [committed golden transcript](../../test/fixtures/chat-default.golden.txt) is **STORED EXPECTED OFFLINE OUTPUT** for an initial plan only. It is not the fresh chat receipt and does not demonstrate the complete quiz loop.
