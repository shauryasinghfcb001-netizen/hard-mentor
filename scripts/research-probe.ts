// Live lookup probe: node --import tsx scripts/research-probe.ts "<exam>" "<country>" [YYYY-MM-DD]
// Reads public pages (see src/context/webResearch.ts). Sends only the exam name to the discovery service.
import { researchExam } from "../src/context/examContext.ts";
import { webResearch } from "../src/context/webResearch.ts";

const [exam, country, stated] = process.argv.slice(2);
if (!exam || !country) {
  console.error('usage: research-probe.ts "<exam>" "<country>" [stated-date]');
  process.exit(2);
}
const src = webResearch();
const step = await researchExam(src, { exam, country, goal: "probe", statedExamDate: stated }, { ranAt: new Date().toISOString() });
console.log(JSON.stringify(step, null, 2));
