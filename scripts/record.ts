// Loopback-only, fictional-only recording shell. No provider configuration is read.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { converse, loadSession } from "../src/agent/conversation.ts";
import { rulePlanner } from "../src/agent/planner.ts";
import { renderWhyCard } from "../src/agent/whyCard.ts";
import { fictionalSandbox } from "../src/consent/storageGate.ts";
import { csvStudyData, readQuizLog } from "../src/data/studyData.ts";
import { listMemories } from "../src/memory/studentMemory.ts";
import { readAttempts, attemptsPathFor } from "../src/quiz/attempts.ts";
import { RIYA } from "../src/synthetic/riya.ts";
import { chatEnvironment } from "./chat-environment.ts";

const profile = { studentId: RIYA.studentId, name: RIYA.name, hoursPerDay: RIYA.dailyStudyHours };
const today = "2026-10-23"; // Explicit simulated study date, not execution date.
type Demo = Awaited<ReturnType<typeof freshDemo>>;
async function freshDemo() {
  const root = fictionalSandbox("pm-recording-");
  const env = chatEnvironment(root, today, rulePlanner);
  const first = await converse(env, profile, "hi", { memory: false });
  await converse(env, profile, "turn memory off", { memory: false });
  const messages = [{ role: "mentor", text: first.reply }];
  return { root, env, messages };
}

async function view(demo: Demo) {
  const session = loadSession(demo.env, profile.studentId)!;
  const scores = fs.existsSync(demo.env.quizLog) ? readQuizLog(demo.env.quizLog) : [];
  const topics = (await csvStudyData(demo.env.records, demo.env.quizLog).topicsFor(profile.studentId)).rows;
  const memoryPath = path.join(demo.root, "students", "riya");
  const memories = fs.existsSync(memoryPath) ? listMemories((await demo.env.memoryFor("riya"))!) : [];
  return { messages: demo.messages, memoryOn: !session.memoryOff, stage: session.stage,
    why: session.lastWhy ? renderWhyCard(session.lastWhy) : "Your plan and its sources will appear here after intake.",
    topics, scores, attempts: readAttempts(attemptsPathFor(demo.env.quizLog), "riya"), memories,
    simulatedDate: today };
}

export function recordingServer() {
  if (process.env.HM_STUDY_SOURCE && process.env.HM_STUDY_SOURCE !== "csv") throw new Error("Use npm run record: isolated offline environment required");
  const demos = new Map<string, Demo>();
  let serial = Promise.resolve();
  const server = http.createServer((req, res) => {
    serial = serial.then(async () => {
      const address = server.address();
      if (!address || typeof address === "string") throw Error();
      const host = `127.0.0.1:${address.port}`;
      const origin = `http://${host}`;
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
      const send = (status: number, body: unknown) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
      if (req.headers.host !== host) return send(403, { error: "Open the exact loopback URL printed by the launcher." });
      const route = req.url;
      const assets: Record<string, [string, string]> = { "/": ["index.html", "text/html; charset=utf-8"], "/app.js": ["app.js", "text/javascript; charset=utf-8"], "/style.css": ["style.css", "text/css; charset=utf-8"] };
      if (route && assets[route]) {
        if (req.method !== "GET") return send(405, { error: "GET required" });
        const [file, mime] = assets[route];
        res.writeHead(200, { "Content-Type": mime });
        res.end(fs.readFileSync(new URL(`../src/recording/${file}`, import.meta.url)));
        return;
      }
      if (!["/session", "/reset", "/turn"].includes(route ?? "")) return send(404, { error: "Not found" });
      if (req.method !== "POST") return send(405, { error: "POST required" });
      if (req.headers.origin !== origin || (req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "same-origin")) return send(403, { error: "Same-origin request required" });
      if (req.headers["content-type"]?.split(";")[0] !== "application/json") return send(415, { error: "JSON required" });
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 4096) { send(413, { error: "Request too large (4096 bytes maximum)" }); return; }
        chunks.push(chunk);
      }
      let body: Record<string, unknown>;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return send(400, { error: "Invalid JSON" }); }
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(k => route === "/turn" ? k !== "message" : true)) return send(400, { error: "Unsupported request fields" });
      let id = req.headers.cookie?.match(/(?:^|;\s*)pm_demo=([a-f0-9]{48})(?:;|$)/)?.[1];
      if (route === "/reset" || (route === "/session" && (!id || !demos.has(id)))) {
        if (demos.size >= 64) return send(429, { error: "Session limit reached. Restart the launcher for a new recording." });
        id = randomBytes(24).toString("hex");
        demos.set(id, await freshDemo());
        res.setHeader("Set-Cookie", `pm_demo=${id}; HttpOnly; SameSite=Strict; Path=/`);
      }
      const demo = id ? demos.get(id) : undefined;
      if (!demo) return send(409, { error: "Session expired. Reload to begin a fresh fictional demo." });
      if (route === "/turn") {
        if (typeof body.message !== "string" || !body.message.trim() || body.message.length > 1200) return send(400, { error: "Enter 1–1200 characters" });
        const message = body.message.trim();
        // This host exposes one fictional profile only. Intake may name other exams,
        // but only the local fixture/notes can produce supported research or quizzes.
        const result = await converse(demo.env, profile, message);
        demo.messages.push({ role: "you", text: message }, { role: "mentor", text: result.reply });
      }
      const state = await view(demo);
      // Fictional evidence only; no cookies, credentials or provider settings.
      fs.writeFileSync(path.join(demo.root, "recording-state.json"), JSON.stringify(state, null, 2));
      fs.writeFileSync(path.join(demo.root, "transcript.txt"), demo.messages.map(m => `${m.role}> ${m.text}`).join("\n\n"));
      send(200, state);
    }).catch(() => {
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Local turn failed. Your scratch session is retained; retry or begin a fresh fictional demo." }));
    });
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const server = recordingServer();
  server.on("error", (error: NodeJS.ErrnoException) => { console.error(`Loopback server unavailable (${error.code ?? "unknown"}); no public binding attempted.`); process.exitCode = 1; });
  server.listen(4317, "127.0.0.1", () => {
    console.log("Personalised Mentor: http://127.0.0.1:4317");
    console.log("Local prototype | fictional data | rule-based/offline. Simulated study date: 2026-10-23.");
    console.log("Ctrl+C to stop. Each fresh demo uses a new OS temporary scratch directory.");
  });
}
