import { test } from "node:test";
import assert from "node:assert/strict";
import { modelFromEnv, openAICompatible } from "../src/llm/client.ts";

const KEY = "nvapi-FAKE-test-key-0000";

function fakeFetch(responses: { status: number; body: unknown }[], calls: { url: string; init: RequestInit }[]) {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift()!;
    const text = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    return new Response(text, { status: r.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

const ok = { choices: [{ message: { content: "Spend 60 min on NCERT examples, 60 on problems." } }], model: "nvidia/test", usage: { total_tokens: 42 } };

test("client sends an OpenAI-compatible request and returns text, latency and usage", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const m = openAICompatible({ provider: "nvidia", baseURL: "https://example.test/v1/", apiKey: KEY, model: "nvidia/test", fetchImpl: fakeFetch([{ status: 200, body: ok }], calls) });
  const r = await m.chat([{ role: "user", content: "hi" }], { maxTokens: 50 });
  assert.equal(r.text, ok.choices[0].message.content);
  assert.equal(r.attempts, 1);
  assert.equal(r.usage?.total_tokens, 42);
  assert.ok(r.latencyMs >= 0);
  assert.equal(calls[0].url, "https://example.test/v1/chat/completions");
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.model, "nvidia/test");
  assert.equal(body.max_tokens, 50);
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, `Bearer ${KEY}`);
});

test("client backs off and retries on 429, then succeeds", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const waits: number[] = [];
  const m = openAICompatible({
    provider: "openrouter",
    baseURL: "https://example.test/v1",
    apiKey: KEY,
    model: "x",
    fetchImpl: fakeFetch([{ status: 429, body: "rate limited" }, { status: 503, body: "busy" }, { status: 200, body: ok }], calls),
    sleep: async (ms) => void waits.push(ms),
  });
  const r = await m.chat([{ role: "user", content: "hi" }]);
  assert.equal(r.attempts, 3);
  assert.deepEqual(waits, [500, 1000]);
});

test("client does not retry 401 and never leaks the key in the error", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const m = openAICompatible({ provider: "nvidia", baseURL: "https://example.test/v1", apiKey: KEY, model: "x", fetchImpl: fakeFetch([{ status: 401, body: `{"error":"bad key ${KEY}"}` }], calls) });
  await assert.rejects(m.chat([{ role: "user", content: "hi" }]), (err: Error) => {
    assert.match(err.message, /HTTP 401/);
    assert.ok(!err.message.includes(KEY), "key must be redacted");
    assert.match(err.message, /\[REDACTED\]/);
    return true;
  });
  assert.equal(calls.length, 1);
});

test("modelFromEnv: null without a key; fallback provider ignores primary-only overrides", () => {
  assert.equal(modelFromEnv({}), null);
  const env = { LLM_PROVIDER: "nvidia", NVIDIA_API_KEY: KEY, OPENROUTER_API_KEY: "or-FAKE", LLM_MODEL: "custom/nvidia-model" };
  assert.equal(modelFromEnv(env)!.model, "custom/nvidia-model");
  assert.equal(modelFromEnv(env, "openrouter")!.model, "nvidia/nemotron-3-nano-30b-a3b:free");
  assert.throws(() => modelFromEnv({ LLM_PROVIDER: "acme" }), /unknown LLM_PROVIDER/);
});
