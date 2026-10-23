// MOCK research source. A hand-written offline list standing in for web
// research, written 2026-10-23 from general knowledge. Nothing here was
// fetched, so every fact is "unverified" by design (checkFact). It holds no
// exam dates, cut-offs or weightages: those must come from a fetched official
// page or from the student. It covers only Indian Class 12 board exams.

import type { ExamCandidate, ResearchSource, StudentGoal } from "./examContext.ts";

const NOT_FETCHED = { via: "fixture" as const, retrievedAt: null, publishedAt: null, note: "written 2026-10-23 from general knowledge; not fetched" };

export const FIXTURE_EXAMS: ExamCandidate[] = [
  {
    id: "in-cbse-12",
    name: "CBSE Class 12 board exam",
    body: "Central Board of Secondary Education",
    country: "India",
    aliases: ["board", "boards", "class 12", "12th", "cbse", "aissce"],
    distinct: ["cbse", "central board", "aissce", "ncert"],
    officialDomains: ["cbse.gov.in", "cbseacademic.nic.in", "ncert.nic.in"],
    facts: [
      { key: "conducting_body", value: "Central Board of Secondary Education", source: { url: "https://www.cbse.gov.in", publisher: "CBSE", ...NOT_FETCHED } },
      { key: "textbooks", value: "NCERT textbooks", source: { url: "https://ncert.nic.in", publisher: "NCERT", ...NOT_FETCHED } },
    ],
    corpora: ["ncert-phy12-ch1"],
  },
  {
    id: "in-isc-12",
    name: "ISC Class 12 exam",
    body: "Council for the Indian School Certificate Examinations",
    country: "India",
    aliases: ["board", "boards", "class 12", "12th", "isc", "cisce"],
    distinct: ["isc", "cisce", "council"],
    officialDomains: ["cisce.org"],
    facts: [{ key: "conducting_body", value: "Council for the Indian School Certificate Examinations", source: { url: "https://cisce.org", publisher: "CISCE", ...NOT_FETCHED } }],
    corpora: [],
  },
  {
    id: "in-state-12",
    name: "State board Class 12 exam",
    body: "a state board of school education (varies by state)",
    country: "India",
    aliases: ["board", "boards", "class 12", "12th", "state board", "hsc"],
    distinct: ["state", "hsc"],
    officialDomains: [],
    facts: [],
    corpora: [],
  },
];

export const fixtureResearch: ResearchSource = {
  name: "fixture-exams-2026-10-23",
  kind: "fixture",
  async find(goal: StudentGoal) {
    const exam = goal.exam.toLowerCase();
    const country = goal.country.trim().toLowerCase();
    return FIXTURE_EXAMS.filter((c) => c.country.toLowerCase() === country && c.aliases.some((a) => new RegExp(`\\b${a}\\b`).test(exam)));
  },
};
