# Local implementation and actual acceptance evidence

This record supersedes older review-only/unimplemented entries for the components
below. It does not establish full connected-product completion.

## Consent development components

`src/consent/requests.ts`, `http.ts`, `storageGate.ts` and `deletion.ts` implement
request creation, simulated delivery to reserved `.invalid` addresses, hashed
single-use challenges, expiry, versioned explicit attestation, session/student
binding, receipt validation, authenticated withdrawal and scoped deletion.

Pending state writes no files. GET/prefetch, missing attestation, mismatched notice,
wrong session/student, expired tokens and replay cannot grant access. Sending
failure leaves the request ungrantable. No sender service is implemented or called.
  The HTTP handler is a local host integration component; it binds no socket and
requires a host-supplied authenticator. Test authentication is fictional.

Normal storage roots are denied. A simulated grant enables only its fresh,
factory-created temporary sandbox, for the named fictional student. Pre-authorized
fixture sandboxes are explicitly separate from consent sandboxes. Conversation,
graph persistence paths, memory initialization/helpers, quiz history, attempts,
CSV write-back and the chat seed-copy path enforce the gate. No data in this
checkout, its old evidence or the SSD source was migrated or deleted.

Withdrawal checks the authenticated actor's role and student scope. It revokes
before deletion, removes pending requests/receipts, deletes the student's session
and H-MEM directory, and removes their rows from shared study/quiz/attempt files.
Other students' rows remain. The audit contains event type, random event id and
time only. Old application handles cannot read or resurrect deleted data after a
new grant. A deletion/preflight error returns failure and keeps access locked.
Arbitrary copies outside these application stores are outside this deletion API.

Receipts are volatile; no production retention period is selected. Real student
storage, real email and parental identity verification remain unavailable. A token
proves possession, not parental identity.

The terminal fictional demo can allocate its own isolated fixture root:

```
npm run chat -- --fictional-scratch
```

This is a fictional fixture mode, not simulated approval for product storage.
Existing real/unspecified data roots remain locked. Saved quizzes still resume
as before within authorized fixture storage; no interactive-resume feature added.

## Research

Fixed discovery of a conducting body's exam links when the landing page itself
does not name the exam. Added operator (P137) as a nomination relation when an
organizer (P664) is absent. Exact official syllabus/format excerpts preserve URL,
fetch time and quoted evidence; no complete syllabus or planner weight is inferred.
HTTPS, public-IP pinning, redirect isolation, privacy filtering, page caps and
robots/access restrictions remain in force.

One authorized 90-second-bounded session ran, using only a child-process live flag:

| Case | Actual result |
| --- | --- |
| Civil Services Examination | Wikidata discovery returned an entity but no current site pointer through the then-supported relations. No official fact verified. |
| Moonstone Imaginary Assessment | No entity found; safely unknown. |
| CBSE Class 12 | Nominated HTTPS host's robots.txt returned 403; immediate stop. No official pages or facts. |

All three cases ran; no cases were omitted. No retries, JEE Main requests or
restriction bypasses occurred. Receipt:
`evidence/research-acceptance-20261026-implementation.json`.
The operator-relation repair was added after that session and tested offline only;
there was no further live run. Positive non-CBSE official-fact acceptance remains
OPEN. Unsupported dates and facts remain unknown.

## Live study loop

The verifier now uses the existing `meterlessFromEnv` resolver, with no clipboard
path, and respects its configured base/model/state directory. No credential
handling inside the resolver changed. Requests have automatic retries disabled.
A successful first proposal must be validated and backed by Zetaris provenance.
The scratch scoring baseline is then materialized from those actual returned rows,
not unrelated seed mastery. The runner checks cited quiz, exactly-one saved score,
updated mastery, changed priorities/explanation and a validated next model plan.
Remote Zetaris data remains read-only.

The process-environment run returned `token_missing` before any model request.
An attempt to use the documented local `.env` loading was rejected by automatic
approval review and DID NOT EXECUTE. No clipboard was read, secret printed,
credential rotated or retry/workaround performed. See
`evidence/integrated-loop-20261026-current.json` and
`evidence/integrated-loop-20261026-approval-block.json`.
A standalone existing Zetaris runner in the process environment also reported
`Zetaris unavailable: not configured` (`evidence/zetaris-20261026-current.txt`).
These are configuration/approval failures, not live model or data success.

