// Web ResearchSource: find the exam authority's official site and read it.
//
// Discovery: Wikidata's public read-only API (no key) is asked ONE thing, the
// exam name the student typed. It returns entities with an "official website"
// claim for the exam or its organizer. That is a third-party, community-edited
// pointer, so it only nominates a domain; nothing from it is called verified.
// Missing direct pointers: one bounded search (8 results, no continuation) for
// instances/editions of one exact exam, then their P664/P137 authorities.
// Indirect candidates require an official statement of responsibility. Discovery
// uses at most 6 API requests, 16 authorities, and no recursive traversal.
// Verification: the nominated site must be fetched, and its text must name the
// exam. Facts come only from pages on that domain and carry the exact URL,
// retrieval time, whether the exam year appears, and the quoted evidence.
//
// Never sent out: student identity, marks, messages, memory, goal text. The
// only outbound query is the exam name. Page text is data: it is stripped to
// text and matched with fixed patterns; no instruction in a page is acted on.
// Bounded: HTTPS only, public hosts only (resolved address pinned for the
// connection; redirects re-checked the same way), robots.txt obeyed,
// <= MAX_PAGES pages per exam, size and time caps, a pause between requests,
// and a stop on 401/403/429/5xx or a bot challenge.

import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import tls from "node:tls";
import type { ExamCandidate, ExamFact, ResearchSource, SourceRef, StudentGoal } from "./examContext.ts";

export const USER_AGENT = "HardMentorResearch/0.1 (read-only student study agent; fetches public exam pages)";
const MAX_PAGES = 4;
const MAX_BYTES = 400_000;
const TIMEOUT_MS = 8_000;
const PAUSE_MS = 400;
const MAX_REDIRECTS = 3;

export interface PinnedFetchArgs {
  url: URL;
  /** validated address this request will connect to (never re-resolved) */
  ip: string;
  accept: string;
  signal: AbortSignal;
}

export interface WebResearchOptions {
  fetchImpl?: typeof fetch;
  /** resolves a hostname to addresses; injectable for tests */
  lookup?: (host: string) => Promise<string[]>;
  /** test hook: HTTPS request to a pinned IP; production uses node:https */
  pinnedFetch?: (args: PinnedFetchArgs) => Promise<Response>;
  now?: () => string;
  pauseMs?: number;
  /** master switch for ALL outbound research traffic; default OFF unless HM_LIVE_RESEARCH=1 */
  enabled?: boolean;
}

export const LIVE_RESEARCH_DISABLED = "Live research is disabled";
export const liveResearchEnabled = (opts: { enabled?: boolean } = {}): boolean => opts.enabled ?? process.env.HM_LIVE_RESEARCH === "1";

export type FetchOutcome = { ok: true; url: string; contentType: string; text: string; truncated: boolean } | { ok: false; url: string; reason: string };

const lower = (s: string) => s.toLowerCase();
const norm = (s: string) => lower(s).replace(/[^a-z0-9]+/g, " ").trim();

const PRIVATE = new net.BlockList();
for (const [n, p] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3]] as const) PRIVATE.addSubnet(n, p, "ipv4");
for (const [n, p] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8], ["64:ff9b::", 96], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20], ["::", 96]] as const) PRIVATE.addSubnet(n, p, "ipv6");

/** true for loopback, private, link-local, multicast, reserved and every IPv6 form that embeds an IPv4 (mapped, NAT64, 6to4); unparseable counts as private */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return PRIVATE.check(ip, "ipv4");
  if (net.isIPv6(ip)) return PRIVATE.check(ip, "ipv6");
  return true;
}

function incomingToFetchResponse(res: IncomingMessage): Response {
  const headers = new Headers();
  for (const [k, v] of Object.entries(res.headers)) {
    if (v === undefined) continue;
    if (k === "set-cookie" && Array.isArray(v)) {
      for (const c of v) headers.append("set-cookie", c);
    } else {
      headers.set(k, Array.isArray(v) ? v.join(", ") : v);
    }
  }
  const status = res.statusCode ?? 0;
  const body = status === 204 || status === 205 || status === 304 ? null : (Readable.toWeb(res) as BodyInit);
  return new Response(body, { status, headers });
}

/** HTTPS GET to a previously validated IP, with SNI/Host/cert identity of the original hostname. */
export function pinnedHttpsFetch(args: PinnedFetchArgs): Promise<Response> {
  const { url: u, ip, accept, signal } = args;
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: ip,
        servername: u.hostname,
        port: 443,
        method: "GET",
        path: `${u.pathname}${u.search}`,
        setHost: false,
        headers: { Host: u.hostname, "user-agent": USER_AGENT, accept },
        timeout: TIMEOUT_MS,
        rejectUnauthorized: true,
        checkServerIdentity: (_host, cert) => tls.checkServerIdentity(u.hostname, cert),
        family: net.isIPv6(ip) ? 6 : 4,
      },
      (incoming) => {
        try {
          resolve(incomingToFetchResponse(incoming));
        } catch (e) {
          reject(e);
        }
      },
    );
    const abort = () => {
      req.destroy();
      reject(Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" }));
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    req.on("timeout", () => {
      req.destroy();
      reject(Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" }));
    });
    req.on("error", reject);
    req.end();
  });
}

