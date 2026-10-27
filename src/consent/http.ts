// Host-local development boundary. This module binds no socket and sends no
// email; a host supplies the authenticated identity and simulated service.
import { ConsentRequests } from "./requests.ts";
export interface ConsentActor { studentId: string; sessionBinding: string; role: "parent" | "student" }
export function consentHandler(opts: {
  requests: ConsentRequests;
  authenticate: (request: Request) => ConsentActor | null;
}): (request: Request) => Promise<Response> {
  const reply = (status: number, body: unknown) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
  return async request => {
    // Link previews/scanners can never grant consent.
    if (request.method !== "POST") return reply(405, { error: "Explicit POST required" });
    const actor = opts.authenticate(request);
    if (!actor) return reply(401, { error: "Authentication required" });
    if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return reply(415, { error: "JSON required" });
    const reader = request.body?.getReader();
    if (!reader) return reply(400, { error: "Invalid consent request" });
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    let body: any;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 4096) { await reader.cancel(); return reply(413, { error: "Request too large" }); }
        chunks.push(value);
      }
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!body || typeof body !== "object") throw Error();
      if (body.operation === "request" && typeof body.recipient === "string") {
        return reply(200, await opts.requests.request(actor.studentId, actor.sessionBinding, body.recipient));
      }
      if (body.operation === "verify" && actor.role === "parent" && typeof body.requestId === "string" && typeof body.token === "string" && typeof body.attestation === "string" && typeof body.attestationVersion === "string" && typeof body.noticeVersion === "string") {
        const receipt = opts.requests.verify({ ...body, studentId: actor.studentId, binding: actor.sessionBinding, method: request.method, confirmed: body.confirmed === true });
        return receipt ? reply(200, { receipt }) : reply(403, { error: "Consent not granted" });
      }
      if (body.operation === "withdraw") {
        opts.requests.withdraw(actor.studentId, request.headers.get("authorization") ?? "");
        return reply(200, { deleted: true });
      }
    } catch {
      // Do not echo body, token, recipient, sender errors or filesystem paths.
      return reply(400, { error: "Consent operation failed; storage remains locked unless an existing grant is valid" });
    }
    return reply(400, { error: "Invalid consent request" });
  };
}
