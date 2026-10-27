# Meterless contract reconciliation: Runtime 0.90.0 vs Runtime 1.4 / provider contract v4

Checked 2026-10-23. Read-only. No runtime was installed, configured or contacted, and no model was called.

## Sources

| Source | What it says | How read |
|---|---|---|
| A. `docs/agent-ready/add-meterless-provider.md` in github.com/meterless/meterless, commit `1742dec` (which is still `main` on 2026-10-23, committed 2026-10-19) | "Meterless Runtime 0.90.0" | `gh api`, copied to `docs/meterless-provider-contract.md` |
| B. https://meterless.ai/engines.html, card "Add Meterless as a provider" | "Meterless Runtime 1.4, provider contract v4" | Shaurya's link, read in Chrome and with curl (page sha256 prefix `08e347eaf43c5312`) |
| B2. Same page, cards "Grade my provider integration", "Show what this machine can serve", "Connect with one paste or one scan" | Levels L0 to L3, discovery, Quick Connect | same |

The two official sources carry different version labels. The GitHub repo has not been updated to 1.4. This file treats B as the newer contract and lists each concrete difference. It does not rewrite the adapter.

## Rule by rule

| Rule | 0.90.0 (A) | 1.4 / v4 (B) | Adapter `src/llm/meterless.ts` | Status |
|---|---|---|---|---|
| Provider id, name, default URL `http://127.0.0.1:8088/v1` | same | same | matches | no change |
| URL normalisation to `<host>/v1`, never `/v1/v1` | same | same | matches, tested | no change |
| Bearer token from `<stateDir>/proxy-token`, key `meterless_runtime_token`, `rt-local` rejected | same | same | matches, tested | no change |
| `meterless-app` on every request, `meterless-scope: user` on chat | same | same | matches, tested | no change |
| Routing-mode ids, keep unknown `meterless/*` | same 6 dispositions | base card same; the task-router card adds disposition `cluster` and lists classes (text, code, vision, judge, perception, image, video, speech, transcribe, music, embed, mesh, texture) | keeps any `meterless/*` id, so `cluster` ids survive | no change needed for text use |
| Status from `GET /v1/models` (401/403 unauthorized, 200 + ids online, else offline) | same | same | matches, tested | no change |
| Auto Detect ports and hosts | same | same | matches, tested | no change |
| String content, 180 s timeout | same | same | matches, tested | no change |
| **Connect link** `http://<host>:<port>/connect#k=<key>`: base URL = origin + `/v1`, key = `k`, never log it | absent | **new in v4 base contract** | **parsed, mock-tested only** (2026-10-23, D22): `parseConnectLink` returns base URL, key, model and app, and rejects malformed links without echoing them. Not yet wired into env loading; never run against a real runtime. | partly closed |
| Discovery: `GET /v1/meterless/classes` (two response shapes), `chat_carrier`, one `meterless:health` event | absent | level L1 (not in the base card) | not implemented | gap, only needed for L1 |
| No `/v1/images`, `/v1/audio/speech`, `/v1/embeddings`, `/v1/videos` on 1.4 | not stated | stated in the grading card | adapter uses only `/v1/chat/completions` and `/v1/models` | compliant |
| Token never in a URL | not stated | stated in the grading card | token only in the `authorization` header; probe errors redact it | compliant |
| Media, 3D, transcription routes (L2M, L3) | absent | levels L2M and L3 | not used; Hard Mentor needs text only | out of scope |

## Level reached

Against the B2 grading levels, the adapter meets **L0 Text**, but only with mocked responses (`test/meterless.test.ts`, 9 tests). It does not meet L1 Discovery, and it does not meet the v4 base card's "done" line because no real runtime has been reached.

## Smallest change to match v4 text use (steps 1 and 2 done on 2026-10-23, mock only; step 3 done as a separate `connectLinkContract` field so `contractVersion` still says 0.90.0)

1. Add a pure `parseConnectLink(text)` function. Treat input as a link only when it is http or https, its path is `/connect` or `/connect/`, and its fragment carries `k`. Return base URL, key, model (`m` or `meterless/auto`) and app (`n` or `hard-mentor`). Any other input keeps its base-URL meaning.
2. Tests with mocked input only: a link fills URL and key; a bare `http://127.0.0.1:8088/v1` is not treated as a link; the key never appears in error text.
3. Update `METERLESS.contractVersion` and the header of `src/llm/meterless.ts` to cite both sources.