/** Fetcher with every bound in the header comment. One instance per research run. */
export function boundedFetcher(opts: WebResearchOptions = {}) {
  const f = opts.fetchImpl;
  const lookup = opts.lookup ?? (async (h: string) => (await dns.lookup(h, { all: true })).map((a) => a.address));
  const pause = opts.pauseMs ?? PAUSE_MS;
  let blocked: string | null = null;
  const blockedHosts = new Map<string, number>(); // host -> blocked until (ms); a restricted host is left alone for 10 minutes
  let last = 0;
  const robots = new Map<string, string[] | null | { stop: string }>();

  function urlPolicy(url: URL): string | null {
    if (url.protocol !== "https:") return "not https";
    if (url.username || url.password) return "URL carries credentials";
    if (url.port && url.port !== "443") return "non-standard port";
    const host = url.hostname;
    if (net.isIP(host)) return "IP address host";
    if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".")) return "private or internal host name";
    return null;
  }

  async function pinPublic(host: string): Promise<{ ip: string } | { reason: string }> {
    try {
      const addrs = await lookup(host);
      if (!addrs.length || addrs.some(isPrivateAddress)) return { reason: "resolves to a private address" };
      return { ip: addrs[0]! };
    } catch {
      return { reason: "host did not resolve" };
    }
  }

  async function raw(url: string, accept: string, allowedHost?: (host: string) => boolean, beforeRequest?: (url: URL) => Promise<string | null>): Promise<FetchOutcome> {
    // single choke point: Wikidata, robots.txt, pages and redirects all pass here
    if (!liveResearchEnabled(opts)) return { ok: false, url, reason: LIVE_RESEARCH_DISABLED };
    if (blocked) return { ok: false, url, reason: `stopped earlier: ${blocked}` };
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let u: URL;
      try {
        u = new URL(current);
      } catch {
        return { ok: false, url: current, reason: "bad URL" };
      }
      if (allowedHost && !allowedHost(u.hostname)) return { ok: false, url: current, reason: "refused: redirect off the official domain" };
      const bad = urlPolicy(u);
      if (bad) return { ok: false, url: current, reason: `refused: ${bad}` };
      const denied = await beforeRequest?.(u);
      if (denied) return { ok: false, url: current, reason: denied };
      const pin = await pinPublic(u.hostname);
      if ("reason" in pin) return { ok: false, url: current, reason: `refused: ${pin.reason}` };
      if ((blockedHosts.get(u.hostname) ?? 0) > Date.now()) return { ok: false, url: current, reason: `stopped earlier: ${u.hostname} restricted access` };
      const wait = last + pause - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      let res: Response;
      try {
        const signal = AbortSignal.timeout(TIMEOUT_MS);
        const doPinned = opts.pinnedFetch ?? pinnedHttpsFetch;
        res = f
          ? await f(u, { redirect: "manual", signal, headers: { "user-agent": USER_AGENT, accept } })
          : await doPinned({ url: u, ip: pin.ip, accept, signal });
      } catch (e) {
        const cause = (e as { cause?: { code?: string } }).cause?.code;
        return { ok: false, url: current, reason: `request failed: ${(e as Error).name}${cause ? ` (${cause})` : ""}` };
      }
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return { ok: false, url: current, reason: `redirect without location (${res.status})` };
        try {
          current = new URL(loc, u).toString();
        } catch {
          return { ok: false, url: current, reason: "bad redirect location" };
        }
        continue;
      }
      if ([401, 403, 429, 503].includes(res.status) || res.status >= 500) {
        blocked = `${new URL(current).hostname} answered ${res.status}`;
        blockedHosts.set(new URL(current).hostname, Date.now() + 600_000);
        return { ok: false, url: current, reason: `stopped: ${res.status} (access restricted or throttled)` };
      }
      if (!res.ok) return { ok: false, url: current, reason: `HTTP ${res.status}` };
      const contentType = res.headers.get("content-type") ?? "";
      if (!(accept.startsWith("application/json") ? /json/i : /text\/(html|plain)|xhtml/i).test(contentType)) return { ok: false, url: current, reason: `not text/html (${contentType || "no type"})` };
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > MAX_BYTES * 4) return { ok: false, url: current, reason: "response too large" };
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      let truncated = false;
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          chunks.push(value);
          if (size >= MAX_BYTES) {
            truncated = true;
            await reader.cancel();
            break;
          }
        }
      }
      const text = new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks)).slice(0, MAX_BYTES);
      if (/cf-chl|just a moment\.\.\.|attention required|captcha|are you a robot|access denied/i.test(text.slice(0, 6000)) && text.length < 60_000) {
        blocked = `${u.hostname} served a challenge page`;
        blockedHosts.set(u.hostname, Date.now() + 600_000);
        return { ok: false, url: current, reason: "stopped: bot challenge page" };
      }
      return { ok: true, url: current, contentType, text, truncated };
    }
    return { ok: false, url: current, reason: "too many redirects" };
  }

  async function allowedByRobots(url: string, allowedHost: (host: string) => boolean): Promise<boolean | { stop: string }> {
    const u = new URL(url);
    if (!robots.has(u.origin)) {
      const r = await raw(`${u.origin}/robots.txt`, "text/plain", allowedHost);
      if (!r.ok && /^not text/.test(r.reason)) r.reason = `stopped: robots.txt unreadable (${r.reason})`;
      if (!r.ok) {
        robots.set(u.origin, /^HTTP (404|410)$/.test(r.reason) ? null : { stop: `stopped: robots.txt unavailable (${r.reason})` });
      } else if (r.truncated) {
        robots.set(u.origin, { stop: "stopped: robots.txt truncated; permissions unknown" });
      } else {
        const rules: string[] = [];
        let agents: string[] = [];
        let inRules = false;
        for (const line of r.text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
          const m = line.replace(/#.*/, "").match(/^\s*([a-z-]+)\s*:\s*(.*?)\s*$/i);
          if (!m) continue;
          const [k, v] = [lower(m[1]), m[2]];
          if (k === "user-agent") {
            if (inRules) agents = [];
            inRules = false;
            agents.push(lower(v));
          } else if (k === "disallow" || k === "allow") {
            inRules = true;
            const applies = agents.some((a) => a === "*" || lower(USER_AGENT).includes(a));
            if (applies && k === "disallow" && v) rules.push(v);
          }
        }
        robots.set(u.origin, rules);
      }
    }
    const rules = robots.get(u.origin);
    if (!rules) return true;
    if ("stop" in rules) return rules;
    const path = u.pathname + u.search;
    const dec = (x: string) => {
      try {
        return decodeURIComponent(x);
      } catch {
        return x;
      }
    };
    const target = dec(path);
    return !rules.some((p) => {
      const anchored = p.endsWith("$");
      const pat = dec(anchored ? p.slice(0, -1) : p);
      const re = new RegExp(`^${pat.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}${anchored ? "$" : ""}`);
      return re.test(target);
    });
  }

  return {
    get blocked() {
      return blocked;
    },
    raw,
    async page(url: string): Promise<FetchOutcome> {
      const initialHost = new URL(url).hostname;
      // Keep redirects on the exact host: a sibling host has separate robots
      // permissions, even if it shares an authority domain.
      const allowedHost = (host: string) => host === initialHost;
      const ok = await allowedByRobots(url, allowedHost);
      if (typeof ok === "object") return { ok: false, url, reason: ok.stop };
      if (!ok) return { ok: false, url, reason: "robots.txt disallows this page" };
      return raw(url, "text/html,text/plain", allowedHost, async (u) => {
        const permitted = await allowedByRobots(u.toString(), allowedHost);
        return typeof permitted === "object" ? permitted.stop : permitted ? null : "robots.txt disallows this page";
      });
    },
  };
}

