import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMentor, type StudentContext } from "../src/agent/graph.ts";
import { rulePlanner } from "../src/agent/planner.ts";
import { buildWhyCard } from "../src/agent/whyCard.ts";
import { csvStudyData } from "../src/data/studyData.ts";
import { RIYA_SWAP_REQUEST, RIYA_TOPICS } from "../src/synthetic/riya.ts";

const CSV = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "seed", "study-records.csv");
const src = csvStudyData(CSV);

test("CSV source returns only the asked student's rows, with file#line provenance and no SQL", async () => {
  const riya = await src.topicsFor("riya");
  assert.equal(riya.sql, null);
  assert.deepEqual(riya.rows.map((r) => r.sourceRow), ["csv:study-records.csv#2", "csv:study-records.csv#3", "csv:study-records.csv#4", "csv:study-records.csv#5"]);
  // same numbers as the in-code fixture the earlier milestones used
  assert.deepEqual(riya.rows.map(({ sourceRow, ...r }) => r), RIYA_TOPICS.map(({ sourceRow, ...r }) => r));

  const kabir = await src.topicsFor("kabir");
  assert.deepEqual(kabir.rows.map((r) => r.topicId), ["maths:integrals", "chemistry:organic"]);
  assert.deepEqual((await src.topicsFor("nobody")).rows, []);
});

test("CSV source rejects a wrong header and out-of-range values", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hm-csv-"));
  const bad = path.join(dir, "bad.csv");
  fs.writeFileSync(bad, "id,topic\nriya,x\n");
  await assert.rejects(csvStudyData(bad).topicsFor("riya"), /expected header/);
  fs.writeFileSync(bad, "student_id,topic_id,subject,name,mastery,marks_weight\nriya,physics:x,physics,X,1.7,0.5\n");
  await assert.rejects(csvStudyData(bad).topicsFor("riya"), /line 2: mastery/);
});

test("graph plans from CSV rows; the why card cites the CSV line and still shows no SQL", async () => {
  const q = await src.topicsFor("riya");
  const student: StudentContext = { studentId: "riya", name: "Riya (fictional)", hoursPerDay: 3, daysToExam: 120, topics: q.rows };
  const s = await runMentor({ planner: rulePlanner, memory: null }, student, RIYA_SWAP_REQUEST);
  const card = buildWhyCard(s);
  assert.ok(card.reasons.some((r) => r.ref.kind === "data_row" && r.ref.id === "csv:study-records.csv#2"));
  assert.equal(card.sql, null);
});

test("changed fictional marks in the CSV change the plan, and the why card names the new file and line", async () => {
  const { writeChangedCsv } = await import("../scripts/csv-plan-demo.ts");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hm-csv-"));
  const changed = path.join(dir, "study-records.after-quiz.csv");
  assert.deepEqual(writeChangedCsv(CSV, changed), ["line 2: physics:electrostatics mastery 0.35 -> 0.88", "line 4: maths:integrals mastery 0.5 -> 0.25"]);
  const plan = async (file: string) => {
    const rows = (await csvStudyData(file).topicsFor("riya")).rows;
    return runMentor({ planner: rulePlanner, memory: null }, { studentId: "riya", name: "Riya (fictional)", hoursPerDay: 3, daysToExam: 120, topics: rows }, "Plan my study for today.");
  };
  const before = await plan(CSV);
  const after = await plan(changed);
  assert.equal(before.draft!.blocks[0].topicId, "physics:electrostatics");
  assert.equal(after.draft!.blocks[0].topicId, "maths:integrals");
  assert.ok(!after.draft!.blocks.some((b) => b.topicId === "physics:electrostatics")); // 0.88 is past the mastered line
  assert.deepEqual(buildWhyCard(after).reasons.map((r) => r.ref.id), ["csv:study-records.after-quiz.csv#4"]);
});