## Mentor AI local integration

Source inspected on the SSD: `cbse-90-board-mentor`, HEAD
`92e52e4f58f6ea3ff0bb735a3ad145901d72deb5`. File hashes and source provenance are in
`evidence/mentor-ai-20261026-source-provenance.json`.
The source is a Preact website with Netlify functions. No Android architecture,
endpoint or data mapping was invented.

`src/integrations/mentorAI.ts` implements the existing external-agent request and
response boundary. The local host supplies its existing agent authentication token,
an explicit verified-user-to-profile map and a ConversationEnv. Requests require
POST/JSON, are byte-bounded, and use constant-time bearer verification. No browser
identity, readiness, memory or progress field replaces actual study data. Consent
locks return an explicit reply so the upstream does not silently fall into Gemini.

Actual tests used both the SSD's `callAgent` over temporary loopback HTTP and its
`/api/mentor` function with its own fake Supabase backend. The connected function
completed intake, plan, a cited NCERT quiz, 5/5 scoring, repeated-completion rejection,
one saved attempt, mastery 0.35 -> 0.545 and an adapted next plan. It returned
`source: agent`, with **rules**, not a live model. No real Supabase, Gemini or email
request occurred. Receipt: `evidence/mentor-ai-20261026-connected.txt`; the final
full-suite receipt also contains this connected-path result.

The adapter currently supports English and disables H-MEM because the upstream
external-agent contract omits the browser memory toggle. It has not been installed
in the running website or its production configuration. The production website's
own auth/quota/memory behavior is not re-certified by these local seam tests.

## Verification and remaining acceptance

Final implementation suite: 275/275 tests passed, no failures/skips; typecheck
passed. Receipts: `evidence/implementation-20261026-suite-privacy-final.txt` and
`evidence/implementation-20261026-typecheck-privacy-final.txt`. Initial sandbox-only
loopback failures and intermediate receipts remain preserved. Git diff whitespace
check passed. H-MEM engine conformance was NOT rerun; its prior 13/13 stands.
Application memory/privacy tests ran because the storage boundary changed.

Full product acceptance remains open: no positive live official non-CBSE result,
no validated live model/Zetaris/quiz/adaptation receipt, and no real parental
verification/delivery. The smallest actionable live-loop blocker is approval to
load the existing configured environment for the already-requested fictional run;
auto-review rejected that action. There is no request for secrets in chat.

## Live-loop boundary check — 2026-10-27

The current protected runner is `scripts/verify-product-path.ts`, invoked by the
existing owner launcher `zsh scripts/live-run.sh`. It resolves the Meterless
client through `meterlessFromEnv` with `maxRetries: 0` and a 45-second request
timeout. One complete successful loop can issue at most two model requests: the
initial planning turn and the post-score adaptation turn. Quiz, scoring, repeat
protection and the Zetaris connector do not issue model requests. The current
code validates the configured model is a `meterless/*` route, but no current
in-session evidence establishes that this route is local rather than
charge/credit-bearing.

Before any credential-bearing operation, the existing TCP-only Zetaris
preflight was run from this execution environment with the known non-secret
local configuration. It exited 3: the `127.0.0.1:3000` Zetaris UI port was
unreachable from this environment. It made no authentication request, no study
table query, no model request, and no remote write. Therefore no app-side read,
Nightshift proposal, cited quiz, saved score, or adaptation was reached. This
does not contradict the owner's working Mac dashboard session or prove a
container/service failure; it establishes only the sandbox-to-host boundary.

## B12 single-exam acceptance attempt — 2026-10-27

Positive acceptance remains **OPEN**, not passed. Only Civil Services Examination
(India) was selected. The already-completed live negative case and CBSE case were
not repeated. Today's memory wiring, why routing and external-source integration
were not changed or re-certified.

Actual sanitized input to `researchExam(webResearch(...), input, { ranAt })`:

```json
{"exam":"Civil Services Examination","country":"India","goal":"public research acceptance"}
```

The first sandbox invocation failed DNS before any HTTP request. The authorized
network-enabled invocation then used the existing `pinnedHttpsFetch` transport,
a clean process environment (PATH and process-only HM_LIVE_RESEARCH=1), an outer
60-second cap and the existing request/size/page/privacy/robots restrictions.
No alternative transport or provider was substituted.

Actual research requests, each HTTP 200:

