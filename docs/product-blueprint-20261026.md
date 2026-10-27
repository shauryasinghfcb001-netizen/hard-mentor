# Hard Mentor - final product blueprint (Oct 26, 2026)

Purpose: the target product definition for anyone building on this repo. Section 2 is the TARGET. Section 3 is where the code actually is today - do not confuse the two. This document grants no new authority; the standing limits in section 5 apply. Where this file and the repo disagree on what the code does, the repo wins; where it and the owner's stated scope disagree, stop and ask.

## 1. What the product is

Hard Mentor is an EXAM-AGNOSTIC study agent (today a CLI). A student may name any exam in intake - any country, board, level, or kind: school boards, entrance exams (JEE/NEET-style), university or professional certifications. That is intake flexibility, not a promise that every exam is discoverable or covered: the agent researches the named exam from public official sources, and whatever it cannot verify stays "unknown" - never guessed. It then answers the student's real question: "I have plenty of content - what should I do next?"

CBSE Class 12 and the fictional student "Riya" are the demo test case, not the product boundary. Nothing in the target product is hardcoded to CBSE, India, school grades, or any single exam.

## 2. Target behavior (the full original scope: 11 features + 3 blueprint behaviors)

INTAKE AND PROFILE (F1): learn the student's exam, country, goal, exam date and available study time; use them in every later turn.

