# Personalised Mentor: local setup and usage

## Requirements and revision

Use Node.js 20 or newer (the locked `@langchain/core` dependency requires `>=20`), npm, Git and a shell. The project does not declare an `engines` field or an npm version requirement. This batch ran with Node **26.8.1** and npm **11.19.0**; other versions were not tested. Dependencies are declared in [package.json](../../package.json), pinned by npm's [v3 lockfile](../../package-lock.json): LangGraph 1.4.21, LangChain core 1.2.17, Zod 4.6.5, TypeScript 6.0.3 and locked tsx 4.23.0.

The inspected source is branch `fix/web-research-dns-pin`, revision `537d80cb4c7e0ae92b30c03e62295b66436ed453`. Do not assume the default branch contains it. These packaging edits are a local, uncommitted overlay on that revision. The remote below is the existing repository address; access/publication remains owner-controlled, and the README overlay will not appear in a clone until approved and released.

```sh
git clone --branch fix/web-research-dns-pin https://github.com/shauryasinghfcb001-netizen/hard-mentor.git
cd hard-mentor
npm ci --ignore-scripts --no-audit --no-fund
npm run setup
```

`npm ci` uses the existing lockfile; dependency lifecycle scripts are disabled in this route. `npm install` is the older unlocked-install route, not the clean verification command used here. `npm run setup` executes [setup-hmem.sh](../../scripts/setup-hmem.sh): it downloads Meterless's H-MEM reference with Git sparse checkout at [the pinned revision](../../vendor/HMEM_SOURCE_COMMIT), copies it into ignored `vendor/hmem`, and removes only its own download scratch directory. The pin is `1742dec56a66e58eef9dda2d2b865823758ca8cd`. An existing vendor directory makes setup return early; that does not independently verify its contents. Do not delete an existing vendor directory just to follow this guide.

**Clean setup was attempted and did not pass:** in a new temporary archive of HEAD with fresh dependency cache and no reused `node_modules` or H-MEM, npm could not resolve `registry.npmjs.org`, and setup could not resolve `github.com`. No clean-tree demo or tests ran. Existing-checkout success below uses installed dependencies and the existing H-MEM copy. A network-enabled owner rerun is still required; do not copy the existing vendor directory and call that a fresh setup.

## Typeable local recording screen — 28 October 2026

With this checkout’s already installed dependencies and H-MEM, run `npm run record` and open the printed **http://127.0.0.1:4317** URL on this Mac. Stop with Ctrl+C. The browser invokes the same core conversation as the CLI, binds only loopback, starts fictional scratch state with memory off, and uses offline rules. No provider or production route is called. See [the public recording guide](recording.md) for the typed journey, reset, exact fresh checks, screenshots and remaining limitations. This same-machine verification does not resolve the clean-setup DNS failure above or establish public access.

## Reproduce the fictional offline conversation

Use a fresh terminal with no inherited model/study-source settings, or use this isolated child environment. No environment file or provider setting is needed. Do not add `--web` or select a model planner for this review route.

```sh
env -i PATH="$PATH" TMPDIR="${TMPDIR:-/tmp}" HM_TEST_NO_NETWORK=1   node --import tsx scripts/chat.ts --fictional-scratch --today 2026-10-23   < scripts/quiz-conversation.txt
```

This is the existing consent-aware CLI mode, freshly verified here. It creates a classified synthetic fixture directory under the OS temporary directory, uses local seed records and notes, and makes no provider call. It does not unlock storage for real students. The output is a terminal demonstration, not a hosted student interface. Omit the input redirect to type fictional messages interactively.

The legacy `npm run demo:chat` and `npm run demo:journey` scripts create ordinary `mktemp` directories that the current storage gate does not authorize. Their `tee` pipelines can report success even when Node fails. Do not use their exit status as proof. The direct legacy journey entry point was tested here and exited 1 with `ConsentRequired`. The later browser build added `npm run record` and a shared CLI environment; these older npm demo wrappers were not repaired.

To run the existing journey script safely on fictional data, use its existing fixture factory in the same process:

```sh
env -i PATH="$PATH" TMPDIR="${TMPDIR:-/tmp}" HM_TEST_NO_NETWORK=1   node --import tsx --input-type=module -e "import { fictionalSandbox } from './src/consent/storageGate.ts'; process.argv[2] = fictionalSandbox('pm-journey-'); await import('./scripts/student-journey.ts');"
```

That exact invocation exited 0 in the dirty checkout. It preserves the production storage gate. See [actual journey output](evidence/journey-actual.txt).

## Verification

```sh
npm run typecheck
npm run test:hmem-conformance
```

Both passed in the earlier Oct 27 packaging run in the existing checkout; conformance was not rerun for the browser build or this release check. The Oct 28 browser build separately passed typecheck, 43 focused tests and 1 HTTP test; see [evidence and limits](evidence.md). The conformance command checks the committed upstream vector/runner hashes and revision marker, then runs 13 in-memory checks against the product engine loader.

`npm test` expands to `node --import tsx --test test/*.test.ts`. Inspect its scope first: `test/mentor-ai.test.ts` imports the separate external Mentor AI project, and `test/live-run-safety.test.ts` includes installed Nightshift source checks. They were excluded here. The remaining 33 files were run with `HM_TEST_NO_NETWORK=1` and a process-local network-blocking preload; **302 passed, 2 failed, 2 skipped**. The [verification record](evidence.md) names both failures. This is a scoped offline check, not a full-suite pass. The complete selected-file command and guard provenance are in [runs.json](evidence/runs.json).

Offline usage does not test the live Zetaris connector, Nightshift inference, NVIDIA generation, public hosting or production consent. Those require separate authorized work and evidence.
