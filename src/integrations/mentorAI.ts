// Adapter for the inspected Mentor AI netlify/lib/agent.mjs contract.
// Authenticated user IDs are mapped by the local host, never by browser context.
import { timingSafeEqual } from "node:crypto";
import { converse, type ConversationEnv, type StudentProfile } from "../agent/conversation.ts";
import { ConsentRequired } from "../consent/storageGate.ts";

export function mentorAIHandler(opts: {
  token: string;
  env: ConversationEnv;
  profiles: ReadonlyMap<string, StudentProfile>;
  /** Host-only opt-in to env.memoryFor; defaults OFF. This grants no storage access. */
  memory?: boolean;
}): (request: Request) => Promise<Response> {
  if (!opts.token || /[\r\n]/.test(opts.token)) throw new Error("Local agent authentication required");
  const json = (status: number, body: unknown) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
  return async request => {
    if (request.method !== "POST") return json(405, { error: "POST required" });
    const expected = Buffer.from(`Bearer ${opts.token}`);
    const actual = Buffer.from(request.headers.get("authorization") ?? "");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return json(401, { error: "Authentication required" });
    if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return json(415, { error: "JSON required" });
    // Bound bytes while streaming, rather than trusting Content-Length.
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    const reader = request.body?.getReader();
    if (!reader) return json(400, { error: "Invalid request" });
    let payload: any;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 30 * 1024) { await reader.cancel(); return json(413, { error: "Request too large" }); }
        chunks.push(value);
      }
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch { return json(400, { error: "Invalid request" }); }
    if (!payload || typeof payload.message !== "string" || !payload.message.trim() || payload.message.length > 1200 || typeof payload.userId !== "string" || !payload.context || typeof payload.context !== "object" || Array.isArray(payload.context)) return json(400, { error: "Invalid request" });
    const profile = opts.profiles.get(payload.userId);
    if (!profile) return json(200, { reply: "This account is not linked to a local study profile. Student storage remains locked.", action: null });
    if (payload.lang !== undefined && payload.lang !== "en") return json(200, { reply: "The local Hard Mentor integration currently supports English only.", action: null });
    try {
      // Browser readiness, memories, subjects and progress are untrusted. The
      // conversation loads actual source rows and the host-approved profile.
      // The upstream contract omits the memory toggle. Only explicit local host
      // configuration can enable the existing core memory provider; browser
      // context cannot grant consent or override storage/session memory gates.
      const turn = await converse(opts.env, profile, payload.message.trim(), { memory: opts.memory === true });
      const canOpen = Array.isArray(payload.allowedActions) && payload.allowedActions.includes("open_today") && !!turn.state?.draft;
      return json(200, {
        reply: turn.reply.slice(0, 4000),
        action: canOpen ? { type: "open_today", label: "View today's plan", reason: "Review the recommendation before starting." } : null,
      });
    } catch (e) {
      // A 200 with the explicit lock prevents Mentor AI's automatic Gemini
      // fallback from silently answering a consent-denied local request.
      if (e instanceof ConsentRequired) return json(200, { reply: e.message, action: null });
      return json(503, { error: "Local mentor unavailable" });
    }
  };
}