Nothing in this change touches H-MEM or the LangGraph flow.

## Installed Nightshift runner repair — 2026-10-27

The protected fictional runner (`HM_LIVE_RUN=1`, selected by
`scripts/live-run.sh`) now uses a concrete local pin. General adapter, env,
connect-link and non-runner routes retain their existing contracts above.
Only existing repository files were edited. No app bundle, global settings,
database, provider switches, installs, downloads or Git commits were changed.

Installed source root: `/Applications/Nightshift M1-M4.app/Contents/Resources/web/`.
These are local source observations, not upstream version assumptions:

| Installed source | Evidence used |
|---|---|
| `js/engine/models.js:1903`, `:2662`, `:2682` | Enabled registry execution resolves native ID `llama-3.2-1b-instruct` to `webllm/Llama-3.2-1B-Instruct-q4f16_1-MLC`, kind `local`, provider `local-runtime`, with no alias or gate flag. No catalog ID was invented. |
| `js/engine/proxy.js:346`, `:378`, `:413`, `:711`, `:745`, `:886` | Concrete addressing survives app binding; policy lane exclusions refuse. `:local` is parsed separately from the pin, supplying a local-only floor independently of binding. `/v1/models` exposes registry kind/provider metadata. The non-stream handler forwards pin/floor and returns the actual winner's model. |
| `js/engine/orchestrator.js:1551`, `:2160`, `:2394` | Pin overrides the phase plan with one final synthesis phase; privacy and disabled-model gates refuse before dispatch; scaffold eligibility is false; fallback pool contains only the pin. This is stronger than merely setting tier-split off, which still permits a scaffold. |
| `js/engine/proxy.js:735`, `js/engine/orchestrator.js:1947` | Explicit `tools: []` makes `isToolCall` true and skips Nightshift's answer-memory system-message injection. Without this guard, a pin alone can still produce two system messages when runtime recall finds hits. Hard Mentor's own memory, instructions and user data remain in their original messages. |
| `js/engine/orchestrator.js:1291`, `js/engine/select.js:327`, `js/engine/providers.js:1423` | Final synthesis without prior planning/scaffold returns base messages unchanged. Floor admission restricts local-only to `local-runtime`/`webllm`; dispatch independently refuses an incompatible model before any provider transport. |

`scripts/live-run-safety.ts` implements this runner-only route on fixed
`http://127.0.0.1:8088/v1`, with app `hard-mentor` and scope `user`. Before any
planning, one authenticated, non-generating `/models` request must list exactly
one matching local registry row owned by `local-runtime` or `webllm`; missing,
ambiguous, cloud, discovery-only or malformed metadata stops with
`local_model_unavailable`, zero model requests. Discovery does not prove model
residency or that cached weights are available. It does not download anything.

Chat sends `<resolved ID>:local` and `tools: []`, retaining each planner message
verbatim. Both metadata and chat refuse redirects. A different or absent winner
ID is rejected. Transport retries remain zero, each chat deadline is 45 seconds,
and the verifier permits at most two app planning requests, one per planning
step. No fallback mode array, warm-up or graph revision was added. Runtime-owned
verification/attempts remain distinct; this is **not** a two-total-inference cap.
Rules fallback remains a failure in live-loop evidence, not live success.

Offline validation: 36/36 focused tests passed, zero skips, using
`test/live-run-safety.test.ts`, `test/meterless.test.ts` and
`test/live-run-diagnostics.test.ts`; `npm run typecheck`, zsh syntax and diff
checks passed. Synthetic installed-function tests run registry/proxy/selector/
dispatch definitions in an isolated VM, execute pin/scaffold/memory/fallback
sections, and drive the actual proxy event handler with a fake Tauri bus. No
native bridge, network or real model is invoked. Mocked product verification
completes plan, cited quiz, exactly-once score and adapted plan in two app
requests; failed requests have no retries. Existing adapter tests still pass.

Live status remains unverified: the prior HTTP 502 receipt is not replaced by
offline success. No host launcher or live generation ran in this repair batch.
Generation quality, current runtime state and the 45-second deadline still need
one normal-Mac verification:

```sh
/bin/zsh /Users/shauryasingh/hard-mentor/scripts/live-run.sh
```

## Proposal rejection evidence — 2026-10-27, 17:05 host attempt

