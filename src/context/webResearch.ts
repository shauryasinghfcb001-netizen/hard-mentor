// Web ResearchSource: find the exam authority's official site and read it.
//
// Discovery: Wikidata's public read-only API (no key) is asked ONE thing, the
// exam name the student typed. It returns entities with an "official website"
// claim for the exam or its organizer. That is a third-party, community-edited
// pointer, so it only nominates a domain; nothing from it is called verified.
// Verification: the nominated site must be fetched, and its text must name the
// exam. Facts come only from pages on that domain and carry the exact URL,
// retrieval time, whether the exam year appears, and the quoted evidence.
//
// Never sent out: student identity, marks, messages, memory, goal text. The
// only outbound query is the exam name. Page text is data: it is stripped to
// text and matched with fixed patterns; no instruction in a page is acted on.
// Bounded: HTTPS only, public hosts only (DNS checked, redirects re-checked),
// robots.txt obeyed, <= MAX_PAGES pages per exam, size and time caps, a pause
// between requests, and a stop on 401/403/429/5xx or a bot challenge.

import dns from "node:dns/promises";
import net from "node:net";
import type { ExamCandidate, ExamFact, ResearchSource, SourceRef, StudentGoal } from "./examContext.ts";

export const USER_AGENT = "HardMentorResearch/0.1 (read-only student study agent; fetches public exam pages)";
const MAX_PAGES = 4;
const MAX_BYTES = 400_000;
const TIMEOUT_MS = 8_000;
const PAUSE_MS = 400;
const MAX_REDIRECTS = 3;

export interface WebResearchOptions {
  fetchImpl?: typeof fetch;
  /** resolves a hostname to addresses; injectable for tests */
  lookup?: (host: string) => Promise<string[]>;
  now?: () => string;
  pauseMs?: number;
}

export type FetchOutcome = { ok: true; url: string; contentType: string; text: string; truncated: boolean } | { ok: false; url: string; reason: string };

const lower = (s: string) => s.toLowerCase();
const norm = (s: string) => lower(s).replace(/[^a-z0-9]+/g, " ").trim();

const PRIVATE = new net.BlockList();
for (const [n, p] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3]] as const) PRIVATE.addSubnet(n, p, "ipv4");
for (const [n, p] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8], ["64:ff9b::", 96], ["2002::", 16], ["::", 96]] as const) PRIVATE.addSubnet(n, p, "ipv6");

/** true for loopback, private, link-local, multicast, reserved and every IPv6 form that embeds an IPv4 (mapped, NAT64, 6to4); unparseable counts as private */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return PRIVATE.check(ip, "ipv4");
  if (net.isIPv6(ip)) return PRIVATE.check(ip, "ipv6");
  return true;
}

