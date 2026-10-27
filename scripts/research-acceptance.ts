// Public research only. Caller must explicitly enable the process and enforce
// its wall-clock cap. No retries, choice guessing, student storage or secrets.
import { researchExam } from "../src/context/examContext.ts";
import { pinnedHttpsFetch, webResearch } from "../src/context/webResearch.ts";

if (process.env.HM_LIVE_RESEARCH !== "1") throw new Error("process-only live research approval required");
const cases = [["non-CBSE", "Civil Services Examination"], ["unavailable", "Moonstone Imaginary Assessment"], ["CBSE", "CBSE Class 12"]];
const results = [];
let stopped = false;
// Exercise the positive non-CBSE case first; the invented exam must stay unknown.
for (const [role, exam] of cases) {
  const requests: { url: string; status: number }[] = [];
  const source = webResearch({ pinnedFetch: async (args) => {
    const response = await pinnedHttpsFetch(args);
    requests.push({ url: args.url.toString(), status: response.status });
    return response;
  } });
  const step = await researchExam(source, { exam, country: "India", goal: "fictional public research acceptance" }, { ranAt: new Date().toISOString() });
  const limits = source.lastLimits();
  results.push({ role, exam, step, limits, requests });
  if (requests.some(r => [401, 403, 429].includes(r.status) || r.status >= 500) || limits.some(l => /stopped|request failed|unreachable|did not resolve/i.test(l))) {
    stopped = true;
    break;
  }
}
const nonCbse = results.find(r => r.role === "non-CBSE");
const officialExamFact = nonCbse?.step.status === "resolved" && nonCbse.step.context.facts.some(f => f.key === "exam_named_on_official_site" && f.status === "verified-official");
const unknownSafe = results.find(r => r.role === "unavailable")?.step.status === "not_found";
const ok = Boolean(officialExamFact && unknownSafe && results.length === 3 && !stopped);
console.log(JSON.stringify({ kind: "live public product research", at: new Date().toISOString(), ok, stopped, notRun: cases.slice(results.length).map(([role, exam]) => ({ role, exam })), nonCbseOfficialExamFact: Boolean(officialExamFact), unavailableSafeUnknown: unknownSafe, results }, null, 2));
process.exitCode = ok ? 0 : 1;
