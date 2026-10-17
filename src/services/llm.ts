import { Context, Effect } from "effect";
import type { LlmError } from "./errors.ts";

export interface LlmServiceShape {
  /**
   * Single-shot text completion. Workers craft their own prompts and parse
   * the reply; add structured-output helpers (JSON mode, tool calls) here
   * once a provider is chosen.
   */
  readonly complete: (prompt: string) => Effect.Effect<string, LlmError>;
}

export class LlmService extends Context.Service<LlmService, LlmServiceShape>()("LlmService") {}

/**
 * Stub implementation. Real version should:
 * - pick a provider SDK and read its API key from an `sst.Secret`
 *   (e.g. `LLM_API_KEY`) linked to the worker functions in `sst.config.ts`
 * - set timeouts/retries appropriate for long contract reads
 * - optionally expose structured extraction (JSON schema responses) so
 *   workers stop string-matching replies
 */
export const LlmServiceStub: LlmServiceShape = {
  complete: () => Effect.succeed("TODO: llm response"),
};