`evidence/live-20261027-170543-77739.json` records one app planning request,
`proposal_validation / local / proposal_rejected`, then
`verification_gate_failed`. This differs from the earlier HTTP 502
`system_message_order` failure. It does **not** establish a valid draft or a
working live loop. The four later steps were not reached; the summary fills
missing steps with `FALLBACK`.

The exact rejection condition is unavailable in retained evidence. The source
path is `openAICompatible.chat` → runner `wrappedClient.chat` (captures
`res.text`) → `createModelPlanner.draft` → `validateModelDraft(text)` → rejected
`onProposal` event → rule draft → `isVerifiedProductProposal`. The event is
emitted before the app substitutes rules. Thus the validator received client
text, not that app rule fallback. The client required string message content
and the protected route required the canonical winner ID. Those checks do not
prove that Nightshift itself generated the text rather than returning an
internal fallback; its origin remains unproven.

`validateModelDraft` groups both `extractJson`/`DraftSchema` errors under
`malformed`; otherwise it reports existing topic, time and citation checks.
The old runner discarded `info.issues`, the protected receipt excluded the
raw client text, and `runProductVerification` removes scratch state in its
`finally`. No rejected response or specific parse/schema/provenance/semantic
condition is retained in this receipt. A prompt, parser or model-size cause
cannot be established from it, so none was patched speculatively.

The existing runner diagnostic module now explains an already-rejected reply
with the same `parseModelDraft` parser/schema and the actual validator issue
codes. `failure.proposal` records `input: client_text`, the boundary
`json`/`schema`/`validation` (or `unknown`), fixed extraction reason codes,
allowlisted issue codes, and at most eight schema field paths with wildcard
indexes plus fixed schema error codes. It never retains values, arbitrary
keys, error prose, prompts, row ids, response text or response bodies. This
diagnostic does not decide acceptance. Runtime fallback origin is not inferred
from the text. Accepted proposals emit no rejection diagnostic.

Changes are limited to existing runner diagnostics/wiring, focused tests and
this document. Product parser, schema, validators, graph, prompts, Zetaris
read/configuration, routing pin/suffix/tools/floor, zero retries, 45-second
chat deadline, and two-app-request cap remain unchanged. Runtime attempts are
still distinct from app requests. No live generation or host launcher ran.

Offline verification: 50/50 focused tests passed, zero skips, covering the
parser/schema classification, sanitized bounds, real validator rejection
codes, accepted mocked loop, rejected client replies before app fallback,
provenance gates and previous routing/limits. Command:
`node --import tsx --test test/live-run-safety.test.ts test/live-run-diagnostics.test.ts test/model-safety.test.ts test/verify-product-path.test.ts test/meterless.test.ts`.
`npm run typecheck` passed. The live cause and live loop remain unproven;
the next separately authorized bounded host attempt can retain these reason
codes without retaining private content.

## missing_evidence trace — 2026-10-27, 17:51 host attempt

`evidence/live-20261027-175148-79589.json` narrows the failure to schema-valid
client text rejected with `missing_evidence`. Exactly one app planning request
was made. No rejected reference kind/id, supplied registry, raw response or
prompt is retained in this sanitized receipt. The runner deletes its scratch
directory in `finally`; the receipt is not a replayable proposal.

The exact emitters are the two zero-match branches in
`src/agent/modelSafety.ts::validateModelDraft`: a `data_row` reason whose id
equals no `ctx.rows[].sourceRow` (after the explicit foreign-id branch), or a
`memory` reason whose id equals no `ctx.memories[].id`. Matching is exact and
kind-specific. Duplicate identities produce `ambiguous_evidence`; an absent
required ref/id produces `malformed`, not this code. A model-supplied top-level
evidence array is not authoritative: `parseModelDraft` derives evidence from
known non-rule reason references. `missing_evidence` alone does not identify
which reason, kind or upstream cause failed. It also does not establish the
semantic truth of model-written reason text.

Source trace, inspected offline:

1. `zetarisStudyData.topicsFor` executes the student-filtered SELECT and maps
   each returned record to a result-position source identity under the selected
   table. These are read-local provenance handles, not proven database row keys.
2. `conversation.student` passes `q.rows` to the graph with the actual source
   description and SQL. `withAttemptLog` copies rows and updates mastery and
   local quiz metadata without replacing their source identities.
3. `graph.recall` calls `rankTopics`, which spreads each row before sorting;
   identities are preserved. Recalled memory ids come from the memory store.
   `draft_plan` supplies that same ranked collection and memories to the planner.
