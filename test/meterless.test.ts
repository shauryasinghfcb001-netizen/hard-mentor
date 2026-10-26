// Meterless Runtime adapter against the 0.90.0 contract. Every response here
// comes from a mocked fetch: no runtime was installed or called.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runMentor, type StudentContext } from "../src/agent/graph.ts";
import { createModelPlanner } from "../src/agent/modelPlanner.ts";
import { modelFromEnv } from "../src/llm/client.ts";
import { autoDetectMeterless, meterlessChatModel, meterlessFromEnv, normalizeMeterlessBaseURL, parseConnectLink, probeMeterless } from "../src/llm/meterless.ts";
import { RIYA_TOPICS } from "../src/synthetic/riya.ts";

const TOKEN = "mt-FAKE-test-token-0000";

type Call = { url: string; init: RequestInit };
function mockFetch(route: (url: string) => { status: number; body: unknown } | Error, calls: Call[] = []) {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = route(url);
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

test("URL normalisation: any pasted form becomes <host>/v1, never /v1/v1", () => {
  for (const [input, want] of [
    ["127.0.0.1:8088", "http://127.0.0.1:8088/v1"],
    ["http://127.0.0.1:8088", "http://127.0.0.1:8088/v1"],
    ["http://127.0.0.1:8088/v1", "http://127.0.0.1:8088/v1"],
    ["http://127.0.0.1:8088/v1/", "http://127.0.0.1:8088/v1"],
    ["http://127.0.0.1:8088/v1/chat/completions", "http://127.0.0.1:8088/v1"],
    ["localhost:8090/v1/models", "http://localhost:8090/v1"],
    ["http://[::1]:8787/healthz", "http://[::1]:8787/v1"],
    ["https://box.lan:8088/v1/v1", "https://box.lan:8088/v1"],
    ["", "http://127.0.0.1:8088/v1"],
  ]) {
    assert.equal(normalizeMeterlessBaseURL(input), want, input);
  }
});

test("connect link (v4): fills base URL, key, model and app; plain URLs are not links; no host is contacted", () => {
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (async () => (fetched++, new Response("{}"))) as typeof fetch;
  try {
    assert.deepEqual(parseConnectLink(`http://192.168.1.20:8088/connect#k=${TOKEN}`), {
      baseURL: "http://192.168.1.20:8088/v1",
      key: TOKEN,
      model: "meterless/auto",
      app: "hard-mentor",
    });
    const l = parseConnectLink(`  https://box.lan:8090/connect/#k=${TOKEN}&m=meterless/text.fast&n=study-app  `);
    assert.equal(l?.baseURL, "https://box.lan:8090/v1");
    assert.equal(l?.model, "meterless/text.fast");
    assert.equal(l?.app, "study-app");
    for (const plain of ["http://127.0.0.1:8088/v1", "127.0.0.1:8088", "http://127.0.0.1:8088/v1/models", "http://127.0.0.1:8088/connections", ""]) {
      assert.equal(parseConnectLink(plain), null, plain);
    }
    assert.equal(fetched, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("connect link (v4): malformed links are rejected, and no error text contains the link, key or fragment", () => {
  const cases: [string, RegExp][] = [
    ["http://127.0.0.1:8088/connect", /no key/],
    ["http://127.0.0.1:8088/connect#m=meterless/auto", /no key/],
    [`ftp://127.0.0.1:8088/connect#k=${TOKEN}`, /http or https/],
    [`http://127.0.0.1:8088/connect?k=${TOKEN}`, /never in the query string/],
    [`http://user:${TOKEN}@127.0.0.1:8088/connect#k=${TOKEN}`, /credentials/],
    ["http://127.0.0.1:8088/connect#k=rt-local", /placeholder/],
    [`http://127.0.0.1:8088/connect#k=${TOKEN}&m=gpt-4o`, /routing mode/],
    [`http://127.0.0.1:8088/connect#k=${TOKEN}&n=Bad App!`, /lowercase id/],
    [`http://[::1:8088/connect#k=${TOKEN}`, /not a valid URL/],
  ];
  for (const [link, why] of cases) {
    let msg = "";
    assert.throws(() => parseConnectLink(link), (e: Error) => ((msg = e.message), true), link.replace(TOKEN, "<token>"));
    assert.match(msg, why);
    assert.ok(!msg.includes(TOKEN) && !msg.includes("127.0.0.1") && !msg.includes("#"), `leaks input: ${msg}`);
  }
});

test("chat sends Bearer token, meterless-app and meterless-scope: user, a routing-mode model id and a plain string", async () => {
  const calls: Call[] = [];
  const m = meterlessChatModel({
    baseURL: "127.0.0.1:8088/v1/chat/completions",
    token: TOKEN,
    fetchImpl: mockFetch(() => ({ status: 200, body: { choices: [{ message: { content: "mock reply" } }], model: "meterless/auto" } }), calls),
  });
  const r = await m.chat([{ role: "user", content: "hi" }]);
  assert.equal(r.text, "mock reply");
  assert.equal(r.provider, "meterless");
  assert.equal(calls[0].url, "http://127.0.0.1:8088/v1/chat/completions");
  const h = calls[0].init.headers as Record<string, string>;
  assert.equal(h.authorization, `Bearer ${TOKEN}`);
  assert.equal(h["meterless-app"], "hard-mentor");
  assert.equal(h["meterless-scope"], "user");
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.model, "meterless/auto");
  assert.equal(typeof body.messages[0].content, "string");
});

test("token: missing and the rt-local placeholder are refused before any request", () => {
  assert.throws(() => meterlessChatModel({ token: "" }), /token missing/);
  assert.throws(() => meterlessChatModel({ token: "rt-local" }), /placeholder token "rt-local"/);
});

test("status comes from /v1/models: 401/403 unauthorized, 200 with meterless ids online, anything else offline", async () => {
  const at = (status: number, body: unknown = {}) => probeMeterless("127.0.0.1:8088", TOKEN, mockFetch(() => ({ status, body })));
  assert.equal((await at(401)).status, "unauthorized");
  assert.equal((await at(403)).status, "unauthorized");
  assert.equal((await at(500)).status, "offline");
  assert.equal((await at(200, { data: [{ id: "gpt-4o" }] })).status, "offline");
  const online = await at(200, { data: [{ id: "meterless/auto" }, { id: "meterless/text.deep" }, { id: "meterless/brand-new-mode" }, { id: "llama3" }] });
  assert.equal(online.status, "online");
  assert.deepEqual(online.models, ["meterless/auto", "meterless/text.deep", "meterless/brand-new-mode"]); // unknown meterless ids kept
  const down = await probeMeterless("127.0.0.1:8088", TOKEN, mockFetch(() => new Error(`connect ECONNREFUSED token=${TOKEN}`)));
  assert.equal(down.status, "offline");
  assert.ok(!down.detail.includes(TOKEN));
});

test("probe calls /v1/models (not /healthz) with the token and app header", async () => {
  const calls: Call[] = [];
  await probeMeterless("http://127.0.0.1:8088/healthz", TOKEN, mockFetch(() => ({ status: 401, body: {} }), calls));
  assert.equal(calls[0].url, "http://127.0.0.1:8088/v1/models");
  assert.equal((calls[0].init.headers as Record<string, string>)["meterless-app"], "hard-mentor");
});

test("Auto Detect tries ports 8088, 8090, 8787, 11434 on three local hosts in order and keeps the first unauthorized hit", async () => {
  const calls: Call[] = [];
  const hit = await autoDetectMeterless(TOKEN, mockFetch((url) => (url.startsWith("http://localhost:8787") ? { status: 401, body: {} } : new Error("refused")), calls));
  assert.equal(hit?.baseURL, "http://localhost:8787/v1");
  assert.equal(hit?.status, "unauthorized");
  assert.deepEqual(
    calls.map((c) => new URL(c.url).host),
    ["127.0.0.1:8088", "localhost:8088", "[::1]:8088", "127.0.0.1:8090", "localhost:8090", "[::1]:8090", "127.0.0.1:8787", "localhost:8787"]
  );
  assert.equal(await autoDetectMeterless(TOKEN, mockFetch(() => new Error("refused"))), null);
});

test("env: LLM_PROVIDER=meterless never falls back to NVIDIA or OpenRouter, even when their keys are set", () => {
  const env = { LLM_PROVIDER: "meterless", NVIDIA_API_KEY: "nvapi-FAKE", OPENROUTER_API_KEY: "sk-or-FAKE" };
  assert.equal(modelFromEnv(env), null);
  const m = modelFromEnv({ ...env, meterless_runtime_token: TOKEN });
  assert.equal(m?.provider, "meterless");
  assert.equal(m?.model, "meterless/auto");
  const m2 = modelFromEnv({ ...env, METERLESS_TOKEN: TOKEN });
  assert.equal(m2?.provider, "meterless");
  assert.equal(m2?.model, "meterless/auto");
});

test("env: token is read from <METERLESS_STATE_DIR>/proxy-token when the key is not set", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hm-mt-"));
  assert.equal(meterlessFromEnv({ METERLESS_STATE_DIR: dir }), null);
  fs.writeFileSync(path.join(dir, "proxy-token"), `${TOKEN}\n`);
  assert.equal(meterlessFromEnv({ METERLESS_STATE_DIR: dir, METERLESS_MODEL: "meterless/text.fast" })?.model, "meterless/text.fast");
});

test("graph: model planner on a MOCKED Meterless runtime is labelled meterless; an offline runtime falls back to rules, not to NVIDIA", async () => {
  const student: StudentContext = { studentId: "riya", name: "Riya (fictional)", hoursPerDay: 3, daysToExam: 120, topics: RIYA_TOPICS };
  const draft = {
    decision: "daily_plan",
    blocks: [{ topicId: "physics:electrostatics", minutes: 90, activity: "NCERT examples" }],
    message: "Electrostatics first, 90 min.",
    reasons: [{ text: "Top priority", ref: { kind: "data_row", id: "fixture:riya_topics#1" } }],
  };
  const calls: Call[] = [];
  const up = meterlessChatModel({ token: TOKEN, fetchImpl: mockFetch(() => ({ status: 200, body: { choices: [{ message: { content: JSON.stringify(draft) } }] } }), calls) });
  const s = await runMentor({ planner: createModelPlanner(up), memory: null }, student, "Plan my study for today.");
  assert.equal(s.outcome, "sent");
  assert.ok(s.trace.some((t) => t.detail.includes("by model:meterless/meterless/auto (model)")));
  assert.ok(calls.every((c) => c.url.startsWith("http://127.0.0.1:8088/")));

  const down: Call[] = [];
  const off = meterlessChatModel({ token: TOKEN, maxRetries: 0, fetchImpl: mockFetch(() => new Error("ECONNREFUSED"), down) });
  const s2 = await runMentor({ planner: createModelPlanner(off), memory: null }, student, "Plan my study for today.");
  assert.ok(s2.trace.some((t) => /rule-planner-v1 \(rules; model failed: meterless request failed/.test(t.detail)));
  assert.ok(down.every((c) => c.url.startsWith("http://127.0.0.1:8088/")));
});

// OFFLINE MOCK - not Meterless connection evidence. Contract-alignment additions.

test("OFFLINE MOCK: model must be a meterless/* routing id; unknown meterless ids are kept, other names refused", async () => {
  const calls: Call[] = [];
  const ok = meterlessChatModel({ token: TOKEN, model: "meterless/brand-new.mode", fetchImpl: mockFetch(() => ({ status: 200, body: { choices: [{ message: { content: "x" } }] } }), calls) });
  await ok.chat([{ role: "user", content: "hi" }]);
  assert.equal(JSON.parse(String(calls[0].init.body)).model, "meterless/brand-new.mode");
  for (const bad of ["gpt-4o", "", "meterless/", "meterless/a b", "nvidia/nemotron"]) {
    assert.throws(() => meterlessChatModel({ token: TOKEN, model: bad }), /meterless\/\* routing id/, JSON.stringify(bad));
  }
  assert.throws(() => meterlessFromEnv({ meterless_runtime_token: TOKEN, METERLESS_MODEL: "gpt-4o" }), /routing id/);
});

test("OFFLINE MOCK: probe and auto-detect refuse an empty or placeholder token with no request", async () => {
  const calls: Call[] = [];
  const f = mockFetch(() => ({ status: 200, body: {} }), calls);
  await assert.rejects(probeMeterless("127.0.0.1:8088", "", f), /token missing/);
  await assert.rejects(probeMeterless("127.0.0.1:8088", "rt-local", f), /placeholder/);
  await assert.rejects(autoDetectMeterless("  ", f), /token missing/);
  assert.equal(calls.length, 0);
});

test("OFFLINE MOCK: chat request timeout is 900 s default (timer mocked), probe stays short; models request sends bearer + app header, no scope", async () => {
  const realTimeout = AbortSignal.timeout;
  const seen: number[] = [];
  AbortSignal.timeout = ((ms: number) => (seen.push(ms), new AbortController().signal)) as typeof AbortSignal.timeout;
  try {
    const calls: Call[] = [];
    const f = mockFetch((url) => (url.endsWith("/models") ? { status: 200, body: { data: [{ id: "meterless/auto" }] } } : { status: 200, body: { choices: [{ message: { content: "ok" } }] } }), calls);
    await meterlessChatModel({ token: TOKEN, fetchImpl: f }).chat([{ role: "user", content: "hi" }]);
    assert.deepEqual(seen, [900_000]);
    await probeMeterless("127.0.0.1:8088", TOKEN, f);
    assert.equal(seen[1], 5_000);
    const h = calls[1].init.headers as Record<string, string>;
    assert.equal(h.authorization, `Bearer ${TOKEN}`);
    assert.equal(h["meterless-app"], "hard-mentor");
    assert.equal(h["meterless-scope"], undefined);

    // Configurable timeout
    await meterlessChatModel({ token: TOKEN, timeoutMs: 45_000, fetchImpl: f }).chat([{ role: "user", content: "hi" }]);
    assert.equal(seen[2], 45_000);
    const fromEnv = meterlessFromEnv({ METERLESS_TOKEN: TOKEN, METERLESS_TIMEOUT_MS: "30000" }, { fetchImpl: f });
    await fromEnv?.chat([{ role: "user", content: "hi" }]);
    assert.equal(seen[3], 30_000);
  } finally {
    AbortSignal.timeout = realTimeout;
  }
});

test("OFFLINE MOCK: chat 401/403 is not retried; plain-text content stays a string", async () => {
  for (const status of [401, 403]) {
    const calls: Call[] = [];
    const m = meterlessChatModel({ token: TOKEN, sleep: async () => {}, fetchImpl: mockFetch(() => ({ status, body: { error: TOKEN } }), calls) });
    await assert.rejects(m.chat([{ role: "system", content: "s" }, { role: "user", content: "u" }]), (e: Error) => !e.message.includes(TOKEN));
    assert.equal(calls.length, 1);
    for (const msg of JSON.parse(String(calls[0].init.body)).messages) assert.equal(typeof msg.content, "string");
  }
});

test("regression: meterlessChatModel preserves OpenAI messages and sends only documented Meterless headers", async () => {
  const calls: Call[] = [];
  const m = meterlessChatModel({
    token: TOKEN,
    fetchImpl: mockFetch(
      () => ({
        status: 200,
        body: {
          choices: [{ message: { content: "mock reply" } }],
          model: "webllm/Llama-3.2-1B-Instruct-q4f16_1-MLC",
        },
      }),
      calls
    ),
  });

  const messages = [
    { role: "system", content: "SYSTEM INSTRUCTIONS: You are Hard Mentor." },
    { role: "user", content: 'Student: Riya.\nStudent message: """Plan my day."""' },
  ] as const;
  await m.chat([...messages]);

  assert.equal(calls.length, 1);
  const h = calls[0].init.headers as Record<string, string>;
  assert.equal(h["meterless-app"], "hard-mentor");
  assert.equal(h["meterless-scope"], "user");
  assert.equal(h["meterless-tier-split"], undefined);

  const body = JSON.parse(String(calls[0].init.body));
  assert.deepEqual(body.messages, messages);
});

test("regression: product createModelPlanner through meterlessChatModel produces valid request and validates response", async () => {
  const calls: Call[] = [];
  const draftJson = JSON.stringify({
    decision: "daily_plan",
    blocks: [{ topicId: "physics:electrostatics", minutes: 90, activity: "NCERT examples" }],
    message: "Focus on Electrostatics first.",
    reasons: [{ text: "Top priority weak topic", ref: { kind: "data_row", id: "record:riya:physics:electrostatics" } }],
  });

  const client = meterlessChatModel({
    token: TOKEN,
    fetchImpl: mockFetch(
      () => ({
        status: 200,
        body: {
          choices: [{ message: { content: draftJson } }],
          model: "webllm/Llama-3.2-1B-Instruct-q4f16_1-MLC",
        },
      }),
      calls
    ),
  });

  const planner = createModelPlanner(client, {}, { validate: true });
  const draft = await planner.draft({
    name: "Riya",
    hoursPerDay: 2,
    message: "Plan my study for today.",
    intent: "plan",
    ranked: [
      {
        topicId: "physics:electrostatics",
        subject: "physics",
        name: "Electrostatics",
        mastery: 0.35,
        marksWeight: 8,
        priority: 0.65,
        urgency: 1.25,
        sourceRow: "record:riya:physics:electrostatics",
      },
    ],
    memories: [],
    attempt: 1,
    feedback: [],
  });

  // Verify the serialized call boundary
  assert.equal(calls.length, 1);
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.messages[0].role, "system");
  assert.equal(body.messages[1].role, "user");

  // Verify the draft was parsed and validated successfully (not fallen back to rules)
  assert.equal(draft.decision, "daily_plan");
  assert.equal(draft.producedBy, undefined, "validated draft must not have fallback producedBy set");
  assert.equal(draft.blocks[0].topicId, "physics:electrostatics");
});