EXAM-AGNOSTIC RESEARCH (B12): when a student names an exam, research it live:
- Data minimization: the only text that may leave the machine is the exam-name field. Years are stripped; anything PII-shaped (roll numbers, phone-like numbers, marks, ages, narrative sentences) is rejected before any request. School-exam grade markers ("Class 12", "Grade 10") are naming-convention support, NOT an age restriction and NOT a signal to infer or store anything about age. The current numeric rule (a grade word followed by 1-12) is the CURRENT implementation constraint, not a frozen final-product restriction: exam names may legitimately carry other numbers, and any future generalization must preserve the privacy guarantee and be grounded in a reviewed design, not assumed.
- Discovery from public sources (Wikidata-style entity discovery plus the exam body's official pages), resolved by asking the student when ambiguous.
- Transport: HTTPS-only, DNS-validated and IP-pinned fetches (rebinding defense), per-hop redirect revalidation, trusted-authority domain checks. Note: the current trusted-domain heuristics may be India-centric; a globally correct official-domain verifier is target behavior, not established current capability.
- Honesty: a fact is marked verified-official ONLY when actually fetched from the exam body's official domain. Anything not found stays "unknown" - never guessed, never hardcoded.

DATA LAYER (F2): study data served through Zetaris, fail-closed with honest labeling ("Zetaris unavailable"), never a silent fallback.

PLANNING (F3, F4): a ranked next-task plan computed from (1 - mastery) x marks weight x urgency, weaker topics first; every recommendation carries a why-card with reasons, source rows, and SQL when the source provides it.

QUIZZES (F5, F9): short cited quizzes; a completed quiz saves exactly one scored attempt; cancel/distress/re-answer saves nothing. Textbook Q&A answers ONLY from the available lawful corpus, with chapter/section/page references; anything outside the corpus is clearly refused. Corpus expansion beyond what exists is an owner decision (sources, licensing, scope) - never automatic scraping or ingestion.

ADAPTATION (F6): after a scored quiz, the next plan visibly re-ranks and explains the change.

MEMORY (F7, F8): persistent H-MEM memory the student can list and forget; forgotten items disappear and the deletion is ledger-logged; conformance-suite pass is part of done.

MODEL (F10, F11): live model proposals through the Meterless/Nightshift lane, validated by the deterministic checker before use; the labelled rule planner is the honest local fallback; a fallback is never reported as a live-model success.

CONSENT (B13): before any student data persists, a real consent request goes to the parent by email, and storage unlocks only after a verified parental grant. (The exact verified-grant mechanism is an owner decision - see open decisions.)

DISTRESS (B14): a distress message bypasses all other handling, gets a supportive reply, and writes nothing. The current demo response includes the Tele-MANAS 14416 helpline - an India-specific resource matching the India demo. Region-aware helpline support for a global rollout is unresolved and is an owner decision, not a claim that 14416 applies everywhere.

## 3. Current state (Oct 26 evening - distinct from the target)

- Working offline on fictional data: intake/profile, ranked plans with why-cards, quizzes with saved attempts, adaptation, memory write/recall/list, distress handling, offline demos and proofs. A real Zetaris query ran Oct 25 (4 rows); in-product Zetaris read reported.
- Web research: transport fix implemented + one live smoke passed (CBSE Academic page, 61,173 bytes). Grade-marker guard accepts "Class 12"-style names; narrative rejection tightened and board-name discovery fixed Oct 26 evening (250 tests + typecheck builder-REPORTED). Subsequent repair batch passed 257 tests and typecheck: safe HTTPS nomination, stricter discovery matching, redirect/robots protections and quoted exam evidence were added. A newly authorized bounded live session discovered JEE Main, but its official robots.txt returned 403. It stopped with zero official facts; CBSE and the invented exam were not exercised in that session. The full research acceptance remains open; see evidence/research-acceptance-20261026.json.
- Model lane: no validated live product-path turn yet (Oct 25: live request -> 502, honest fallback; Oct 26: token_missing, zero requests). The owner subsequently authorized the existing in-memory credential availability check; it completed and found no usable credential in the environment or clipboard. Zero model requests were sent by that check. Live model acceptance remains blocked on a usable securely supplied credential; this is not evidence of a code defect. A separately authorized recheck also found token_missing, with zero model requests (evidence/model-availability-recheck-20261026.json). Any further credential read requires fresh authorization.
- H-MEM engine conformance: PASS, 13/13 upstream checks at the existing pinned revision through the product engine loader (evidence/hmem-conformance-20261026.txt). The application privacy wrapper retains the approved D15 ledger-redaction trade-off, outside this suite. B13 consent is absent; a design proposal is prepared for review, not approved for implementation. F10 live receipt, F11 product-path turn and B12 verified-fact completion remain OPEN.
- Distress conversation guard subsequently passed filesystem snapshot and storage-initialization regressions (261/261 full tests + typecheck, including cross-student isolation and corrupt-session support). It writes no files and cancels an open quiz in process memory. Owner decision (Oct 26): keep saved-quiz resumption and explicitly flag its limitation. The earlier saved quiz can reopen if the process restarts before the next ordinary turn persists the in-memory cancellation. No durable distress marker is written; this accepted limitation does not establish complete distress acceptance.
- Uncommitted local work on 43c83e6 must be preserved; nothing committed/pushed without owner approval.

## 4. Explicit non-boundaries and open decisions

- Mentor AI integration (existing website vs Android app) is a SEPARATE unresolved owner decision, not part of this product's boundary.
- The following are NOT requirements unless the owner decides them: parent dashboard, Telegram bot, teacher write-back, multi-chapter prebuilt corpora, per-exam hardcoded profiles. If a builder believes one is needed, it is a decision request, not a build task.
- The purchased ChatGPT subscription is the builder's tool. The product's provider architecture (Meterless/Nightshift lane, sponsor requirement) does not change because of it.
- Acceptance for exam-agnostic research has TWO required sides: (a) at least one supported non-CBSE exam yields researched, official-domain-verified facts with sources - an honest "not found" alone does NOT prove the feature works; and (b) an unavailable or undiscoverable exam yields a safe "unknown" with no guessing and privacy rules intact. Where coverage ends, the gap is stated explicitly rather than smoothed over.

## 5. Standing limits

- No commit/push/merge/deploy, public repo, submission, new provider/account/package/spend, or real email sending without explicit owner approval each time.
- Fictional/synthetic student data only; no erased history; secrets via environment variable names only - never printed, committed, or pasted in chat.
- Honest labels always: implemented != verified; offline != live; reported != reproduced. No completion percentages, no time estimates, no hardcoded outputs, no fabricated activity (Rules 7.3).

## 6. Subsequent implementation record (Oct 26, local only)

Owner explicitly authorized consent implementation, bounded research and the
configured fictional integrated loop, then supplied DEVELOPMENT consent defaults.
The latest reconciled implementation/evidence record is
[implementation-continuation-20261026.md](implementation-continuation-20261026.md).
Consent components and gates now exist and pass fictional isolated tests; real
storage stays locked. Mentor AI's actual website source was supplied on the SSD;
its external-agent boundary is implemented/tested locally with fake backend and
rules, without changing the website. The older website-versus-app choice no longer
blocks this local boundary implementation.

Final local suite: 275/275 plus typecheck. Live research acceptance still lacks a
positive official non-CBSE fact (invented exam unknown; CBSE robots 403; no bypass).
Integrated model acceptance is still open: the process environment had no token;
auto-review rejected loading the existing configured .env, so that command did not
execute. This is not full product completion and does not grant production consent,
email, deployment, spending or another live research session.
