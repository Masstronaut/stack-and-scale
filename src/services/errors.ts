import { Data } from "effect";

export class BoxError extends Data.TaggedError("BoxError")<{
  readonly cause: unknown;
}> {}

export class LlmError extends Data.TaggedError("LlmError")<{
  readonly cause: unknown;
}> {}

export class QueueError extends Data.TaggedError("QueueError")<{
  readonly cause: unknown;
}> {}

export class ArtifactsError extends Data.TaggedError("ArtifactsError")<{
  readonly cause: unknown;
}> {}

export class RunsError extends Data.TaggedError("RunsError")<{
  readonly cause: unknown;
}> {}
