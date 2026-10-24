// Terminal chat with the mentor: one message per stdin line. This is a
// terminal demonstration of the conversation layer, not a student interface.
//
//   node --import tsx scripts/chat.ts <dataRoot> [--today 2026-10-23] [--quiet]
//
// Lines starting with "#" are comments (echoed). A line "kabir> text" sends
// the text as Kabir (fictional); other lines are Riya (fictional). <dataRoot>
// gets a working copy of seed/study-records.csv on first use, a quiz log,
// per-student sessions and per-student H-MEM stores. Research is the offline
// MOCK fixture unless --web, which reads public official exam pages. The planner is
// rule-planner-v1 and no model is called, unless HM_PLANNER=model: then the model
// planner (with validation) drafts and each why card shows the rule baseline beside
// the model's proposal status. If HM_PLANNER=model is set but no model can be built
// from the environment (modelFromEnv), the chat says so and uses the rule planner.

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { pathToFileURL } from "node:url";
import { converse, type ConversationEnv, type StudentProfile } from "../src/agent/conversation.ts";
import { plannerFromEnv } from "../src/agent/modelPlanner.ts";
import { rulePlanner, type Planner } from "../src/agent/planner.ts";
import { renderWhyCard } from "../src/agent/whyCard.ts";
import { fixtureResearch } from "../src/context/fixtureExams.ts";
import { webResearch } from "../src/context/webResearch.ts";
import { modelFromEnv, type ChatModel } from "../src/llm/client.ts";
import { openStudentMemory, type StudentMemory } from "../src/memory/studentMemory.ts";
import { bm25Retriever, loadCorpus } from "../src/rag/ncert.ts";
import { RIYA } from "../src/synthetic/riya.ts";

const PROFILES: Record<string, StudentProfile> = {
  riya: { studentId: RIYA.studentId, name: RIYA.name, hoursPerDay: RIYA.dailyStudyHours },
  meera: { studentId: "meera", name: "Meera (fictional)", hoursPerDay: 2 },
  kabir: { studentId: "kabir", name: "Kabir (fictional)", hoursPerDay: 2 },
};

export interface PlannerChoice {
  planner: Planner;
  /** what the banner says about the planner */
  label: string;
  /** printed before the banner when the model was requested but cannot be used */
  notice?: string;
}

/**
 * HM_PLANNER unset or not "model": the rule planner, banner text as it always was. HM_PLANNER=model: the model
 * planner via plannerFromEnv (validation on). If no model can be built, the rule planner is used and the notice
 * and the label say so; the chat never falls back silently. `getModel` is called only when the model is requested,
 * so the default path never reads provider settings.
 */
export function choosePlanner(env: NodeJS.ProcessEnv, getModel: () => ChatModel | null): PlannerChoice {
  if (env.HM_PLANNER !== "model") return { planner: rulePlanner, label: "rule-planner-v1 (no model)" };
  let model: ChatModel | null = null;
  let why = "no model is configured in the environment";
  try {
    model = getModel();
  } catch (err) {
    why = (err as Error).message.slice(0, 200);
  }
  if (!model) {
    return {
      planner: rulePlanner,
      label: "rule-planner-v1 (no model; HM_PLANNER=model was requested but unavailable)",
      notice: `HM_PLANNER=model was requested but no model is available (${why}). Using the rule planner instead: every plan below is the rule baseline, no model proposal exists.`,
    };
  }
  const planner = plannerFromEnv(env, model);
  return { planner, label: `${planner.name} (model planner with validation; why cards show the rule baseline beside the model proposal and its status)` };
}

export interface ChatRun {
  args: string[];
  env: NodeJS.ProcessEnv;
  lines: AsyncIterable<string>;
  log: (text: string) => void;
  /** injected in tests; when omitted the model is built from env, only if HM_PLANNER=model */
  model?: ChatModel | null;
}

export async function runChat({ args, env: processEnv, lines, log, model }: ChatRun): Promise<void> {
  const dataRoot = args.find((a) => !a.startsWith("--"));
  if (!dataRoot) throw new Error("usage: chat.ts <dataRoot> [--today YYYY-MM-DD] [--quiet] [--web]");
  const today = args.includes("--today") ? args[args.indexOf("--today") + 1] : new Date().toISOString().slice(0, 10);
  const quiet = args.includes("--quiet");
  const root = path.resolve(dataRoot);
  fs.mkdirSync(root, { recursive: true });
  const records = path.join(root, "study-records.csv");
  if (!fs.existsSync(records)) fs.copyFileSync("seed/study-records.csv", records);

  let t = Date.parse(`${today}T09:00:00Z`);
  const clock = () => (t += 60_000);
  const corpus = loadCorpus("corpus/ncert-phy12-ch1.json");
  const memories = new Map<string, StudentMemory>();
  const choice = choosePlanner(processEnv, () => (model !== undefined ? model : modelFromEnv(processEnv)));
  const env: ConversationEnv = {
    planner: choice.planner,
    retriever: bm25Retriever(corpus),
    research: args.includes("--web") ? webResearch() : fixtureResearch,
    corpora: [corpus],
    records,
    quizLog: path.join(root, "quiz-log.csv"),
    sessionsDir: path.join(root, "sessions"),
    async memoryFor(id) {
      if (!memories.has(id)) memories.set(id, await openStudentMemory(id, { dataRoot: path.join(root, "students"), clock }));
      return memories.get(id)!;
    },
    now: () => new Date(clock()).toISOString(),
  };

  if (choice.notice) log(choice.notice);
  log("TERMINAL DEMONSTRATION (not a student interface).");
  log(`WHAT RUNS: exam research = ${args.includes("--web") ? "LIVE read of public pages (discovery via Wikidata, facts only from the exam body's own site); no model reads them" : "offline MOCK fixture (no web)"}; planner = ${choice.label}; quiz = rules over NCERT Ch 1 notes;`);
  log(`memory = H-MEM per student; records = local synthetic CSV copy in ${root}; students and their messages are fictional; clock starts ${today}T09:00Z.\n`);

  for await (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      log(`\n${line}`);
      continue;
    }
    const m = line.match(/^(\w+)>\s*(.*)$/);
    const profile = m && PROFILES[m[1]] ? PROFILES[m[1]] : PROFILES.riya;
    const message = m && PROFILES[m[1]] ? m[2] : line;
    log(`\n${profile.name} > ${message}`);
    const r = await converse(env, profile, message);
    log(`Mentor > ${r.reply.replace(/\n/g, "\n         ")}`);
    if (r.why && !quiet) log(renderWhyCard(r.why).replace(/^/gm, "   | "));
    if (r.handledBy === "intake") log(`   | (intake step, no graph run; next step: ${r.session.stage === "ready" ? "done" : r.session.intake.step})`);
  }
}

// Run only when started as a script, not when a test imports runChat.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runChat({ args: process.argv.slice(2), env: process.env, lines: readline.createInterface({ input: process.stdin, terminal: false }), log: console.log }).catch((err) => {
    if ((err as Error).message.startsWith("usage:")) {
      console.error((err as Error).message);
      process.exit(2);
    }
    console.error(err);
    process.exit(1);
  });
}