/** Fetcher with every bound in the header comment. One instance per research run. */
export function boundedFetcher(opts: WebResearchOptions = {}) {
  const f = opts.fetchImpl ?? fetch;
  const lookup = opts.lookup ?? (async (h: string) => (await dns.lookup(h, { all: true })).map((a) => a.address));
  const pause = opts.pauseMs ?? PAUSE_MS;
  let blocked: string | null = null;
  const blockedHosts = new Map<string, number>(); // host -> blocked until (ms); a restricted host is left alone for 10 minutes
  let last = 0;
  const robots = new Map<string, string[] | null | { stop: string }>();

  async function publicHost(url: URL): Promise<string | null> {
    if (url.protocol !== "https:") return "not https";
    if (url.username || url.password) return "URL carries credentials";
    if (url.port && url.port !== "443") return "non-standard port";
    const host = url.hostname;
    if (net.isIP(host)) return "IP address host";
    if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".")) return "private or internal host name";
    try {
      const addrs = await lookup(host);
      if (!addrs.length || addrs.some(isPrivateAddress)) return "resolves to a private address";
    } catch {
      return "host did not resolve";
    }
    return null;
  }

  async function raw(url: string, accept: string): Promise<FetchOutcome> {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let u: URL;
      try {
        u = new URL(current);
      } catch {
        return { ok: false, url: current, reason: "bad URL" };
      }
      const bad = await publicHost(u);
      if (bad) return { ok: false, url: current, reason: `refused: ${bad}` };
      if ((blockedHosts.get(u.hostname) ?? 0) > Date.now()) return { ok: false, url: current, reason: `stopped earlier: ${u.hostname} restricted access` };
      const wait = last + pause - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      let res: Response;
      try {
        res = await f(u, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": USER_AGENT, accept } });
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

  async function allowedByRobots(url: string): Promise<boolean | { stop: string }> {
    const u = new URL(url);
    if (!robots.has(u.origin)) {
      const r = await raw(`${u.origin}/robots.txt`, "text/plain");
      if (!r.ok && /^not text/.test(r.reason)) r.reason = `stopped: robots.txt unreadable (${r.reason})`;
      if (!r.ok) {
        robots.set(u.origin, r.reason.startsWith("stopped") || r.reason.startsWith("refused") ? { stop: r.reason } : null);
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
      const ok = await allowedByRobots(url);
      if (typeof ok === "object") return { ok: false, url, reason: ok.stop };
      if (!ok) return { ok: false, url, reason: "robots.txt disallows this page" };
      return raw(url, "text/html,text/plain");
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
  return m > 0 && day >= 1 && day <= 31 ? `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}` : null;
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
}

type Claims = Record<string, { mainsnak?: { datavalue?: { value?: unknown } } }[]>;
/** current values only: deprecated-rank statements and statements with an end time (P582) are dropped; preferred rank first */
const claimValues = (claims: Claims, p: string): unknown[] =>
  (claims[p] ?? [])
    .filter((c) => (c as { rank?: string }).rank !== "deprecated" && !(c as { qualifiers?: Record<string, unknown> }).qualifiers?.P582)
    .sort((a, b) => Number((b as { rank?: string }).rank === "preferred") - Number((a as { rank?: string }).rank === "preferred"))
    .map((c) => c.mainsnak?.datavalue?.value)
    .filter((v) => v !== undefined);
const claimIds = (claims: Claims, p: string): string[] => claimValues(claims, p).map((v) => (v as { id?: string }).id).filter((x): x is string => !!x);
const WD = "https://www.wikidata.org/w/api.php";

async function wd(fetcher: ReturnType<typeof boundedFetcher>, params: Record<string, string>): Promise<any | null> {
  const r = await fetcher.raw(`${WD}?${new URLSearchParams({ format: "json", ...params })}`, "application/json");
  if (!r.ok) {
    (fetcher as { lastFailure?: string }).lastFailure = r.reason;
    return null;
  }
  try {
    return JSON.parse(r.text);
  } catch {
    return null;
  }
}

export async function discoverEntities(fetcher: ReturnType<typeof boundedFetcher>, examName: string, country: string): Promise<{ entities: Entity[]; note: string }> {
  const search = await wd(fetcher, { action: "wbsearchentities", search: examName.slice(0, 80), language: "en", type: "item", limit: "8" });
  const hits: { id: string }[] = Array.isArray(search?.search) ? search.search.filter((h: { id?: unknown }) => typeof h?.id === "string") : [];
  if (!search) return { entities: [], note: `discovery service unreachable (${(fetcher as { lastFailure?: string }).lastFailure ?? "no response"})` };
  if (!hits.length) return { entities: [], note: "no entity found" };
  const got = await wd(fetcher, { action: "wbgetentities", ids: hits.map((h) => h.id).join("|"), props: "claims|labels|aliases|descriptions", languages: "en" });
  const raws: Record<string, any> = got?.entities ?? {};
  const orgIds = new Set<string>();
  const ctryIds = new Set<string>();
  for (const e of Object.values(raws)) {
    for (const id of claimIds(e.claims ?? {}, "P664")) orgIds.add(id);
    for (const id of claimIds(e.claims ?? {}, "P17")) ctryIds.add(id);
  }
  const orgs = orgIds.size ? ((await wd(fetcher, { action: "wbgetentities", ids: [...orgIds].join("|"), props: "claims|labels", languages: "en" }))?.entities ?? {}) : {};
  const ctry = ctryIds.size ? ((await wd(fetcher, { action: "wbgetentities", ids: [...ctryIds].join("|"), props: "labels|aliases", languages: "en" }))?.entities ?? {}) : {};
  const wantCountry = norm(country);
  const out: Entity[] = [];
  for (const h of hits) {
    const e = raws[h.id];
    if (!e) continue;
    const claims: Claims = e.claims ?? {};
    const countries = claimIds(claims, "P17").flatMap((id) => [ctry[id]?.labels?.en?.value, ...(ctry[id]?.aliases?.en ?? []).map((a: { value: string }) => a.value)]).filter(Boolean) as string[];
    if (countries.length && !countries.some((c) => norm(c) === wantCountry)) continue;
    const org = claimIds(claims, "P664")[0];
    const siteOf = (c: Claims) => (claimValues(c, "P856")[0] as string | undefined) ?? null;
    out.push({
      id: h.id,
      label: e.labels?.en?.value ?? h.id,
      aliases: (e.aliases?.en ?? []).map((a: { value: string }) => a.value),
      description: e.descriptions?.en?.value ?? "",
      site: siteOf(claims),
      organizerSite: org ? siteOf(orgs[org]?.claims ?? {}) : null,
      organizerLabel: org ? (orgs[org]?.labels?.en?.value ?? null) : null,
      countries,
    });
  }
  const usable = out.filter((e) => e.site || e.organizerSite);
  return { entities: usable, note: !out.length ? `no exam entity in ${country}` : !usable.length ? "found matching exam entries but none lists a current official website" : "" };
}

/** the only text that may leave: a short name of letters, spaces and a few punctuation marks. No digits (a year is stripped before), no long sentences. */
export function looksLikeExamName(q: string): boolean {
  return /^[\p{L}][\p{L}\s()&.'/-]{1,58}$/u.test(q) && q.split(/\s+/).length <= 6;
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
      // Outbound query is the exam name only (year stripped); never goal text, date, marks or identity.
      const query = goal.exam.replace(/\b20\d\d\b/g, "").replace(/\s+/g, " ").trim();
      if (!looksLikeExamName(query)) {
        limits.push("the exam field does not look like just an exam name, so nothing was sent anywhere; give only the exam's name");
        return [];
      }
      const { entities, note } = await discoverEntities(fetcher, query, goal.country);
      if (note) limits.push(note);
      const exact = entities.filter((e) => [e.label, ...e.aliases].some((n) => norm(n) === norm(query)));
      const pick = exact.length === 1 ? exact : entities;
      return pick.map((e) => {
        byId.set(e.id, e);
        const domains = [hostOf(e.site), hostOf(e.organizerSite)].filter((h): h is string => !!h).map(baseDomain).filter(Boolean);
        const ref: SourceRef = {
          url: `https://www.wikidata.org/wiki/${e.id}`,
          publisher: "Wikidata (community-edited pointer, not an exam authority)",
          via: "web",
          retrievedAt: now(),
          publishedAt: null,
          note: `Wikidata lists ${e.site ?? e.organizerSite} as the official website`,
        };
        return {
          id: e.id,
          name: e.label,
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
      for (const u of [e.site, e.organizerSite]) {
        const h = hostOf(u);
        if (h && !isTrustedAuthorityHost(h)) mine.push(`${h} is nominated as official but is not a government or education domain, so I did not read it or treat it as official`);
      }
      const facts: ExamFact[] = [];
      const seen = new Set<string>();
      const queue = [e.site, e.organizerSite].filter((u): u is string => !!u && c.officialDomains.includes(baseDomain(hostOf(u) ?? "")));
      let fetched = 0;
      const pages: string[] = [];
      let named = false;
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
        const aboutExam = namesExam(`${title}\n${text}`, names);
        const yearMatch = year ? sentences(text).some((s) => new RegExp(`\\b${year}\\b`).test(s) && namesExam(s, names)) : false;
        const ref: SourceRef = { url: r.url, publisher: finalHost, via: "web", retrievedAt, publishedAt: null, note: `${title.slice(0, 100) || "untitled page"}; exam named on page: ${aboutExam}; year ${year ?? "unknown"} appears in a sentence naming the exam: ${yearMatch}${r.truncated ? "; page truncated at size cap" : ""}` };
        if (aboutExam && !named) {
          named = true;
          facts.push({ key: "official_site_confirmed", value: `${finalHost} names ${names[0]}${title ? ` (page title: "${title.slice(0, 100)}")` : ""}`, source: ref });
        }
        if (!aboutExam) continue;
        if (isHtml) for (const l of relevantLinks(r.text, r.url, year, names).slice(0, 3)) if (!seen.has(l)) queue.push(l);
        const cand = new Map<string, { date: string; sentence: string }>();
        for (const s of sentences(text)) {
          if (!EXAM_DAY_CUE.test(s) || NOT_EXAM_DAY.test(s)) continue;
          const d = plainExamDate(s);
          if (!d || (year && !d.startsWith(year)) || d <= today) continue;
          if (!namesExam(s, names) || INSTRUCTION_LIKE.test(s)) continue;
          cand.set(d, { date: d, sentence: s });
        }
        for (const { date, sentence } of cand.values()) {
          facts.push({ key: "exam_date_candidate", value: date, source: { ...ref, note: `${ref.note}; quoted: "${sentence}"` } });
        }
      }
      if (!named) mine.push("no page on the nominated official domain could be read and matched to this exam");
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
