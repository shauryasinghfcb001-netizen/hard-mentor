// Zetaris-backed StudyDataSource. Same TopicState mapping as csvStudyData.
// Contract (observed in one real run; nothing else is assumed):
//   POST {base}/api/auth/login  {username,password} -> {idToken, refreshToken, orgId:int}
//   POST {base}/api/proxy/query/sql/start  {select,pageLimit}
//        headers: Authorization Bearer idToken, X-Org-ID, X-Request-ID
//        -> {records:[{col:"string"}], pageNumber, pageLimit, totalCount, totalPages, queryToken}
// Error shapes, queryToken pagination, column types, token expiry and table
// loading are unproven, so every unexpected outcome fails closed. There is no
// CSV fallback: a failure here must never be answered from a local file.
// Error messages include requested origin (host:port) and path plus HTTP status,
// but never carry credentials, response bodies, tokens, passwords, org id, or headers.

import { randomUUID } from "node:crypto";
import type { TopicState } from "../core/priority.ts";
import type { StudyDataSource, TopicQuery } from "./studyData.ts";

export interface ZetarisOptions {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
}

const TABLE_RE = /^[A-Za-z_][A-Za-z0-9_.]*$/;
const STUDENT_RE = /^[A-Za-z0-9_-]+$/;
const NUMBER_RE = /^(?:\d+\.?\d*|\.\d+)$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
// One student's topics fit comfortably; a larger result throws instead of truncating.
const PAGE_LIMIT = 500;
const TIMEOUT_MS = 15_000;

function unavailable(reason: string): Error {
  return new Error(`Zetaris unavailable: ${reason}`);
}

// Range matches csvStudyData: both columns must lie in 0..1 inclusive.
function ratio(raw: unknown): number {
  if (typeof raw !== "string" || !NUMBER_RE.test(raw.trim())) throw unavailable("invalid number in record");
  const n = Number(raw.trim());
  if (!(n >= 0 && n <= 1)) throw unavailable("invalid number in record");
  return n;
}

function text(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) throw unavailable("invalid text in record");
  return raw.trim();
}

export function zetarisStudyData(opts: ZetarisOptions = {}): StudyDataSource {
  const env = opts.env ?? process.env;
  const doFetch = opts.fetch ?? fetch;

  async function post(url: string, headers: Record<string, string>, body: unknown, what: string): Promise<unknown> {
    const u = new URL(url);
    const port = u.port || (u.protocol === "https:" ? "443" : "80");
    const target = `${u.hostname}:${port}${u.pathname}`;

    let res: Response;
    try {
      res = await doFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw unavailable(`${what} request failed (${target})`);
    }
    if (!res.ok) {
      if (what === "login" && res.status === 404) {
        throw unavailable(`login returned HTTP 404 (can indicate bad credentials on this platform) (${target})`);
      }
      throw unavailable(`${what} returned HTTP ${res.status} (${target})`);
    }
    try {
      return await res.json();
    } catch {
      throw unavailable(`${what} response was not JSON (HTTP ${res.status}) (${target})`);
    }
  }

  return {
    name: "zetaris",
    kind: "zetaris",
    async topicsFor(studentId): Promise<TopicQuery> {
      const base = env.HM_ZETARIS_URL;
      const user = env.HM_ZETARIS_USER;
      const password = env.HM_ZETARIS_PASSWORD;
      const table = env.HM_ZETARIS_TABLE;
      if (!base || !user || !password || !table) throw unavailable("not configured");
      if (!TABLE_RE.test(table)) throw unavailable("invalid table name");
      if (!STUDENT_RE.test(studentId)) throw unavailable("invalid student id");

      let origin: string;
      try {
        const u = new URL(base);
        if ((u.protocol !== "http:" && u.protocol !== "https:") || !LOCAL_HOSTS.has(u.hostname)) throw new Error();
        origin = u.origin;
      } catch {
        throw unavailable("URL must be a localhost http(s) URL");
      }

      const login = await post(`${origin}/api/auth/login`, {}, { username: user, password }, "login");
      const idToken = (login as { idToken?: unknown } | null)?.idToken;
      const orgId = (login as { orgId?: unknown } | null)?.orgId;
      if (typeof idToken !== "string" || !idToken || typeof orgId !== "number" || !Number.isInteger(orgId)) {
        throw unavailable("login response malformed");
      }

      const sql = `SELECT topic_id, subject, name, mastery, marks_weight FROM ${table} WHERE student_id = '${studentId}' ORDER BY topic_id`;
      const result = await post(
        `${origin}/api/proxy/query/sql/start`,
        { Authorization: `Bearer ${idToken}`, "X-Org-ID": String(orgId), "X-Request-ID": randomUUID() },
        { select: sql, pageLimit: PAGE_LIMIT },
        "query"
      );
      const { records, totalCount, totalPages } = (result ?? {}) as { records?: unknown; totalCount?: unknown; totalPages?: unknown };
      if (!Array.isArray(records)) throw unavailable("query response malformed");
      if (typeof totalCount !== "number" || typeof totalPages !== "number") throw unavailable("query response malformed");
      if (totalCount > records.length || totalPages > 1 || records.length > PAGE_LIMIT) throw unavailable("result truncated");
      if (records.length === 0) throw unavailable("no records");

      const rows: TopicState[] = records.map((rec, i) => {
        if (rec === null || typeof rec !== "object") throw unavailable("query response malformed");
        const r = rec as Record<string, unknown>;
        return {
          topicId: text(r.topic_id),
          subject: text(r.subject),
          name: text(r.name),
          mastery: ratio(r.mastery),
          marksWeight: ratio(r.marks_weight),
          // position in the result set, not a stored row id (none is proven)
          sourceRow: `zetaris:${table}#${i + 1}`,
        };
      });
      return { rows, source: `Zetaris table ${table}`, sql };
    },
  };
}
