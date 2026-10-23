// Answer path for the starter notebook. Two labeled modes:
//   retrieval-only (default): the answer is assembled from retrieved
//     memories; zero network access, zero keys.
//   model mode: when NVIDIA_API_KEY or OPENROUTER_API_KEY is set (see
//     .env.example), the reinjection block goes to the OpenAI-compatible
//     client in src/llm/client.ts. The starter's Anthropic SDK path was
//     replaced by that client (blueprint: one provider path, NVIDIA first).

import { modelFromEnv } from "./llm/client.ts";

export interface AnswerResult {
  mode: "retrieval-only" | "model";
  text: string;
}

export async function answer(question: string, memoryContext: string, memories: { relevance: number; content: string }[]): Promise<AnswerResult> {
  const model = modelFromEnv(process.env);
  if (model) {
    const res = await model.chat([
      {
        role: "user",
        content: `${memoryContext}\n\nAnswer using ONLY the memory context above. Cite memory ids inline.\n\nQuestion: ${question}`,
      },
    ]);
    return { mode: "model", text: res.text };
  }
  return { mode: "retrieval-only", text: retrievalOnly(question, memories) };
}

function retrievalOnly(question: string, memories: { relevance: number; content: string }[]): string {
  if (memories.length === 0) {
    return `Nothing in memory answers "${question}" yet. Teach me: notebook remember "<fact>"`;
  }
  const lines = [`Based on what I remember about "${question}":`];
  for (const m of memories) lines.push(`- ${m.content} (relevance ${m.relevance.toFixed(2)})`);
  return lines.join("\n");
}
