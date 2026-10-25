// Meterless Runtime (Nightshift hotspot) adapter, written to the official
// contract for Meterless Runtime 0.90.0: docs/agent-ready/add-meterless-provider.md
// in meterless/meterless at commit 1742dec (copy and notes in
// docs/meterless-provider-contract.md). It plugs into the same ChatModel
// interface as NVIDIA and OpenRouter, so H-MEM and the LangGraph flow do not
// change. The connect link (`parseConnectLink`) follows the newer "provider
// contract v4" card for Meterless Runtime 1.4 on https://meterless.ai/engines.html;
// the rest of v4 is not implemented (docs/meterless-contract-reconciliation.md).
//
// Nothing here installs or configures the runtime. If the runtime is absent,
// unauthorized or offline, callers get null or an error. There is no silent
// fallback to NVIDIA or OpenRouter. Tested only against mocked fetch; never
// run against a real runtime.

import fs from "node:fs";
import path from "node:path";
import { openAICompatible, type ChatMessage, type ChatModel, type ClientConfig } from "./client.ts";

export const METERLESS = {
  provider: "meterless",
  name: "Meterless Runtime",
  contractVersion: "0.90.0",
  /** only the connect link is taken from the newer contract; nothing else in v4 is implemented */
  connectLinkContract: "provider contract v4 (Runtime 1.4)",
  defaultBaseURL: "http://127.0.0.1:8088/v1",
  defaultModel: "meterless/auto",
  appId: "hard-mentor",
  tokenKey: "meterless_runtime_token",
  timeoutMs: 900_000, // 900s default: a cold model load or first WebLLM call can take minutes
  detectPorts: [8088, 8090, 8787, 11434],
  detectHosts: ["127.0.0.1", "localhost", "[::1]"],
} as const;

/** Contract: the placeholder token is rejected by the runtime, so refuse it early. */
export const PLACEHOLDER_TOKEN = "rt-local";

/**
 * Normalises any pasted runtime URL to <scheme>://<host>/v1. Accepts a URL
 * with or without a scheme, and with /v1, /v1/chat/completions, /v1/models or
 * /healthz. Never produces /v1/v1.
 */
export function normalizeMeterlessBaseURL(input: string): string {
  let s = input.trim();
  if (!s) return METERLESS.defaultBaseURL;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `http://${s}`;
  const u = new URL(s);
  return `${u.protocol}//${u.host}/v1`;
}

export interface ConnectLink {
  baseURL: string;
  key: string;
  model: string;
  app: string;
}

/**
 * Parses a Quick Connect link, http(s)://<host>:<port>/connect#k=<key>[&m=<mode>][&n=<app>].
 * Returns null when the text is not a connect link (it then keeps its plain
 * base-URL meaning). Throws when it is a connect link but malformed. Pure: it
 * never contacts the host, and its errors never contain the link, the key or
 * the fragment, so they are safe to log.
 */
