// The chat CLI entry point (scripts/chat.ts runChat): default output unchanged, and the baseline-vs-model
// comparison shown when HM_PLANNER=model. Offline and mocked: the model is an injected stub, fetch fails the
// test if called, and the environment passed to the CLI is an explicit object, never process.env.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runChat } from "../scripts/chat.ts";
import type { ChatMessage, ChatModel } from "../src/llm/client.ts";

const realFetch = globalThis.fetch;
let fetchCalls = 0;
before(() => {
  assert.equal(process.env.HM_STUDY_SOURCE, undefined, "test must run on the local CSV source, not Zetaris");
  globalThis.fetch = (async () => {
    fetchCalls++;
    throw new Error("real network request attempted in an offline test");
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
  assert.equal(fetchCalls, 0, "no fetch call may happen");
});

const SCRIPT = ["hi", "12th boards", "India", "90% in PCM", "15 Feb 2027", "CBSE", "Plan my study for today."];
const GOLDEN = fs.readFileSync("test/fixtures/chat-default.golden.txt", "utf8");

async function* from(lines: string[]) {
  yield* lines;
}

async function cli(env: NodeJS.ProcessEnv, model?: ChatModel | null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hm-cli-"));
  const out: string[] = [];
  await runChat({ args: [root, "--today", "2026-10-23"], env, lines: from(SCRIPT), log: (s) => out.push(s), model });
  return out.join("\n").split(root).join("<ROOT>") + "\n";
}

type Reply = (prompt: string) => string | Error;
function stubModel(reply: Reply): ChatModel & { calls: number } {
  return {
    provider: "fake",
    model: "stub",
    calls: 0,
    async chat(messages: ChatMessage[]) {
      this.calls++;
      const r = reply(messages[messages.length - 1].content);
      if (r instanceof Error) throw r;
      return { text: r, model: "stub", provider: "fake", latencyMs: 1, attempts: 1 };
    },
  };
}
const goodPlan = (prompt: string) => {
  const [topicId, row] = prompt.match(/^- (\S+) ".*?".*\[data_row (\S+?)\]$/m)!.slice(1);
  return JSON.stringify({
    decision: "daily_plan",
    blocks: [{ topicId, minutes: 45, activity: "NCERT" }],
    message: "MODEL-PLAN: top topic first.",
    reasons: [{ text: "top priority", ref: { kind: "data_row", id: row } }],
  });
};

test("default (HM_PLANNER unset): CLI output is byte-identical to the output the unmodified script printed", async () => {
  assert.equal(await cli({}), GOLDEN);
});

test("default stays on the rule planner even when a model is injected: the model is never called", async () => {
  const model = stubModel(goodPlan);
  assert.equal(await cli({}, model), GOLDEN);
  assert.equal(model.calls, 0);
});

test("HM_PLANNER=model with a model: the comparison is printed beside the baseline, the plan sent is the validated proposal", async () => {
  const model = stubModel(goodPlan);
  const out = await cli({ HM_PLANNER: "model" }, model);
  assert.ok(model.calls > 0);
  assert.match(out, /planner = model:fake\/stub \(model planner with validation;/);
  assert.ok(!out.includes("was requested but"));
  assert.match(out, /Mentor > MODEL-PLAN: top topic first\./);
  assert.match(out, /   \| Plan comparison:\n   \|   Rule baseline: daily_plan: physics:electrostatics 90min, /);
  assert.match(out, /   \|   Model proposal: validated: daily_plan: physics:electrostatics 45min\n/);
  assert.match(out, /   \|   Plan sent: the model's validated proposal\n/);
});

test("HM_PLANNER=model, model draft rejected: baseline is the plan, reason codes shown, raw text not shown", async () => {
  const out = await cli({ HM_PLANNER: "model" }, stubModel(() => "I think Riya should rest and eat biryani."));
  assert.match(out, /Mentor > Today: Electrostatics first for 90 min/);
  assert.match(out, /   \|   Model proposal: rejected \(malformed\); not used, not shown as a plan\n/);
  assert.match(out, /   \|   Plan sent: the rule baseline\n/);
  assert.ok(!out.includes("biryani"));
});

test("HM_PLANNER=model, model error: baseline is the plan, labelled model error, not model success", async () => {
  const out = await cli({ HM_PLANNER: "model" }, stubModel(() => new Error("nvidia HTTP 503: busy")));
  assert.match(out, /Mentor > Today: Electrostatics first for 90 min/);
  assert.match(out, /   \|   Model proposal: model error \(model_error: nvidia HTTP 503: busy\); no proposal\n/);
  assert.match(out, /   \|   Plan sent: the rule baseline\n/);
  assert.ok(!out.includes("validated"));
});

test("HM_PLANNER=model but no model can be built: message printed first, banner labelled, rule plan, no comparison", async () => {
  for (const env of [{ HM_PLANNER: "model" }, { HM_PLANNER: "model", LLM_PROVIDER: "no-such-provider" }]) {
    const out = await cli(env); // model not injected: built from this explicit env, which holds no key
    assert.ok(out.startsWith("HM_PLANNER=model was requested but no model is available ("), out.slice(0, 120));
    assert.match(out.split("\n")[0], /Using the rule planner instead: every plan below is the rule baseline, no model proposal exists\.$/);
    assert.match(out, /planner = rule-planner-v1 \(no model; HM_PLANNER=model was requested but unavailable\);/);
    assert.match(out, /Mentor > Today: Electrostatics first for 90 min/);
    assert.ok(!out.includes("Plan comparison"));
  }
  const injectedNull = await cli({ HM_PLANNER: "model" }, null);
  assert.ok(injectedNull.startsWith("HM_PLANNER=model was requested but no model is available (no model is configured in the environment)."));
});

test("a model comparison never claims a live model", async () => {
  const out = await cli({ HM_PLANNER: "model" }, stubModel(goodPlan));
  const card = out.slice(out.indexOf("Plan comparison:"), out.indexOf("Loop:", out.indexOf("Plan comparison:")));
  assert.ok(card.length > 0 && !/\blive\b/i.test(card));
});
