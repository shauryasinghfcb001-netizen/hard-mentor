// One bounded test completion with a made-up prompt (approved by Shaurya,
// 2026-10-23). NVIDIA first; if that fails and an OpenRouter key exists,
// one OpenRouter call. No retries, so at most two HTTP requests in total.
// Keys are read from .env by Node's loader and never printed.
//
//   node --import tsx scripts/model-smoke.ts [evidence.jsonl]

import fs from "node:fs";
import { modelFromEnv, type ProviderName } from "../src/llm/client.ts";

const PROMPT = "Fictional student Asha has 2 hours tonight. In one sentence, how should she split them to study Coulomb's law?";

async function main(): Promise<void> {
  const out = process.argv[2];
  if (fs.existsSync(".env")) process.loadEnvFile(".env");
  if (process.env.LLM_PROVIDER === "meterless") {
    // This script calls NVIDIA/OpenRouter directly; it must not stand in for the Meterless path.
    console.error("LLM_PROVIDER=meterless: this smoke test only covers NVIDIA/OpenRouter. Nothing was called.");
    process.exit(2);
  }
  const rows: Record<string, unknown>[] = [];
  for (const provider of ["nvidia", "openrouter"] as ProviderName[]) {
    const model = modelFromEnv(process.env, provider, { maxRetries: 0, timeoutMs: 60_000 });
    if (!model) {
      rows.push({ provider, skipped: "no key in env" });
      continue;
    }
    const at = new Date().toISOString();
    const t0 = Date.now();
    try {
      const r = await model.chat([{ role: "user", content: PROMPT }], { maxTokens: 120 });
      rows.push({ at, provider, model: r.model, ok: true, latencyMs: r.latencyMs, usage: r.usage, replyExcerpt: r.text.slice(0, 240) });
      break;
    } catch (err) {
      rows.push({ at, provider, model: model.model, ok: false, latencyMs: Date.now() - t0, error: (err as Error).message.slice(0, 300) });
    }
  }
  for (const r of rows) console.log(JSON.stringify(r));
  if (out) fs.appendFileSync(out, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  process.exit(rows.some((r) => r.ok) ? 0 : 1);
}

main();