// ---------- page text ----------

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|template|title)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|br|section|article|td)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8211;|&ndash;/g, "-")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

export function pageTitle(html: string): string {
  return htmlToText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ");
}

/** same-host links worth reading: the exam year, or schedule/syllabus words, in the URL or link text */
export function relevantLinks(html: string, base: string, year: string | null, names: string[] = []): string[] {
  const baseUrl = new URL(base);
  const scored = new Map<string, number>();
  for (const m of html.matchAll(/<a\s[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let u: URL;
    try {
      u = new URL(m[1], baseUrl);
    } catch {
      continue;
    }
    if (u.protocol !== "https:" || u.hostname !== baseUrl.hostname || /\.(pdf|docx?|xlsx?|zip|jpe?g|png|mp4)$/i.test(u.pathname)) continue;
    const label = norm(htmlToText(m[2]));
    const hay = `${norm(u.pathname)} ${label}`;
    let score = 0;
    if (year && hay.includes(year)) score += 3;
    if (names.some((n) => n.length >= 3 && hay.includes(norm(n)))) score += 1;
    if (/\b(schedule|date sheet|datesheet|exam date|important dates|syllabus|information bulletin|exam pattern|notice)\b/.test(hay)) score += 2;
    if (/\b(login|register|apply|result|admit|contact|gallery|tender|rti|careers?)\b/.test(hay)) score -= 3;
    if (score > 0) scored.set(u.toString().split("#")[0], Math.max(score, scored.get(u.toString()) ?? 0));
  }
  return [...scored.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u);
}

const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const MONTH_INDEX = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DATE_RE = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s,.-]+(${MONTHS})[a-z]*\\.?[\\s,.-]+(20\\d\\d)\\b`, "gi");
const EXAM_DAY_CUE = /\b(will\s+be\s+(?:held|conducted)|is\s+(?:scheduled|to\s+be\s+(?:held|conducted))|(?:held|conducted)\s+on|date\s+of\s+(?:the\s+)?(?:exam(?:ination)?|test)|exam(?:ination)?\s+date|exams?\s+(?:starts?|begins?|commence[sd]?))\b/i;
const INSTRUCTION_LIKE = /\b(ignore|system\s*:|instruction|you\s+must|tell\s+the|fetch|assistant|prompt)\b/i;
const NOT_EXAM_DAY = /\b(registration|apply|application|last\s+date|correction|admit\s+card|result|answer\s+key|fee|city\s+intimation|declared|released|issued|notice\s+dated|dated)\b/i;

const DATE_US_RE = new RegExp(`\\b(${MONTHS})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d\\d)\\b`, "gi");
const iso = (y: string, mon: string, d: string): string | null => {
  const m = MONTH_INDEX.indexOf(lower(mon).slice(0, 3)) + 1;
  const day = Number(d);
  if (m < 1 || day < 1 || day > 31) return null;
  const value = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value ? value : null;
};
export function parseDates(sentence: string): string[] {
  const out = new Set<string>();
  for (const m of sentence.matchAll(DATE_RE)) {
    const d = iso(m[3], m[2], m[1]);
    if (d) out.add(d);
  }
  for (const m of sentence.matchAll(DATE_US_RE)) {
    const d = iso(m[3], m[1], m[2]);
    if (d) out.add(d);
  }
  return [...out];
}

const DOUBTFUL = /\b(not|no|never|postponed|preponed|rescheduled|cancel(?:l?ed)?|deferred|tentative(?:ly)?|expected|likely|may|might|could|proposed|probable|subject\s+to|stands?)\b/i;
const RANGE = new RegExp(`\\d{1,2}(?:st|nd|rd|th)?\\s*(?:to|-|\u2013|and|till|until|through)\\s*(?:\\d{1,2}(?:st|nd|rd|th)?\\s*(?:${MONTHS})|(?:${MONTHS})[a-z]*\\s*\\d)|\\b(?:from|between)\\b`, "i");

/** the one exam date a sentence states plainly, or null when it is negated, doubtful, a range, or has more than one date-like token */
export function plainExamDate(sentence: string): string | null {
  if (DOUBTFUL.test(sentence) || RANGE.test(sentence)) return null;
  const ds = parseDates(sentence);
  const tokens = (sentence.match(DATE_RE)?.length ?? 0) + (sentence.match(DATE_US_RE)?.length ?? 0);
  return ds.length === 1 && tokens === 1 ? ds[0] : null;
}

function sentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 20 && s.length <= 400);
}

/** a page counts as "about this exam" only if its text names the exam (full name or a distinct token like "jee main") */
const QUALIFIER = new Set(["pg", "ug", "advanced", "mock", "junior", "ss", "mds", "ii", "paper"]);
export function namesExam(text: string, names: string[]): boolean {
  const t = ` ${norm(text)} `;
  return names.some((n) => {
    const q = norm(n);
    if (q.length < 3) return false;
    let i = t.indexOf(` ${q} `);
    while (i >= 0) {
      const next = t.slice(i + q.length + 2).split(" ")[0];
      if (!QUALIFIER.has(next)) return true;
      i = t.indexOf(` ${q} `, i + 1);
    }
    return false;
  });
}

// ---------- discovery (Wikidata) ----------

interface Entity {
  id: string;
  label: string;
  aliases: string[];
  description: string;
  site: string | null;
  organizerSite: string | null;
  organizerLabel: string | null;
  countries: string[];
  evidence?: string;
  indirect?: boolean;
}

type Claims = Record<string, { mainsnak?: { datavalue?: { value?: unknown } } }[]>;
/** current values only: deprecated-rank statements and statements with an end time (P582) are dropped; preferred rank first */
const claimValues = (claims: Claims, p: string): unknown[] =>
  (claims[p] ?? [])
    .filter((c) => (c as { rank?: string }).rank !== "deprecated" && !(c as { qualifiers?: Record<string, unknown> }).qualifiers?.P582)
    .sort((a, b) => Number((b as { rank?: string }).rank === "preferred") - Number((a as { rank?: string }).rank === "preferred"))
    .map((c) => c.mainsnak?.datavalue?.value)
    .filter((v) => v !== undefined);
const claimIds = (claims: Claims, p: string): string[] => claimValues(claims, p).map((v) => (v as { id?: string }).id).filter((x): x is string => typeof x === "string" && /^Q[1-9][0-9]*$/.test(x));
const WD = "https://www.wikidata.org/w/api.php";

async function wd(fetcher: ReturnType<typeof boundedFetcher>, params: Record<string, string>): Promise<any | null> {
  if ((fetcher as { lastFailure?: string }).lastFailure) return null;
  const r = await fetcher.raw(`${WD}?${new URLSearchParams({ format: "json", ...params })}`, "application/json");
  if (!r.ok) {
    (fetcher as { lastFailure?: string }).lastFailure = r.reason;
    return null;
  }
  try {
    if (r.truncated) throw new Error("truncated discovery response");
    const data = JSON.parse(r.text);
    if (data.error) throw new Error("discovery API error");
    return data;
  } catch {
    (fetcher as { lastFailure?: string }).lastFailure = "invalid discovery JSON";
    return null;
  }
}

export async function discoverEntities(fetcher: ReturnType<typeof boundedFetcher>, examName: string, country: string): Promise<{ entities: Entity[]; note: string }> {
  const search = await wd(fetcher, { action: "wbsearchentities", search: examName.slice(0, 80), language: "en", type: "item", limit: "8" });
  const hits: { id: string }[] = Array.isArray(search?.search) ? search.search.filter((h: { id?: unknown }) => typeof h?.id === "string" && /^Q[1-9][0-9]*$/.test(h.id)).slice(0, 8) : [];
  if (!search) return { entities: [], note: `discovery service unreachable (${(fetcher as { lastFailure?: string }).lastFailure ?? "no response"})` };
  if (!hits.length) return { entities: [], note: "no entity found" };
  const got = await wd(fetcher, { action: "wbgetentities", ids: hits.map((h) => h.id).join("|"), props: "claims|labels|aliases|descriptions", languages: "en" });
  if (!got) return { entities: [], note: `discovery service unreachable (${(fetcher as { lastFailure?: string }).lastFailure ?? "no response"})` };
  const raws: Record<string, any> = got?.entities ?? {};
  // One fallback search for ONE matching exam, never a recursive graph walk.
  // P179 (series) / P31 (instance of) must point back to the exact exam ID.
  const matching = hits.filter(h => {
    const e = raws[h.id];
    return e && [e.labels?.en?.value, ...(e.aliases?.en ?? []).map((a: any) => a.value)]
      .some(n => typeof n === "string" && norm(n) === norm(examName));
  });
  const editions: Record<string, any[]> = {};
  if (matching.length === 1) {
    const id = matching[0].id;
    const claims = raws[id].claims ?? {};
    if (!claimValues(claims, "P856").length && !claimIds(claims, "P664").length && !claimIds(claims, "P137").length) {
      const related = await wd(fetcher, { action: "query", list: "search", srsearch: `haswbstatement:P179=${id} OR haswbstatement:P31=${id}`, srnamespace: "0", srlimit: "8" });
      if (related?.continue || (related?.query?.searchinfo?.totalhits ?? 0) > 8) return { entities: [], note: "edition discovery exceeds eight results; authority remains ambiguous" };
      const ids = (related?.query?.search ?? []).map((h: any) => h.title).filter((id: unknown): id is string => typeof id === "string" && /^Q[1-9][0-9]*$/.test(id)).slice(0, 8);
      if (ids.length) {
        const details = await wd(fetcher, { action: "wbgetentities", ids: ids.join("|"), props: "claims|labels", languages: "en" });
        editions[id] = ids.flatMap((eid: string) => {
          const e = details?.entities?.[eid];
          const relation = e && ["P179", "P31"].find(p => claimIds(e.claims ?? {}, p).includes(id));
          return relation ? [{ ...e, id: eid, relation }] : [];
        });
      }
    }
  }
  const orgIds = new Set<string>();
  const ctryIds = new Set<string>();
  for (const e of [...Object.values(raws), ...Object.values(editions).flat()]) {
    for (const id of [...claimIds(e.claims ?? {}, "P664"), ...claimIds(e.claims ?? {}, "P137")]) orgIds.add(id);
    for (const id of claimIds(e.claims ?? {}, "P17")) ctryIds.add(id);
  }
  if (orgIds.size > 16 || ctryIds.size > 16) return { entities: [], note: "authority discovery exceeds bounded entity limit; no authority selected" };
  const orgs = orgIds.size ? ((await wd(fetcher, { action: "wbgetentities", ids: [...orgIds].join("|"), props: "claims|labels", languages: "en" }))?.entities ?? {}) : {};
  const ctry = ctryIds.size ? ((await wd(fetcher, { action: "wbgetentities", ids: [...ctryIds].join("|"), props: "labels|aliases", languages: "en" }))?.entities ?? {}) : {};
  const failure = (fetcher as { lastFailure?: string }).lastFailure;
  if (failure) return { entities: [], note: `discovery incomplete (${failure}); no authority selected` };
  const wantCountry = norm(country);
  const out: Entity[] = [];
  const siteOf = (c: Claims) => (claimValues(c, "P856").find(v => typeof v === "string") as string | undefined) ?? null;
  for (const h of hits) {
    const e = raws[h.id];
    if (!e) continue;
    const claims: Claims = e.claims ?? {};
    const countries = claimIds(claims, "P17").flatMap((id) => [ctry[id]?.labels?.en?.value, ...(ctry[id]?.aliases?.en ?? []).map((a: { value: string }) => a.value)]).filter(Boolean) as string[];
    if (countries.length && !countries.some((c) => norm(c) === wantCountry)) continue;
    const links = [e, ...(editions[h.id] ?? [])].flatMap(node =>
      ["P664", "P137"].flatMap(p => claimIds(node.claims ?? {}, p).map(org => ({ org, node: node === e ? h.id : node.id, relation: node.relation, p }))));
    const unique = [...new Map(links.map(l => [l.org, l])).values()];
    // Each authority gets its own candidate. Never silently pick the first claim.
    for (const link of unique.length ? unique : [null]) {
      out.push({
        id: unique.length > 1 ? `${h.id}:${link!.org}` : h.id,
        label: e.labels?.en?.value ?? h.id,
        aliases: (e.aliases?.en ?? []).map((a: { value: string }) => a.value),
        description: e.descriptions?.en?.value ?? "",
        site: siteOf(claims),
        organizerSite: link ? siteOf(orgs[link.org]?.claims ?? {}) : null,
        organizerLabel: link ? (orgs[link.org]?.labels?.en?.value ?? null) : null,
        countries,
        indirect: !!link && link.node !== h.id,
        evidence: link ? `${h.id}${link.node !== h.id ? ` <- ${link.relation} - ${link.node}` : ""} - ${link.p} -> ${link.org} - P856 -> ${siteOf(orgs[link.org]?.claims ?? {})}` : `${h.id} - P856 -> ${siteOf(claims)}`,
      });
    }
  }
  const usable = out.filter((e) => e.site || e.organizerSite || e.organizerLabel);
  return { entities: usable, note: !out.length ? `no exam entity in ${country}` : !usable.length ? "found matching exam entries but no current website through direct or bounded instance/edition authority relationships" : "" };
}

const GRADE_RE = /\b(?:class|grade|standard|std)\s+(?:1[0-2]|[1-9])\b/gi;
/** the only text that may leave: a short name of letters, spaces and a few punctuation marks. Numbers allowed only as grade markers (class/grade/standard/std 1-12); no long sentences. */
export function looksLikeExamName(q: string): boolean {
  if (!/^[\p{L}][\p{L}0-9\s()&.'/-]{1,58}$/u.test(q)) return false;
  if (q.split(/\s+/).length > 6) return false;
  // A grade marker does not turn surrounding prose into an exam name.
  // Digit-bearing inputs use a deliberately narrow label grammar: an optional
  // board acronym, one grade marker and optional exam-label words.
  if (/\d/.test(q) && !/^(?:[A-Z]{2,12} )?(?:class|grade|standard|std) (?:1[0-2]|[1-9])(?: (?:board )?(?:exam|examination))?$/i.test(q)) return false;
  if (/\b(?:i|am|my|me|we|our|you|your|he|she|his|her|student|studying|studies|studied|preparing|taking|enrolled|live|lives|email|address|born|roll|marks|scored|phone|name)\b/i.test(q)) return false;
  if (/\d/.test(q) && !/^(?:class|grade|standard|std)\b/i.test(q) && !/^[A-Z]{2,12} /.test(q)) return false;
  if (/\d/.test(q)) {
    const withoutGrades = q.replace(GRADE_RE, "");
    if (/\d/.test(withoutGrades)) return false;
  }
  return true;
}

function hostOf(u: string | null): string | null {
  try {
    return u ? new URL(u).hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Independent of Wikidata: a host counts as an exam authority's domain only if it sits under a
 * government or education suffix (gov, gov.xx, nic.in, ac.xx, edu, edu.xx, gouv.fr, go.jp, ...).
 * The registrable name is the label right above that suffix, so `cbse.gov.in.evil.com`,
 * `evilgov.in` and `someone.github.io` are not trusted. A body on a plain .org/.com site
 * (for example cisce.org) is therefore NOT treated as verified: nothing is read from it.
 */
const TRUSTED_SUFFIX = /\.((?:gov|nic|ac|edu|res|go|gouv|govt|gob)\.[a-z]{2}|gov|edu|mil)$/;
export function baseDomain(host: string): string {
  const h = host.toLowerCase();
  const m = h.match(TRUSTED_SUFFIX);
  if (!m) return "";
  const rest = h.slice(0, h.length - m[0].length).split(".");
  return `${rest[rest.length - 1]}${m[0]}`;
}
export const isTrustedAuthorityHost = (host: string): boolean => baseDomain(host) !== "";

export function examYear(goal: StudentGoal): string | null {
  const m = goal.exam.match(/\b(20\d\d)\b/);
  return m?.[1] ?? goal.statedExamDate?.slice(0, 4) ?? null;
}

const ABBREV_STOP = new Set(["exam", "examination", "test", "of", "the", "for", "in", "and", "national", "class", "board"]);

function nameVariants(e: Entity, typed: string): string[] {
  const nameOnly = typed.replace(/\b20\d\d\b/g, "").trim();
  return [...new Set([e.label, ...e.aliases, nameOnly].filter((n) => n && n.length >= 3))];
}

function distinctTokens(e: Entity, all: Entity[]): string[] {
  const own = norm(`${e.label} ${e.aliases.join(" ")}`).split(" ").filter((w) => w.length >= 2 && !ABBREV_STOP.has(w));
  const others = new Set(all.filter((x) => x !== e).flatMap((x) => norm(`${x.label} ${x.aliases.join(" ")}`).split(" ")));
  const uniq = own.filter((w) => !others.has(w));
  return uniq.length ? uniq : own.slice(0, 2);
}

export function webResearch(opts: WebResearchOptions = {}): ResearchSource & { lastLimits: () => string[] } {
  const limits: string[] = [];
  const now = opts.now ?? (() => new Date().toISOString());
  const byId = new Map<string, Entity>();
  const fetcher = boundedFetcher(opts);

  return {
    name: "web-research-wikidata-discovery",
    kind: "web",
    lastLimits: () => [...limits],
    async find(goal: StudentGoal): Promise<ExamCandidate[]> {
      limits.length = 0;
      if (!liveResearchEnabled(opts)) {
        limits.push(LIVE_RESEARCH_DISABLED);
        return [];
      }
      // Outbound query is the exam name only (year stripped); never goal text, date, marks or identity.
      const query = goal.exam.replace(/\b20\d\d\b/g, "").replace(/\s+/g, " ").trim();
      if (!looksLikeExamName(query)) {
        limits.push("the exam field does not look like just an exam name, so nothing was sent anywhere; give only the exam's name");
        return [];
      }
      // Grade labels describe the student's exam level, not the authority's
      // entity name. Search the named board once; never retry a failed service.
      const authorityQuery = query.replace(GRADE_RE, "").replace(/\b(?:board )?(?:exam|examination)\b/gi, "").trim();
      const hasGrade = /\d/.test(query);
      if (hasGrade && !authorityQuery) {
        limits.push("a grade alone does not identify an exam authority; include the board name");
        return [];
      }
      const discoveryQuery = hasGrade ? authorityQuery : query;
      const discovered = await discoverEntities(fetcher, discoveryQuery, goal.country);
      const note = discovered.note;
      // Authority searches must match the supplied board label or alias exactly.
      // Unrelated search hits cannot become a student's exam.
      const entities = discovered.entities.filter((e) => [e.label, ...e.aliases].some((n) => hasGrade
        ? norm(n) === norm(authorityQuery)
        : norm(n) === norm(query) || (` ${norm(n)} `).includes(` ${norm(query)} `)));
      if (discovered.entities.length && !entities.length) limits.push("discovery returned only unrelated names; no authority selected");
      if (note) limits.push(note);
      const exact = entities.filter((e) => [e.label, ...e.aliases].some((n) => norm(n) === norm(query)));
      const pick = exact.length === 1 ? exact : entities;
      return pick.map((e) => {
        byId.set(e.id, e);
        const domains = [hostOf(e.site), hostOf(e.organizerSite)].filter((h): h is string => !!h).map(baseDomain).filter(Boolean);
        const ref: SourceRef = {
          url: `https://www.wikidata.org/wiki/${e.id.split(":")[0]}`,
          publisher: "Wikidata (community-edited pointer, not an exam authority)",
          via: "web",
          retrievedAt: now(),
          publishedAt: null,
          note: `Community discovery candidate only; ${e.evidence}`,
        };
        return {
          id: e.id,
          name: hasGrade ? query : e.label,
          body: e.organizerLabel ?? "responsible body not named by the discovery source",
          country: goal.country,
          aliases: [],
          distinct: distinctTokens(e, pick),
          officialDomains: [...new Set(domains)],
          facts: e.organizerLabel ? [{ key: "conducting_body", value: e.organizerLabel, source: ref }] : [],
          corpora: [],
        };
      });
    },
    async deepen(c: ExamCandidate, goal: StudentGoal): Promise<{ facts: ExamFact[]; limits: string[]; pages: string[] }> {
      const e = byId.get(c.id);
      const mine: string[] = [];
      if (!e) return { facts: [], limits: ["internal: candidate not found"], pages: [] };
      const year = examYear(goal);
      const today = now().slice(0, 10);
      const names = nameVariants(e, goal.exam);
      const examLabel = goal.exam.replace(/\b20\d\d\b/g, "").replace(/\s+/g, " ").trim();
      // An authority homepage can confirm its own identity, but its dates must
      // explicitly name the requested grade-specific exam.
      const dateNames = /\d/.test(examLabel) ? [examLabel] : names;
      for (const u of [e.site, e.organizerSite]) {
        const h = hostOf(u);
        if (h && !isTrustedAuthorityHost(h)) mine.push(`${h} is nominated as official but is not a government or education domain, so I did not read it or treat it as official`);
      }
      const facts: ExamFact[] = [];
      const seen = new Set<string>();
      // A community pointer may use HTTP. Nominate its same-host HTTPS URL
      // before any connection; never request HTTP or fall back after failure.
      const queue = [e.site, e.organizerSite].flatMap((value) => {
        if (!value) return [];
        try {
          const u = new URL(value);
          if (!c.officialDomains.includes(baseDomain(u.hostname))) return [];
          if (u.protocol === "http:" && !u.port && !u.username && !u.password) {
            u.protocol = "https:";
            mine.push("discovery supplied an HTTP pointer; only its same-host HTTPS URL was nominated (no HTTP request or fallback)");
          }
          return [u.toString()];
        } catch { return []; }
      });
      let fetched = 0;
      const pages: string[] = [];
      let named = false;
      let examNamed = false;
      let relationshipEstablished = !e.indirect;
      const pending: ExamFact[] = [];
      while (queue.length && fetched < MAX_PAGES) {
        const url = new URL(queue.shift()!).toString();
        if (seen.has(url)) continue;
        seen.add(url);
        const host = hostOf(url);
        if (!host || !c.officialDomains.includes(baseDomain(host))) continue;
        const r = await fetcher.page(url);
        fetched++;
        if (!r.ok) {
          mine.push(`${url}: ${r.reason}`);
          if (/stopped|request failed|host did not resolve/.test(r.reason)) break;
          continue;
        }
        const finalHost = hostOf(r.url);
        if (!finalHost || !c.officialDomains.includes(baseDomain(finalHost))) {
          mine.push(`${url}: redirected off the official domain (${finalHost}), ignored`);
          continue;
        }
        const retrievedAt = now();
        pages.push(r.url);
        const isHtml = /html/i.test(r.contentType);
        const text = isHtml ? htmlToText(r.text) : r.text;
        const title = isHtml ? pageTitle(r.text) : "";
        const relationship = e.indirect ? sentences(text).find(s => namesExam(s, names)
          && !!e.organizerLabel && names.some(name => {
            const sentence = ` ${norm(s)} `;
            const body = norm(e.organizerLabel!);
            const exam = norm(name);
            // Direct grammatical responsibility, not mere co-occurrence.
            return ["conducts", "administers", "organizes", "organises", "operates"].some(verb =>
              sentence.includes(` ${body} ${verb} ${exam} `) || sentence.includes(` ${body} ${verb} the ${exam} `))
              || ["conducted", "administered", "organized", "organised", "operated"].some(verb =>
                sentence.includes(` ${exam} is ${verb} by ${body} `));
          })
          && !DOUBTFUL.test(s) && !INSTRUCTION_LIKE.test(s)) : undefined;
        if (relationship) relationshipEstablished = true;
        const aboutExam = namesExam(`${title}\n${text}`, names);
        const yearMatch = year ? sentences(text).some((s) => new RegExp(`\\b${year}\\b`).test(s) && namesExam(s, names)) : false;
        const ref: SourceRef = { url: r.url, publisher: finalHost, via: "web", retrievedAt, publishedAt: null, note: `discovery chain: ${e.evidence}; ${title.slice(0, 100) || "untitled page"}; exam named on page: ${aboutExam}; year ${year ?? "unknown"} appears in a sentence naming the exam: ${yearMatch}${r.truncated ? "; page truncated at size cap" : ""}` };
        if (relationship) pending.push({ key: "conducting_body", value: e.organizerLabel!, source: { url: r.url, publisher: finalHost, via: "web", retrievedAt, publishedAt: null, note: `discovery chain: ${e.evidence}; quoted: "${relationship}"` } });
        if (aboutExam && !named) {
          named = true;
          facts.push({ key: "official_site_confirmed", value: `${finalHost} names ${names[0]}${title ? ` (page title: "${title.slice(0, 100)}")` : ""}`, source: ref });
        }
        // A conducting-body portal may link to its exams without naming them
        // in visible prose. Follow only the existing bounded relevant links.
        if (isHtml) for (const l of relevantLinks(r.text, r.url, year, names).slice(0, 3)) if (!seen.has(l)) queue.push(l);
        if (!aboutExam) continue;
        const examEvidence = sentences(text).find((s) => namesExam(s, dateNames) && !INSTRUCTION_LIKE.test(s));
        if (examEvidence && !examNamed) {
          examNamed = true;
          facts.push({ key: "exam_named_on_official_site", value: examEvidence, source: { ...ref, note: `${ref.note}; quoted: "${examEvidence}"` } });
        }
        // Preserve exact official wording rather than inventing a syllabus or
        // converting quoted marks into unsupported planner weights.
        for (const [key, cue] of [["syllabus_excerpt", /\bsyllabus\b/i], ["exam_format_excerpt", /\b(?:examination scheme|exam(?:ination)? pattern|multiple.choice|duration)\b/i]] as const) {
          const quote = sentences(text).find(s => namesExam(s, dateNames) && cue.test(s) && !INSTRUCTION_LIKE.test(s));
          if (quote && !facts.some(f => f.key === key)) facts.push({ key, value: quote, source: { ...ref, note: `${ref.note}; quoted: "${quote}"; excerpt only, coverage unknown` } });
        }
        const cand = new Map<string, { date: string; sentence: string }>();
        for (const s of sentences(text)) {
          if (!EXAM_DAY_CUE.test(s) || NOT_EXAM_DAY.test(s)) continue;
          const d = plainExamDate(s);
          if (!d || (year && !d.startsWith(year)) || d <= today) continue;
          if (!namesExam(s, dateNames) || INSTRUCTION_LIKE.test(s)) continue;
          cand.set(d, { date: d, sentence: s });
        }
        for (const { date, sentence } of cand.values()) {
          facts.push({ key: "exam_date_candidate", value: date, source: { ...ref, note: `${ref.note}; quoted: "${sentence}"` } });
        }
      }
      if (e.indirect && !relationshipEstablished) {
        facts.length = 0;
        mine.push("instance/edition pointer remains a candidate: no fetched official statement established this body's responsibility for the exam; no facts verified");
      }
      if (relationshipEstablished) facts.push(...pending);
      if (!named) mine.push("no page on the nominated official domain could be read and matched to this exam");
      if (named && !examNamed) mine.push("authority identity confirmed only; the requested exam was not explicitly evidenced in page text");
      // One unambiguous exam date becomes exam_date; several distinct dates stay unknown.
      const dates = facts.filter((f) => f.key === "exam_date_candidate");
      const distinct = [...new Set(dates.map((d) => d.value))];
      const out: ExamFact[] = facts.filter((f) => f.key !== "exam_date_candidate");
      if (distinct.length === 1) out.push({ ...dates[0], key: "exam_date" });
      else if (distinct.length > 1) {
        mine.push(`${distinct.length} different exam dates appear on official pages (${distinct.join(", ")}); not choosing one`);
        out.push(...dates.map((d) => ({ ...d, key: "exam_date_candidate" })));
      } else if (named) mine.push(`no exam date for ${year ?? "an unspecified year"} found on the pages read`);
      limits.push(...mine);
      return { facts: out, limits: mine, pages };
    },
  };
}