1. `https://www.wikidata.org/w/api.php?format=json&action=wbsearchentities&search=Civil+Services+Examination&language=en&type=item&limit=8`
2. `https://www.wikidata.org/w/api.php?format=json&action=wbgetentities&ids=Q5124580&props=claims%7Clabels%7Caliases%7Cdescriptions&languages=en`
3. `https://www.wikidata.org/w/api.php?format=json&action=wbgetentities&ids=Q668&props=labels%7Caliases&languages=en`

Actual output:

```json
{
  "step": {
    "status": "not_found",
    "reply": "I could not find \"Civil Services Examination\" (India). I found no official website for it through public sources (found matching exam entries but none lists a current official website), so I will not guess. Check the exam name and country."
  },
  "limits": ["found matching exam entries but none lists a current official website"]
}
```

One follow-up inspection of the exact entity URL in request 2 also returned 200.
Its fetched English label was `Civil Services Examination`, alias `CSE`, and its
only claim properties were P31, P17 and P646. It had no current P856 official
website, P664 organizer or P137 operator. These are community-source observations,
**not verified-official exam facts**. The operator repair cannot help this entity
because there is no operator claim to follow.

Exact missing seam: `discoverEntities` requires a current P856 on the exam, or a
P856 on an entity nominated by P664/P137. None is present for this exam in the
fetched data. There is no existing fallback discovery interface to obtain its
authority URL. No official URL was nominated, guessed or requested; zero official
pages were fetched and zero official facts were produced. Exam date, syllabus and
format remain unknown. This is safe discovery failure, not positive acceptance
or evidence that the exam lacks an official website. No implementation bug was
demonstrated, so no implementation/configuration/test changes were made to force
a result. No switch to a second exam was attempted.

Verification in a clean environment, without credentials or environment-file reads:

- `HM_TEST_NO_NETWORK=1 node --import tsx --test test/webResearch.test.ts`:
  31 tests, 29 passed, zero failed, two loopback socket tests skipped by the
  existing no-network flag. Includes PII rejection, normalized query minimization,
  strict domains, operator nomination, official quotation extraction, robots,
  challenges, redirects and safe unknown regressions (all scripted/offline).
- `HM_TEST_NO_NETWORK=1 node --import tsx --test --test-name-pattern='ambiguous exam wording|an exam outside the offline list|fixture facts are never verified' test/journey.test.ts`:
  three selected research/context tests passed, zero failed or skipped. Other
  journey tests were not selected.
- `npm run typecheck`: passed (exit 0).

Total focused verification: 32 passed, two skipped, zero failed. No full OFFLINE
suite was run: the no-network flag is used by specific tests, not a demonstrated
suite-wide guard against live/model/database/credential access. Focused results do
not certify the full suite. No new evidence files, dependencies, models, paid
requests, student data, credential reads or Git mutations were used. This attempt
does not establish arbitrary-exam coverage or advance the separate live sponsor path.

## B12 bounded authority discovery implementation — 2026-10-27

Implemented locally in the existing discovery service (no public API change):
when one exact exam entity lacks current P856/P664/P137, make one Wikidata
statement-search request for entities whose current P179 (series) or P31
(instance of) points to that exam. Re-fetch and validate those exact relationships,
then follow only their current P664/P137 to P856. No recursion, pagination,
country/subject-based authority inference, exam profiles or guessed URLs.
Limits: eight search results (overflow fails closed), sixteen authority entities,
at most six discovery API calls, and the existing four official-page attempts.
Existing privacy, trusted-domain, robots, challenge and pinned HTTPS controls remain.
Multiple organizer/operator candidates remain ambiguous, including a body without
a website. Each candidate retains the exam/edition/property/body/site evidence
chain. Discovery conducting-body facts remain unverified; an indirect candidate's
facts are withheld unless an actually fetched official page explicitly states
that body's responsibility for the exam. The official responsibility quotation
and URL are carried separately from the community discovery chain.

Ran the SAME Civil Services Examination / India case exactly once after adding
the fallback. Clean environment with PATH and process-only HM_LIVE_RESEARCH=1,
existing pinnedHttpsFetch, 60-second outer cap. No model, credentials or student
storage. Actual requests, all HTTP 200, in order:

