import { Context, Effect } from "effect";
import type { RunsError } from "./errors.ts";

/** The pipeline stages that emit run records, in pipeline order. */
export const STAGES = [
  "contractScanner",
  "relatedDocuments",
  "docDigest",
  "salesNotes",
  "salesSlides",
] as const;

export type StageName = (typeof STAGES)[number];
export type StageStatus = "running" | "ok" | "failed";

/**
 * One stage attempt within a run, stored as a single S3 object under
 * `runs/<runId>/<key>.json` (see RunTrackerServiceLive). One JSON document
 * per record keeps the dashboard to plain List/Get calls - no database.
 */
export interface StageRecord {
  readonly runId: string;
  readonly stage: StageName;
  /** Unique within the run, e.g. "scanner" or "<contractFileId>/salesNotes". */
  readonly key: string;
  readonly status: StageStatus;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly input?: Record<string, unknown>;
  readonly output?: Record<string, unknown>;
  readonly artifactKeys?: readonly string[];
  readonly error?: string;
}

export interface RunTrackerServiceShape {
  /** Store one stage record for a run (gate-style: skipped without a bucket). */
  readonly recordStage: (record: StageRecord) => Effect.Effect<void, RunsError>;
}

export class RunTrackerService extends Context.Service<RunTrackerService, RunTrackerServiceShape>()(
  "RunTrackerService",
) {}

/**
 * Stub implementation. Real version should PUT the record JSON to the
 * artifacts S3 bucket named by `ARTIFACTS_BUCKET`, treating an unset or
 * empty bucket as "run tracking disabled" (gate-style: skip with a log).
 */
export const RunTrackerServiceStub: RunTrackerServiceShape = {
  recordStage: () => Effect.void,
};
