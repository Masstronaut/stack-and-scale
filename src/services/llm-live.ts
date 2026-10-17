import { Effect } from "effect";
import { LlmError } from "./errors.ts";
import type { LlmServiceShape } from "./llm.ts";

export type LlmProvider =
  | { readonly kind: "bedrock"; readonly model: string }
  | {
      readonly kind: "openai";
      readonly model: string;
    };

/**
 * Provider selection: Bedrock Nova by default (uses the function's AWS
 * credentials - no separate key), or an OpenAI-compatible endpoint when
 * LLM_API_KEY/LLM_PROVIDER=openai is configured.
 */
export const resolveLlmProvider = (): LlmProvider => {
  if (process.env.LLM_PROVIDER === "openai") {
    if (!process.env.LLM_API_KEY) throw new Error("LLM_PROVIDER=openai requires LLM_API_KEY");
    return { kind: "openai", model: process.env.LLM_MODEL ?? "gpt-4o-mini" };
  }
  return { kind: "bedrock", model: process.env.LLM_MODEL ?? "us.amazon.nova-lite-v1:0" };
};

/**
 * Hard cap on prompt size: multi-document prompts (contract + related docs)
 * overflow the model's input context. ~4 chars/token, so 120k chars is a
 * conservative ~30k tokens. Env-overridable.
 */
export const maxInputChars = (): number => Number(process.env.LLM_MAX_INPUT_CHARS ?? 120_000);

export const truncatePromptInput = (prompt: string): string => {
  const max = maxInputChars();
  if (prompt.length <= max) return prompt;
  return `${prompt.slice(0, max)}\n\n[...truncated ${prompt.length - max} chars to fit model input limits]`;
};

const bedrockCompletion = async (prompt: string, model: string): Promise<string> => {
  const { BedrockRuntimeClient, ConverseCommand } = await import("@aws-sdk/client-bedrock-runtime");
  const client = new BedrockRuntimeClient({
    region: process.env.AWS_REGION ?? "us-west-2",
  });
  const response = await client.send(
    new ConverseCommand({
      modelId: model,
      messages: [{ role: "user", content: [{ text: prompt }] }],
      inferenceConfig: { maxTokens: 4000, temperature: 0.2 },
    }),
  );
  const content = response.output?.message?.content?.[0]?.text;
  if (content === undefined) {
    throw new Error(`Bedrock response had no message content: ${JSON.stringify(response.output)}`);
  }
  return content;
};

const openaiCompletion = async (prompt: string, model: string): Promise<string> => {
  const baseUrl = process.env.LLM_BASE_URL ?? "https://api.openai.com/v1";
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model,
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

const completion = async (prompt: string): Promise<string> => {
  const provider = resolveLlmProvider();
  const bounded = truncatePromptInput(prompt);
  return provider.kind === "bedrock"
    ? bedrockCompletion(bounded, provider.model)
    : openaiCompletion(bounded, provider.model);
};

export const LlmServiceLive: LlmServiceShape = {
  complete: (prompt) =>
    Effect.tryPromise({
      try: () => completion(prompt),
      catch: (cause) => new LlmError({ cause }),
    }),
};
