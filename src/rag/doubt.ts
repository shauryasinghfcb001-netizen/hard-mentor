// NCERT doubt answers with citations (blueprint feature 4). Out-of-syllabus
// questions are refused. With a model, the answer must pass the citation check
// or the extractive answer is sent instead; without a model, the answer is the
// retrieved NCERT note itself (extractive), labelled as such.

import type { ChatModel } from "../llm/client.ts";
import { extractJson } from "../agent/modelPlanner.ts";
import { checkCitations, citeChunk, groundQuestion, type Citation, type CitationCheck, type GroundingDecision, type Retriever } from "./ncert.ts";

export interface DoubtAnswer {
  mode: "model" | "extractive" | "refusal";
  text: string;
  citations: Citation[];
  check: CitationCheck | null;
  grounding: GroundingDecision;
  producedBy: string;
}

export function refusalText(r: Retriever, g?: GroundingDecision): string {
  const scope = `I only have NCERT Class 12 Physics Ch ${r.corpus.chapter}, ${r.corpus.chapterTitle}`;
  const asks = "Ask me about charges, Coulomb's law, fields, field lines, flux, dipoles or Gauss's law.";
  if (g?.scopeLimit?.concepts.length) {
    const c = g.scopeLimit.concepts;
    const where = c.map((x) => (x.usually ? `${x.label} (${x.usually})` : x.label)).join("; ");
    return `That question is about ${where}. ${scope}, and these notes do not cover it, so I won't answer it from them. Check your textbook or ask your teacher. ${asks}`;
  }
  if (g?.missing?.length && g.hits.length) {
    return `${scope}. The closest note does not support this question (not found in it: ${g.missing.join(", ")}), so I won't answer it from the notes. Check your textbook or ask your teacher. ${asks}`;
  }
  return `${scope}, and this question is not covered there. Ask your teacher. ${asks}`;
}

/** One line saying why the cited note was chosen: the question phrases it states together and the question words it contains. */
export function whyThisNote(g: GroundingDecision): string {
  const s = g.support;
  if (!s) return "";
  const phrases = s.phrases.length ? `has the question's word pairs ${s.phrases.map((p) => `"${p}"`).join(", ")} close together; it ` : "";
  const missing = g.missing?.length ? `; not in it: ${g.missing.join(", ")}` : "";
  return `Why this note: it ${phrases}contains ${s.terms.join(", ")}${missing}.`;
}

function extractive(r: Retriever, g: GroundingDecision, note?: string): DoubtAnswer {
  const top = g.hits[0].chunk;
  const why = whyThisNote(g);
  return {
    mode: "extractive",
    text: `${top.text}\n\nSource: ${citeChunk(r.corpus, top)}${why ? `\n${why}` : ""}`,
    citations: [{ chunkId: top.id, pages: top.pages }],
    check: null,
    grounding: g,
    producedBy: `bm25-extractive${note ? ` (${note})` : ""}`,
  };
}

const SYSTEM = `You answer a CBSE Class 12 student's physics doubt using ONLY the NCERT notes given.
If the notes do not answer it, say so. Keep it under 120 words. Cite the note ids you used.
Reply with ONE JSON object and nothing else:
{"answer": "...", "citations": [{"chunkId": "...", "pages": [1]}]}`;

export async function answerDoubt(r: Retriever, question: string, model: ChatModel | null): Promise<DoubtAnswer> {
  const g = groundQuestion(r, question);
  if (!g.inSyllabus) {
    return { mode: "refusal", text: refusalText(r, g), citations: [], check: null, grounding: g, producedBy: "out-of-syllabus gate" };
  }
  if (!model) return extractive(r, g);

  const notes = g.hits.map((h) => `[${h.chunk.id}] §${h.chunk.section}, pages ${h.chunk.pages.join(",")}: ${h.chunk.text}`).join("\n");
  try {
    const res = await model.chat([
      { role: "system", content: SYSTEM },
      { role: "user", content: `NCERT notes:\n${notes}\n\nQuestion: ${question}` },
    ]);
    const parsed = extractJson(res.text) as { answer?: unknown; citations?: unknown };
    if (typeof parsed.answer !== "string" || !Array.isArray(parsed.citations)) throw new Error("reply JSON missing answer/citations");
    const citations: Citation[] = parsed.citations.map((c: any) => ({ chunkId: String(c?.chunkId), pages: Array.isArray(c?.pages) ? c.pages.map(Number) : [] }));
    const check = checkCitations(parsed.answer, citations, g.hits.map((h) => h.chunk), 0.3, { question, retriever: r });
    if (!check.ok) return { ...extractive(r, g, `model answer failed citation check: ${check.failures.join("; ")}`), check };
    const sources = citations.map((c) => citeChunk(r.corpus, g.hits.find((h) => h.chunk.id === c.chunkId)!.chunk));
    return { mode: "model", text: `${parsed.answer}\n\nSource: ${[...new Set(sources)].join("; ")}`, citations, check, grounding: g, producedBy: `model:${res.provider}/${res.model}` };
  } catch (err) {
    return extractive(r, g, `model failed: ${(err as Error).message.slice(0, 160)}`);
  }
}
