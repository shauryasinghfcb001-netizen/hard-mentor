// OpenAI-compatible chat client (blueprint section "Model"). One code path for
// NVIDIA (integrate.api.nvidia.com) and OpenRouter. Uses global fetch only, no
// SDK. The API key never appears in errors, logs or return values.

import { meterlessFromEnv } from "./meterless.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  text: string;
  model: string;
  provider: string;
  latencyMs: number;
  attempts: number;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

export interface ChatModel {
  provider: string;
  model: string;
  chat(messages: ChatMessage[], opts?: { maxTokens?: number; temperature?: number }): Promise<ChatResult>;
}

export interface ClientConfig {
  provider: string;
  baseURL: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** extra request headers, e.g. Meterless app and scope headers */
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export const PROVIDERS = {
  nvidia: { baseURL: "https://integrate.api.nvidia.com/v1", keyVar: "NVIDIA_API_KEY", defaultModel: "nvidia/nemotron-3-nano-30b-a3b" },
  openrouter: { baseURL: "https://openrouter.ai/api/v1", keyVar: "OPENROUTER_API_KEY", defaultModel: "nvidia/nemotron-3-nano-30b-a3b:free" },
} as const;

export type ProviderName = keyof typeof PROVIDERS;

export class ModelError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = "ModelError";
  }
}

function redact(text: string, secret: string): string {
  return secret ? text.split(secret).join("[REDACTED]") : text;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function openAICompatible(cfg: ClientConfig): ChatModel {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const sleep = cfg.sleep ?? defaultSleep;
  const maxRetries = cfg.maxRetries ?? 2;
  const timeoutMs = cfg.timeoutMs ?? 60_000;

  return {
    provider: cfg.provider,
    model: cfg.model,
    async chat(messages, opts) {
      const started = Date.now();
      let attempt = 0;
      for (;;) {
        attempt += 1;
        try {
          const res = await fetchImpl(`${cfg.baseURL.replace(/\/$/, "")}/chat/completions`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}`, ...cfg.headers },
            body: JSON.stringify({
              model: cfg.model,
              messages,
              max_tokens: opts?.maxTokens ?? 600,
              temperature: opts?.temperature ?? 0.2,
            }),
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (!res.ok) {
            const body = redact((await res.text()).slice(0, 300), cfg.apiKey);
            const retryable = res.status === 429 || res.status >= 500;
            throw new ModelError(`${cfg.provider} HTTP ${res.status}: ${body}`, res.status, retryable);
          }
          const json: any = await res.json();
          const text = json?.choices?.[0]?.message?.content;
          if (typeof text !== "string") throw new ModelError(`${cfg.provider}: response had no message content`, res.status, false);
          return { text, model: json.model ?? cfg.model, provider: cfg.provider, latencyMs: Date.now() - started, attempts: attempt, usage: json.usage };
        } catch (err) {
          const e =
            err instanceof ModelError
              ? err
              : new ModelError(`${cfg.provider} request failed: ${redact((err as Error).message, cfg.apiKey)}`, null, true);
          if (!e.retryable || attempt > maxRetries) throw e;
          await sleep(500 * 2 ** (attempt - 1)); // exponential backoff: 0.5s, 1s, 2s...
        }
      }
    },
  };
}

/**
 * Reads provider config from env. Returns null when the needed key is absent.
 * LLM_PROVIDER=meterless goes to the Meterless Runtime adapter only; it never
 * falls back to NVIDIA or OpenRouter (src/llm/meterless.ts).
 */
export function modelFromEnv(env: NodeJS.ProcessEnv, provider?: ProviderName, overrides?: Partial<ClientConfig>): ChatModel | null {
  if (!provider && env.LLM_PROVIDER === "meterless") return meterlessFromEnv(env, overrides);
  const primary = (env.LLM_PROVIDER as ProviderName) || "nvidia";
  const name = provider ?? primary;
  const p = PROVIDERS[name];
  if (!p) throw new Error(`unknown LLM_PROVIDER ${JSON.stringify(name)}; use nvidia, openrouter or meterless`);
  const apiKey = env[p.keyVar];
  if (!apiKey) return null;
  // LLM_BASE_URL / LLM_MODEL tune the primary provider only, so a fallback
  // provider never inherits the other provider's URL or model id.
  const isPrimary = name === primary;
  return openAICompatible({
    provider: name,
    baseURL: (isPrimary && env.LLM_BASE_URL) || p.baseURL,
    apiKey,
    model: (isPrimary && env.LLM_MODEL) || p.defaultModel,
    ...overrides,
  });
}
