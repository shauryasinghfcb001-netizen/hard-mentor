import fs from "node:fs";
import { completionMetadata, type CompletionMetadata } from "./live-run-diagnostics.ts";
import { syncBuiltinESMExports } from "node:module";
import { openAICompatible, ModelError, type ChatModel } from "../src/llm/client.ts";
import { checkToken, METERLESS } from "../src/llm/meterless.ts";

// Resolved from the installed models.js enabled registry (nativeId
// llama-3.2-1b-instruct), not from a guessed upstream catalog. Runner only.
export const LOCAL_STUDY_MODEL = "webllm/Llama-3.2-1B-Instruct-q4f16_1-MLC";

/** Installed proxy.js supports concrete pins plus :local. Never mode-route
 * on discovery failure. The suffix independently preserves the privacy floor
 * even if the app is bound to Auto or the row disappears after discovery.
 * Metadata is not a generation, and is never retried. */
export async function localStudyClient(tokenInput: string, fetchImpl: typeof fetch = fetch, onCompletion: (metadata: CompletionMetadata) => void = () => {}): Promise<ChatModel> {
  const token = checkToken(tokenInput);
  const headers = { "meterless-app": METERLESS.appId, "meterless-scope": "user" };
  const response = await fetchImpl(`${METERLESS.defaultBaseURL}/models`, {
    headers: { authorization: `Bearer ${token}`, "meterless-app": METERLESS.appId },
    signal: AbortSignal.timeout(5_000), redirect: "error",
  });
  const metadata = response.ok ? await response.json().catch(() => null) : null;
  const rows = Array.isArray(metadata?.data) ? metadata.data.filter((m: any) => m?.id === LOCAL_STUDY_MODEL) : [];
  if (rows.length !== 1 || rows[0].meterless?.kind !== "local" ||
      !["local-runtime", "webllm"].includes(rows[0].owned_by) || rows[0].meterless?.source === "discovered") {
    throw new Error("live_run_local_model_unavailable");
  }
  let completion: CompletionMetadata | undefined;
  const client = openAICompatible({
    provider: "meterless", baseURL: METERLESS.defaultBaseURL, apiKey: token,
    model: `${LOCAL_STUDY_MODEL}:local`, headers, timeoutMs: 45_000, maxRetries: 0,
    // An explicit empty tool declaration is supported by proxy.js. Its
    // isToolCall guard also bypasses Nightshift answer-memory reinjection,
    // which otherwise prepends a second system even on a pin. Hard Mentor's
    // own memory remains in the original planner messages, unchanged.
    // No redirect may move credentials or prompts off loopback.
    fetchImpl: async (input, init) => {
      completion = undefined;
      try {
        const response = await fetchImpl(input, { ...init, redirect: "error",
          body: JSON.stringify({ ...JSON.parse(String(init?.body)), tools: [], stream: false }),
        });
        if (response.ok) {
          completion = completionMetadata(await response.clone().json());
          onCompletion(completion);
        }
        return response;
      } catch {
        completion = { status: init?.signal?.aborted ? 'aborted' : 'request_failed' };
        onCompletion(completion);
        throw new ModelError('live_run_response_failed', null, false);
      }
    },
  });
  let requests = 0;
  return { ...client, async chat(messages, options) {
    if (requests >= 2) throw new ModelError("live_run_model_request_limit", null, false);
    requests++;
    // Keep full planning scope and evidence obligations; reduce presentation
    // overhead only, with no output reconstruction or extra generation.
    const compact = messages.map((message, index) => index === 0 && message.role === 'system'
      ? { ...message, content: message.content + '\nUse compact JSON without indentation. Keep activity, message and each supported reason concise; do not repeat claims. Include every required key and typed reference. Preserve all planning constraints and required topic coverage.' }
      : message);
    const result = await client.chat(compact, options);
    if (completion?.finishReason && completion.finishReason !== 'stop') {
      throw new ModelError('live_run_completion_not_complete', null, false);
    }
    // The installed non-stream proxy returns result.model, the actual winner.
    // Missing or substituted winners never qualify as a successful proposal.
    if (result.model !== LOCAL_STUDY_MODEL) throw new ModelError("live_run_model_pin_not_honored", null, false);
    return result;
  } };
}

/** Match exact input and common serialized forms; never include input in errors. */
export function assertNoPromptedValue(text: string, values: readonly string[]): void {
  for (const value of values) {
    if (!value) throw new Error("live_run_empty_input");
    const forms = [value, JSON.stringify(value).slice(1, -1), encodeURIComponent(value)];
    if (forms.some(v => text.includes(v))) throw new Error("live_run_secret_guard");
  }
}

/** The verifier and H-MEM use sync writes. Guard those before bytes reach disk. */
export function guardVerifierWrites(values: readonly string[]): () => void {
  const write = fs.writeFileSync;
  const append = fs.appendFileSync;
  const check = (file: unknown, data: unknown) => {
    assertNoPromptedValue(String(file), values);
    assertNoPromptedValue(Buffer.isBuffer(data) ? data.toString("utf8") : String(data), values);
  };
  fs.writeFileSync = ((file: any, data: any, options: any) => { check(file, data); return write(file, data, options); }) as typeof write;
  fs.appendFileSync = ((file: any, data: any, options: any) => { check(file, data); return append(file, data, options); }) as typeof append;
  syncBuiltinESMExports();
  return () => { fs.writeFileSync = write; fs.appendFileSync = append; syncBuiltinESMExports(); };
}

export type StepLabel = "LIVE" | "RULES" | "FALLBACK";
export interface LiveSummary { modelRequests: number; loop: "ok" | "fail"; steps: { step: string; label: StepLabel }[] }

export function formatLiveSummary(s: LiveSummary): string {
  if (!Number.isSafeInteger(s.modelRequests) || s.modelRequests < 0 || !["ok", "fail"].includes(s.loop)) throw new Error("invalid_summary");
  const allowed = new Set(["plan", "quiz", "score", "repeat", "next_plan"]);
  if (s.steps.some(x => !allowed.has(x.step) || !["LIVE", "RULES", "FALLBACK"].includes(x.label))) throw new Error("invalid_summary");
  return [`modelRequests: ${s.modelRequests}`, `loop: ${s.loop}`, ...s.steps.map(x => `${x.step}: ${x.label}`)].join("\n");
}

export function validateLiveConfiguration(env: NodeJS.ProcessEnv, secrets: readonly string[]): void {
  if (env.HM_STUDY_SOURCE !== "zetaris" || !/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(env.HM_ZETARIS_TABLE ?? "")) throw new Error("live_run_invalid_configuration");
  let url: URL;
  try { url = new URL(env.HM_ZETARIS_URL ?? ""); } catch { throw new Error("live_run_invalid_configuration"); }
  if (!["http:", "https:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("live_run_invalid_configuration");
  assertNoPromptedValue(JSON.stringify([env.HM_STUDY_SOURCE, env.HM_ZETARIS_URL, env.HM_ZETARIS_TABLE]), secrets);
}
