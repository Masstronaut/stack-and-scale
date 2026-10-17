import type { SQSEvent, SQSHandler } from "aws-lambda";
import { Effect, Result } from "effect";
import {
  RunTrackerService,
  type StageName,
  type StageRecord,
  type StageStatus,
} from "../services/runs.ts";

/**
 * Adapt an Effect-based job processor into an SQS Lambda handler with partial
 * batch responses: only the messages whose effect failed are requeued, the
 * rest are acknowledged.
 */
export const createSqsWorker = <Job>(
  parseJob: (body: string) => Job,
  processJob: (job: Job) => Effect.Effect<unknown, unknown>,
): SQSHandler => {
  return async (event: SQSEvent) => {
    const batchItemFailures: { itemIdentifier: string }[] = [];

    for (const record of event.Records) {
      try {
        const job = parseJob(record.body);
        const result = await Effect.runPromise(processJob(job));
        console.log(`job ${record.messageId} ok:`, JSON.stringify(result));
      } catch (error) {
        console.error(`job ${record.messageId} failed`, error);
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }

    return { batchItemFailures };
  };
};

/**
 * Minimal JSON parse for queue messages.
 * TODO: validate with a schema (e.g. effect/Schema) so malformed payloads are
 * rejected explicitly instead of trusting the cast.
 */
export const parseJson = <Job>(body: string): Job => JSON.parse(body) as Job;

export interface RunTracking<Job> {
  /** The pipeline stage this worker owns. */
  readonly stage: StageName;
  /** Record key, unique within the run (e.g. "scanner" or "<id>/salesNotes"). */
  readonly key: (job: Job) => string;
  /** Artifact keys produced by this stage, listed on the final record. */
  readonly artifactKeys?: (job: Job) => readonly string[];
}

const describeError = (error: unknown): string => {
  const tag =
    typeof error === "object" && error !== null && "_tag" in error
      ? String((error as { _tag: unknown })._tag)
      : undefined;
  const message = error instanceof Error && error.message !== "" ? error.message : undefined;
  return [tag, message].filter((part) => part !== undefined).join(": ") || String(error);
};

/**
 * Record a `running` stage record before `process` starts and a final `ok` /
 * `failed` record once it settles, then rethrow failures unchanged so the
 * runner dead-letters exactly as before. Jobs without a runId (legacy
 * messages) skip tracking, and record-write failures are logged but never
 * fail the pipeline job - tracking is auxiliary, the artifacts are not.
 */
export const withRunTracking = <Job extends { readonly runId?: string }, A, E, R>(
  tracking: RunTracking<Job>,
  job: Job,
  process: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | RunTrackerService> =>
  Effect.gen(function* () {
    const runId = job.runId;
    if (runId === undefined) return yield* process;
    const runs = yield* RunTrackerService;
    const key = tracking.key(job);
    const startedAt = new Date().toISOString();
    const input: Record<string, unknown> = { ...job } as Record<string, unknown>;
    const record = (status: StageStatus, extra: Partial<StageRecord>) =>
      Effect.gen(function* () {
        const attempt = yield* Effect.result(
          runs.recordStage({ runId, stage: tracking.stage, key, status, startedAt, ...extra }),
        );
        if (Result.isFailure(attempt)) {
          console.warn(
            `run tracking: could not record ${runId}/${key} (${status})`,
            attempt.failure,
          );
        }
      });

    yield* record("running", { input });
    const outcome = yield* Effect.result(process);
    const finishedAt = new Date().toISOString();
    if (Result.isFailure(outcome)) {
      yield* record("failed", {
        finishedAt,
        input,
        error: describeError(outcome.failure),
      });
      return yield* Effect.fail(outcome.failure);
    }
    yield* record("ok", {
      finishedAt,
      input,
      output: outcome.success as Record<string, unknown> | undefined,
      artifactKeys: tracking.artifactKeys?.(job),
    });
    return outcome.success;
  });
