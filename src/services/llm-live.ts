import { Effect } from "effect";
import { LlmError } from "./errors.ts";
import type { LlmServiceShape } from "./llm.ts";

const chatCompletion = async (prompt: string): Promise<string> => {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) throw new Error("LLM_API_KEY is not set");
  const baseUrl = process.env.LLM_BASE_URL ?? "https://api.openai.com/v1";
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.LLM_MODEL ?? "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) {
    throw new Error(`LLM request failed with status ${response.status}: ${await response.text()}`);
  }
  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (content === undefined)
    throw new Error(`LLM response had no message content: ${JSON.stringify(data)}`);
  return content;
};

export const LlmServiceLive: LlmServiceShape = {
  complete: (prompt) =>
    Effect.tryPromise({
      try: () => chatCompletion(prompt),
      catch: (cause) => new LlmError({ cause }),
    }),
};
