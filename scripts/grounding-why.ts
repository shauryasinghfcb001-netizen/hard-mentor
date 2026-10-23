// Prints the grounding decision for each question given on the command line:
// the chosen NCERT note, the question phrases it states together, the question
// words it contains and does not contain, and the note text. No model is called.
//
//   node --import tsx scripts/grounding-why.ts "question 1" "question 2"

import path from "node:path";
import { refusalText, whyThisNote } from "../src/rag/doubt.ts";
import { bm25Retriever, citeChunk, groundQuestion, loadCorpus } from "../src/rag/ncert.ts";

const r = bm25Retriever(loadCorpus(path.resolve("corpus/ncert-phy12-ch1.json")));
for (const q of process.argv.slice(2)) {
  const g = groundQuestion(r, q);
  console.log(`Q: ${q}`);
  if (g.inSyllabus) {
    const c = g.hits[0].chunk;
    console.log(`  ANSWERED from ${c.id} (${citeChunk(r.corpus, c)}: ${c.title})`);
    console.log(`  ${whyThisNote(g)}`);
    console.log(`  gate: ${g.reason}`);
    console.log(`  note: ${c.text}`);
  } else {
    console.log(`  REFUSED. gate: ${g.reason}`);
    console.log(`  reply: ${refusalText(r, g)}`);
  }
  console.log("");
}