1. `https://www.wikidata.org/w/api.php?format=json&action=wbsearchentities&search=Civil+Services+Examination&language=en&type=item&limit=8`
2. `https://www.wikidata.org/w/api.php?format=json&action=wbgetentities&ids=Q5124580&props=claims%7Clabels%7Caliases%7Cdescriptions&languages=en`
3. `https://www.wikidata.org/w/api.php?format=json&action=query&list=search&srsearch=haswbstatement%3AP179%3DQ5124580+OR+haswbstatement%3AP31%3DQ5124580&srnamespace=0&srlimit=8`
4. `https://www.wikidata.org/w/api.php?format=json&action=wbgetentities&ids=Q668&props=labels%7Caliases&languages=en`

Actual discovery observations: search returned Q5124580, labelled Civil Services
Examination; entity claim properties were P31, P17, P646. The new relationship
search returned `{"searchinfo":{"totalhits":0},"search":[]}`. Q668's label was
India. These are community discovery observations, not official exam facts.

Actual final result was `status: not_found`, with the limit:
`found matching exam entries but no current website through direct or bounded instance/edition authority relationships`.
Zero official URLs nominated, zero official pages fetched, zero verified facts.
Exam date, syllabus, format and responsible body remain unknown. **B12 positive
acceptance remains OPEN.** This extends structured discovery but does not solve
this entity's missing relationship. Precise remaining capability gap: discovering
an exam-to-authority relationship when neither direct claims nor indexed
instances/editions with organizer/operator claims supply one. The service has no
supported general prose/authority-document relationship discovery; an unrelated
organization, common country or plausible domain is insufficient evidence. No
second exam or live negative case was attempted; no blocked site was retried.

Final focused offline verification in a clean environment:

- `HM_TEST_NO_NETWORK=1 node --import tsx --test test/webResearch.test.ts`:
  38 tests, 36 passed, two existing loopback socket tests skipped, zero failed.
  New synthetic regressions cover P179/P31 chains, official responsibility versus
  mere mentions/negation/other bodies, ended/unrelated relationships, overflow,
  multiple authorities, missing websites, discovery 403 and official-page 403.
  The affected invented-exam safe-unknown path is covered offline.
- Three selected research/context regressions in `test/journey.test.ts`: passed.
- `npm run typecheck`: passed. Targeted `git diff --check`: passed.

An initial focused test invocation omitted HM_TEST_NO_NETWORK and its two
loopback listener tests failed with sandbox EPERM; rerunning with the existing
flag skipped those tests. No live traffic was used by the scripted tests. The
first new-fixture run also exposed route-prefix shadowing in the test helper;
most-specific fixture routes now take precedence and the regressions pass.
No full suite was run because a suite-wide live/model/database/credential guard
has not been established. Today's adapter-memory wiring and other edits were
preserved. Only src/context/webResearch.ts, test/webResearch.test.ts and this
existing continuation document were edited by this batch. No new files,
installs, Git mutations, deployment or sponsor-path claims.

## Host live-run receipt review — 2026-10-27

No command was rerun and no network, credential, database or model operation was
made in this review. The existing host receipt
`live-20261027-145659-69101.json` records `ok: false`, zero model requests,
and the bounded failure diagnostic: stage `zetaris_query`, service `zetaris`,
category `transport_error`, HTTP status `null`. The receipt contains only
fallback step labels.

The protected connector performs the Zetaris login before its single query.
`zetaris_query_failed` can therefore mean only a query transport failure, an
unclassified non-success query HTTP response, or an invalid query response;
the receipt establishes the first case here. It neither establishes a query
HTTP status nor explains the transport failure. The initial planning/model
request is after a successful topic read, so this host attempt did not reach
the model lane. Existing diagnostics already preserve the relevant bounded
stage/category/status fields; no implementation change or regression run was
needed. A future bounded read still needs an in-session approved, host-local
query attempt after the no-credit local model-lane condition is established.

## Bounded query-only preparation — 2026-10-27

Added `zsh scripts/live-run.sh --query-only`, using the existing standalone
`scripts/zetaris-query.ts` and unchanged Zetaris connector. The launcher keeps
its clean environment, local configuration validation and 2-second TCP preflight.
Its query-only branch skips model-token initialization/prompting and terminates
before the full verifier or evidence-file creation. It prints one guarded JSON
receipt to the terminal; no receipt file is created by this mode.

