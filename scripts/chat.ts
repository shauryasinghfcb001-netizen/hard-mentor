// Terminal chat with the mentor: one message per stdin line. This is a
// terminal demonstration of the conversation layer, not a student interface.
//
//   node --import tsx scripts/chat.ts <dataRoot> [--today 2026-10-23] [--quiet]
//
// Lines starting with "#" are comments (echoed). A line "kabir> text" sends
// the text as Kabir (fictional); other lines are Riya (fictional). <dataRoot>
// gets a working copy of seed/study-records.csv on first use, a quiz log,
// per-student sessions and per-student H-MEM stores. Research is the offline
// MOCK fixture unless --web, which reads public official exam pages; the planner is rule-planner-v1; no model is called.

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { converse, type ConversationEnv, type StudentProfile } from "../src/agent/conversation.ts";
import { rulePlanner } from "../src/agent/planner.ts";
import { renderWhyCard } from "../src/agent/whyCard.ts";
import { fixtureResearch } from "../src/context/fixtureExams.ts";
import { webResearch } from "../src/context/webResearch.ts";
import { openStudentMemory, type StudentMemory } from "../src/memory/studentMemory.ts";
import { bm25Retriever, loadCorpus } from "../src/rag/ncert.ts";
import { RIYA } from "../src/synthetic/riya.ts";

const PROFILES: Record<string, StudentProfile> = {
  riya: { studentId: RIYA.studentId, name: RIYA.name, hoursPerDay: RIYA.dailyStudyHours },
  meera: { studentId: "meera", name: "Meera (fictional)", hoursPerDay: 2 },
  kabir: { studentId: "kabir", name: "Kabir (fictional)", hoursPerDay: 2 },
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dataRoot = args.find((a) => !a.startsWith("--"));
  if (!dataRoot) {
    console.error("usage: chat.ts <dataRoot> [--today YYYY-MM-DD] [--quiet] [--web]");
    process.exit(2);
  }
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
  const env: ConversationEnv = {
    planner: rulePlanner,
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

  console.log("TERMINAL DEMONSTRATION (not a student interface).");
  console.log(`WHAT RUNS: exam research = ${args.includes("--web") ? "LIVE read of public pages (discovery via Wikidata, facts only from the exam body's own site); no model reads them" : "offline MOCK fixture (no web)"}; planner = rule-planner-v1 (no model); quiz = rules over NCERT Ch 1 notes;`);
  console.log(`memory = H-MEM per student; records = local synthetic CSV copy in ${root}; students and their messages are fictional; clock starts ${today}T09:00Z.\n`);

  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  for await (const raw of rl) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      console.log(`\n${line}`);
      continue;
    }
    const m = line.match(/^(\w+)>\s*(.*)$/);
    const profile = m && PROFILES[m[1]] ? PROFILES[m[1]] : PROFILES.riya;
    const message = m && PROFILES[m[1]] ? m[2] : line;
    console.log(`\n${profile.name} > ${message}`);
    const r = await converse(env, profile, message);
    console.log(`Mentor > ${r.reply.replace(/\n/g, "\n         ")}`);
    if (r.why && !quiet) console.log(renderWhyCard(r.why).replace(/^/gm, "   | "));
    if (r.handledBy === "intake") console.log(`   | (intake step, no graph run; next step: ${r.session.stage === "ready" ? "done" : r.session.intake.step})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