4. `createModelPlanner` supplies its system output contract and
   `buildPlannerPrompt(input)` as separate system/user messages. The user context
   contains exact row and memory ids. The system instructs use of supplied ids,
   but its static JSON example contains a different example row identity. Copying
   that example is a plausible failure mechanism, not proven by this receipt.
5. The protected runner's pinned local client forwards messages with `tools: []`;
   the compatible client returns string message content. The wrapper passes
   that client text unchanged to `validateModelDraft`, with `input.ranked` and
   `input.memories`. No intermediate source-id translation or registry resolver
   exists. Rejection is recorded before app rule fallback; fallback fails the
   live verification gate and does not become model evidence.

No context/plumbing defect is established by this trace. The retained receipt
cannot distinguish an invented/example id, wrong reference kind, a missing
memory, or a context mismatch at the time of the host run. Nor does a canonical
winner id establish the runtime origin of returned text. No causal production
repair is justified from these artifacts, so prompts, parser, validator,
adapters and runner behavior remain unchanged. No aliases, inferred citations,
automatic attachments or semantic claim verification were introduced. Existing
validation checks registry membership; membership alone is not proof that an
arbitrary natural-language claim follows from a known row.

Focused synthetic coverage in existing test files now checks read order versus
priority order, exact source identities before/after the quiz, and rejection of
absent, unrelated-table, topic-as-row, static-example and wrong-kind references
through the real mocked verifier path. Separate validator cases demonstrate
that invented ids, wrong kinds and lost context yield the identical sanitized
diagnostic. This establishes the information limit rather than choosing a cause
from equivalent receipts. All inputs are synthetic; this is not live evidence.

Validation: 89/89 focused tests passed, zero skips, using
`node --import tsx --test test/live-run-safety.test.ts test/live-run-diagnostics.test.ts test/model-safety.test.ts test/zetaris-study-data.test.ts test/verify-product-path.test.ts`.
After correcting a tuple type annotation in the new synthetic test, its 11/11
diagnostic tests passed again and `npm run typecheck` passed. No full suite ran.
Existing routing tests exercised the installed proxy/pin/fallback/dispatch
definitions in an isolated VM and verified local-only enforcement, unchanged
instruction roles, `tools: []`, zero retries, 45-second request deadlines and
the two-app-planning-request cap without invoking the runtime.

No live generation, launcher execution, provider/runtime change or installation
was performed. A host test remains a separate decision; this batch adds no new
diagnostic collection requirement and does not ask for private snippets.

## Known prompt defect correction — 2026-10-27, offline follow-up

Removed the static completed proposal example, including its unavailable
`record:riya:physics:electrostatics` reference and invented sample observation.
The system prompt now describes the output shape without nominating concrete
topic or evidence ids. It requires exact typed references from supplied records,
distinguishes registry membership from support for a claim, and forbids using
rule reasons as student observations. Empty topics are explicitly shown as
`(none)`, like empty memories; instructions forbid fabricating either kind and
specify empty blocks/reasons when both registries are empty. Data stays in the
user message, with an explicit system instruction that supplied content is data.
Parsing, validation, evidence derivation and post-generation handling are unchanged.

Runner-only rejection diagnostics now receive the exact active draft registry.
For schema-valid replies with `missing_evidence`, receipts retain registry counts
(saturated at 1000) and at most four deduplicated combinations of unmatched kind
(`data_row`/`memory`) and whether the exact id exists in the other registry. No ids,
values, prompts, reply text or raw errors are added. The temporary registry handle
is cleared after each draft. Counts and membership flags do not establish semantic
support, distinguish every causal mechanism, or resolve the historical receipt.

Validation: 35/35 tests passed, zero skips, with
`node --import tsx --test test/model-safety.test.ts test/live-run-diagnostics.test.ts test/live-run-safety.test.ts`;
`npm run typecheck` passed. Tests cover the corrected prompt, empty/memory-off
inputs, exact typed rejection, bounded private diagnostics, and existing routing,
local enforcement, instruction roles, tools, retries, deadlines and call caps.
An initial runner test caught premature clearing of transient reply text needed
by its existing gate; the wrapper was corrected before the successful rerun.

This corrects a known prompt defect, not a proven cause of the live rejection.
No host attempt, launcher execution, runtime change or installation occurred.

## Still open

DECISIONS.md Q1 (must the hackathon entry run on Nightshift?) is unresolved. This reconciliation shows how to connect. It does not show that connecting is required or sufficient for eligibility.
