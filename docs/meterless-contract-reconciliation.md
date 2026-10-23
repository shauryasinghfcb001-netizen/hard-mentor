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

## Still open

DECISIONS.md Q1 (must the hackathon entry run on Nightshift?) is unresolved. This reconciliation shows how to connect. It does not show that connecting is required or sufficient for eligibility.