From `/Users/shauryasingh/hard-mentor`, the owner command is:
`zsh scripts/live-run.sh --query-only`. All five prompts are hidden: source,
local URL and table confirmations, followed by Zetaris user and password. Enter
confirms the existing first three defaults. It reads fictional student `riya`
through the same login then study-table SELECT, with at most two HTTP requests,
15 seconds per request, no retries, redirects or pagination, and page limit 500.
The two HTTP timeouts total at most 30 seconds of request time, plus TCP preflight
and runtime/prompt time. Model requests are always zero; model cost/lane remains
unconfirmed for the separate full loop and does not gate this isolated read.

Receipt fields are mode, ok, modelRequests, requests; success adds rowCount and
aggregate connector-result-order provenance (no row contents or identifiers).
Failure adds a fixed error label and bounded stage/service/category/HTTP status;
transport failures additionally carry timeout, connection_refused,
connection_reset, dns, tls or other, derived only from structured codes/classes
and bounded nested causes. Unknown exception text is never inspected or emitted.

Offline verification: 79 targeted synthetic tests passed across query formatting,
connector, diagnostics and launcher safety; typecheck, shell syntax and diff
whitespace checks passed. Executable success/failure tests reject model imports
and verify terminal control flow. No live requests or launcher execution occurred.
The established host receipt still proves only query-stage transport failure,
HTTP status null and zero model requests; its underlying cause remains unknown.
The owner must run the bounded command once before any live-read success claim.

## Owner LOCAL-lane route gate — 2026-10-27

Source-only review; full runner NOT invoked, no network/auth/query/model requests
made in this batch, and no reachability retry. Owner reports a successful normal-Mac
query-only receipt: four Riya rows, connector provenance, modelRequests 0. This
isolated read does not resolve the earlier full-runner `zetaris_query` /
`transport_error` / HTTP null receipt or the separate Codex sandbox TCP boundary.

Requested route established: `zsh scripts/live-run.sh` launches a clean child with
only PATH inherited (line 28); no model/base-URL/timeout override is prompted or
exported. `verify-product-path.ts:50` calls `meterlessFromEnv`, whose existing
resolver selects provider `meterless`, base `http://127.0.0.1:8088/v1`, requested
model `meterless/auto`, app `hard-mentor`, scope `user` (src/llm/meterless.ts).
This route identifier is not a concrete Llama model identifier.

Route match NOT established. Installed Nightshift source under
`/Applications/Nightshift M1-M4.app/Contents/Resources/web/` distinguishes auto
from local (`js/quick-connect.js:29-37`). `js/engine/modes.js:523-615` resolves the
explicit requested mode before UI mode; `js/web/web-daemon.js:357-398` additionally
resolves the app policy and applies `bindAppMode`. No current effective
`hard-mentor` binding, selected concrete Llama 3.2 1B lane identifier, or runtime
fallback/egress policy was established. A LOCAL lane existing or the UI selecting
LOCAL does not prove this explicit auto request uses it. The exact gap is current
resolver evidence mapping hard-mentor + meterless/auto exclusively to that lane,
with no hosted/credit-bearing alternative. No route/configuration changes made.

App request limits established from actual source: verifier `maxRetries: 0`,
`timeoutMs: 45_000`; `maxPlanDrafts: 1` is passed through conversation to the graph
revision bound. Only initial plan and post-score next plan call the model planner;
its draft makes one chat call; client retry loop stops after the first attempt
with maxRetries 0. Maximum two app model HTTP requests, each 45 seconds. This does
not establish Nightshift's internal lane/fallback behavior.

Exact normal-Mac full command, from `/Users/shauryasingh/hard-mentor`:
`zsh scripts/live-run.sh`. NOT CLEARED TO RUN: route match remains unresolved.
This batch reached no fresh full-loop read, validated proposal, cited quiz, saved
score or adaptation. Stop condition: unresolved route/cost mapping, not a new
transport failure. Only this existing document was appended; no tests run.

## Bounded exclusive-local routing preparation — 2026-10-27

Preparation only: no generation, full runner, Zetaris/auth request or bootstrap.
Owner's four-row isolated read remains separate from the older full-runner query
transport failure. One runtime TCP observation at 127.0.0.1:8088 returned EPERM;
no retry or authenticated metadata request followed. This is a sandbox permission
result, not evidence that the host service is down.