export function parseConnectLink(text: string): ConnectLink | null {
  const s = text.trim();
  if (!/\/connect\/?(?:[?#]|$)/i.test(s)) return null;
  const bad = (why: string): never => {
    throw new Error(`Meterless connect link rejected: ${why}`);
  };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return bad("not a valid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") bad("scheme must be http or https");
  if (!/^\/connect\/?$/.test(u.pathname)) bad("path must be /connect");
  if (u.username || u.password) bad("credentials before the host are not allowed");
  if (u.searchParams.has("k")) bad("the key must be in the fragment, never in the query string");
  const f = new URLSearchParams(u.hash.replace(/^#/, ""));
  const key = f.get("k")?.trim() ?? "";
  if (!key) bad("no key (k) in the fragment");
  if (/\s/.test(key)) bad("key contains whitespace");
  if (key === PLACEHOLDER_TOKEN) bad(`placeholder key "${PLACEHOLDER_TOKEN}"`);
  const model = f.get("m")?.trim() || METERLESS.defaultModel;
  if (!model.startsWith("meterless/")) bad("model (m) must be a meterless/* routing mode");
  const app = f.get("n")?.trim() || METERLESS.appId;
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(app)) bad("app id (n) must be a short lowercase id");
  return { baseURL: `${u.protocol}//${u.host}/v1`, key, model, app };
}

/** Contract: models are routing ids (meterless/*). Unknown meterless/* ids pass; other names are refused, never substituted. */
export function checkModel(model: string): string {
  const m = model.trim();
  if (!m.startsWith("meterless/") || m.length === "meterless/".length || /\s/.test(m)) {
    throw new Error("Meterless model must be a meterless/* routing id (see GET /v1/models)");
  }
  return m;
}

export function checkToken(token: string | undefined | null): string {
  const t = (token ?? "").trim();
  if (!t) throw new Error(`Meterless Runtime token missing: set METERLESS_TOKEN, ${METERLESS.tokenKey} or METERLESS_STATE_DIR (runtime writes <stateDir>/proxy-token)`);
  if (t === PLACEHOLDER_TOKEN) throw new Error(`Meterless Runtime rejects the placeholder token "${PLACEHOLDER_TOKEN}"; use the real token from <stateDir>/proxy-token`);
  return t;
}

/** Reads the token the runtime writes to <stateDir>/proxy-token. Returns null if the file is absent. */
export function readProxyToken(stateDir: string): string | null {
  const file = path.join(stateDir, "proxy-token");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf-8").trim() || null : null;
}

function baseHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "meterless-app": METERLESS.appId };
}

export interface MeterlessConfig {
  baseURL?: string;
  token: string;
  /** a routing mode, not a model: meterless/<disposition>, meterless/<class> or meterless/<class>.<disposition> */
  model?: string;
  fetchImpl?: typeof fetch;
  sleep?: ClientConfig["sleep"];
  timeoutMs?: number;
  maxRetries?: number;
}

/**
 * Adapts messages for Meterless Runtime (Nightshift).
 * WebLLM enforces that any message with role 'system' must be at index 0.
 * Because Nightshift's orchestrator can prepend its own runtime instruction
 * (for phase planning, reasoning scaffolding, or H-MEM reinjection), any caller-provided
 * system message must not remain as a separate 'system' role message that lands at
 * index >= 1.
 *
 * Preserves:
 * 1. Instruction priority: system instructions are placed at the beginning of the first user message.
 * 2. Untrusted-data boundary: clear separation between system instructions and user input.
 * 3. Role distinctions: assistant and subsequent user turns are NOT merged.
 */
export function adaptMeterlessMessages(messages: ChatMessage[]): ChatMessage[] {
  const hasSystem = messages.some((m) => m.role === "system");
  if (!hasSystem) return messages;

  const systemParts = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content.trim())
    .filter(Boolean);

  const nonSystem = messages.filter((m) => m.role !== "system");
  const systemText = systemParts.join("\n\n");

  if (nonSystem.length === 0) {
    return [{ role: "user", content: systemText }];
  }

  const firstUserIdx = nonSystem.findIndex((m) => m.role === "user");
  if (firstUserIdx >= 0) {
    return nonSystem.map((m, idx) => {
      if (idx === firstUserIdx) {
        return {
          role: "user",
          content: systemText ? `${systemText}\n\n${m.content}` : m.content,
        };
      }
      return m;
    });
  }

  return [{ role: "user", content: systemText }, ...nonSystem];
}

/** Chat model over the runtime's OpenAI-compatible API, with the contract's headers. */
export function meterlessChatModel(cfg: MeterlessConfig): ChatModel {
  const token = checkToken(cfg.token);
  const client = openAICompatible({
    provider: METERLESS.provider,
    baseURL: normalizeMeterlessBaseURL(cfg.baseURL ?? METERLESS.defaultBaseURL),
    apiKey: token,
    model: checkModel(cfg.model ?? METERLESS.defaultModel),
    timeoutMs: cfg.timeoutMs ?? METERLESS.timeoutMs,
    maxRetries: cfg.maxRetries,
    // contract: meterless-app on every request, meterless-scope: user on chat,
    // and meterless-tier-split: off so single-turn JSON schemas are not decomposed into numbered lists
    headers: {
      "meterless-app": METERLESS.appId,
      "meterless-scope": "user",
      "meterless-tier-split": "off",
    },
    fetchImpl: cfg.fetchImpl,
    sleep: cfg.sleep,
  });

  return {
    provider: client.provider,
    model: client.model,
    chat(messages, opts) {
      return client.chat(adaptMeterlessMessages(messages), opts);
    },
  };
}

export type MeterlessStatus = "online" | "unauthorized" | "offline";

export interface ProbeResult {
  baseURL: string;
  status: MeterlessStatus;
  /** every meterless/* id the runtime listed, including ones we do not recognise */
  models: string[];
  detail: string;
}

/**
 * Status comes from GET /v1/models, never /healthz: 401/403 is
 * "unauthorized", 200 with meterless ids is "online", anything else
 * (including network errors) is "offline".
 */
export async function probeMeterless(baseURL: string, token: string, fetchImpl: typeof fetch = fetch, timeoutMs = 5_000): Promise<ProbeResult> {
  const url = normalizeMeterlessBaseURL(baseURL);
  checkToken(token); // empty or placeholder token: refuse before any request
  try {
    const res = await fetchImpl(`${url}/models`, { headers: baseHeaders(token), signal: AbortSignal.timeout(timeoutMs) });
    if (res.status === 401 || res.status === 403) return { baseURL: url, status: "unauthorized", models: [], detail: `HTTP ${res.status}` };
    if (res.status !== 200) return { baseURL: url, status: "offline", models: [], detail: `HTTP ${res.status}` };
    const json: any = await res.json().catch(() => null);
    const models = Array.isArray(json?.data) ? json.data.map((m: any) => m?.id).filter((id: unknown): id is string => typeof id === "string" && id.startsWith("meterless/")) : [];
    return models.length
      ? { baseURL: url, status: "online", models, detail: `${models.length} meterless ids` }
      : { baseURL: url, status: "offline", models: [], detail: "HTTP 200 but no meterless/* ids" };
  } catch (err) {
    return { baseURL: url, status: "offline", models: [], detail: `request failed: ${(err as Error).message.split(token).join("[REDACTED]").slice(0, 120)}` };
  }
}

/**
 * Auto Detect: tries ports 8088, 8090, 8787, 11434 on 127.0.0.1, localhost
 * and [::1], in that order, and returns the first online or unauthorized hit.
 * Returns null when nothing answers. Local addresses only.
 */
export async function autoDetectMeterless(token: string, fetchImpl: typeof fetch = fetch, timeoutMs = 1_500): Promise<ProbeResult | null> {
  for (const port of METERLESS.detectPorts) {
    for (const host of METERLESS.detectHosts) {
      const r = await probeMeterless(`http://${host}:${port}/v1`, token, fetchImpl, timeoutMs);
      if (r.status !== "offline") return r;
    }
  }
  return null;
}

/**
 * Env config: METERLESS_TOKEN or meterless_runtime_token (the contract's key)
 * or the token file in METERLESS_STATE_DIR; METERLESS_BASE_URL; METERLESS_MODEL;
 * METERLESS_TIMEOUT_MS. Returns null when no token is available. Does not probe the runtime.
 */
export function meterlessFromEnv(env: NodeJS.ProcessEnv, overrides?: Partial<ClientConfig>): ChatModel | null {
  const token =
    env.METERLESS_TOKEN ||
    env[METERLESS.tokenKey] ||
    (env.METERLESS_STATE_DIR ? readProxyToken(env.METERLESS_STATE_DIR) : null);
  if (!token) return null;
  const timeoutMs = env.METERLESS_TIMEOUT_MS ? Number(env.METERLESS_TIMEOUT_MS) : (overrides?.timeoutMs ?? METERLESS.timeoutMs);
  return meterlessChatModel({
    baseURL: env.METERLESS_BASE_URL,
    token,
    model: env.METERLESS_MODEL,
    fetchImpl: overrides?.fetchImpl,
    sleep: overrides?.sleep,
    timeoutMs,
    maxRetries: overrides?.maxRetries,
  });
}