Installed source establishes `meterless/local` as a supported disposition, not a
concrete model pin. Under /Applications/Nightshift M1-M4.app/Contents/Resources/web/:
js/engine/proxy.js:85-109 resolves local and builds a single mode chain without
body.models; :378-384 carries local-only even across app-mode bindings; :735-749
passes that floor into the runner; :889-902 preserves it across the mode chain.
js/engine/orchestrator.js:1426-1436 forces effective local and only tightens the
floor; :2031 passes it into dispatch; :2394-2398 floors the entire fallback pool.
js/engine/select.js:327-337 admits only local-runtime or webllm under local-only
(excludes even discovered LAN providers), :343-358 filters inactive/nonlocal rows,
:483-525 selects preferred/exact/nearest-tier eligible locals; :814 floors fallback
ranking. js/engine/providers.js:1424-1439 refuses a floor violation before fetch.
Agentic hops preserve runner options (:3852 onward); cloud quality upgrades require
cloud-ok. Local failure therefore cannot authorize auto/cloud substitution on
this inspected path. Runtime may make multiple INTERNAL local attempts/phases;
the app's two-request limit is not a runtime inference-count limit.

Minimal routing change: scripts/live-run.sh now exports METERLESS_MODEL=
'meterless/local' inside ONLY the full-verifier child, after the query-only exit.
Its clean env -i launch and literal assignment prevent inherited model overrides;
existing meterlessFromEnv consumes it (src/llm/meterless.ts:199-214), and client.ts
sends cfg.model. Adapter defaults and all other app paths stay unchanged. Provider,
base URL, hidden authentication, Zetaris configuration and permission gates remain.
No alternate models array is sent. App bounds remain two planning HTTP requests,
maxRetries 0, 45,000 ms/request; graph maxPlanDrafts 1 remains unchanged.

Verification: 29 relevant synthetic offline tests passed (live-run-safety,
live-run-preflight, meterless, verify-product-path); typecheck and zsh -n passed.
The existing synthetic full-loop test now resolves the launcher's literal route,
checks local wire model/base/app identity/no fallback array, succeeds with two
planning calls and stops at one call for a simulated 503. Synthetic responses are
not live model evidence. No unrelated suites or runtime generation were run.

Concrete current-lane match remains UNRESOLVED: local disposition selects eligible
local models by roster/preference/tier, not automatically Llama 3.2 1B by name.
No live enabled registry ID, eligible roster, preference or hard-mentor lane
allowlist was observed. Normal-Mac `zsh scripts/live-run.sh` from the project
folder now requests local-only, but is NOT CLEARED for the owner's specified
model until that current mapping is observed. No full-loop stages completed.

Exact host-only observation: in the running Nightshift webview's existing developer
console, evaluate this read-only expression (no token arguments, requests,
runChat, downloads, setting changes or bindAppMode). It uses installed resolver
functions and emits only route/model/lane metadata. Do not substitute catalog
presence for readiness or exclusive selection; multiple eligible models, a missing
function, empty/stale roster, or another trace app context leaves matching open.

```javascript
(() => {
  const r = window.RT, p = r.resolveAppPolicy('hard-mentor');
  const allow = p.lanes ? new Set(p.lanes.map(String)) : null;
  const lanes = r.data?.daemon?.lanes || r.data?.localRuntime?.lanes || [];
  return JSON.stringify({
    route: 'meterless/local',
    floor: r.proxyKit.privacyFloorFromRequest({model:'meterless/local'}, 'local'),
    policy: {mode:p.mode, privacy:p.privacy, lanes:p.lanes},
    selectionContext: r.data?.trace?.app || null,
    preferred: r.localRuntime?.preferredLocalModel?.() || null,
    candidates: ['A','B','C'].map(tier => ({tier,
      models: r.availableModelsForMode('local', tier, 'local-only')
        .filter(m => !allow || r.modelOnAllowedLanes(m, allow))
        .map(m => ({id:m.id, name:m.name, provider:m.provider, tier:m.tier}))})),
    lanes: lanes.map(l => ({id:l.id, model:l.model, state:l.state,
      provider:l.provider, kind:l.kind, races:l.races}))
  }, null, 2);
})()
```

Official engines and stack-overview documentation were consulted as leads; the
exclusive-local conclusion above is based on the installed implementation. Only
existing launcher/test/document files were edited. No full-loop permission is
implied by this preparation; its separate single host invocation remains stopped.
