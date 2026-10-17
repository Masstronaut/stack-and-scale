import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Effect } from "effect";
import { RunsError } from "./errors.ts";
import type { RunTrackerServiceShape, StageRecord } from "./runs.ts";

const s3 = new S3Client({});

// Gate-style like the artifact sink: with no bucket configured run tracking
// is disabled and records are logged + skipped instead of attempted.
const bucketName = (): string => process.env.ARTIFACTS_BUCKET ?? "";

// runId ends up in an S3 key prefix; keep it to safe path characters so a
// malformed queue message cannot escape the run's prefix.
const safeSegment = (segment: string): string => segment.replace(/[^A-Za-z0-9._-]+/g, "-");

export const RunTrackerServiceLive: RunTrackerServiceShape = {
  recordStage: (record: StageRecord) =>
    Effect.suspend(() => {
      const bucket = bucketName();
      if (bucket === "") {
        console.log(
          `run tracking disabled (ARTIFACTS_BUCKET unset), skipping ${record.runId}/${record.key} (${record.status})`,
        );
        return Effect.void;
      }
      const key = `runs/${safeSegment(record.runId)}/${record.key}.json`;
      return Effect.tryPromise({
        try: async () => {
          await s3.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: key,
              Body: JSON.stringify(record, null, 2),
              ContentType: "application/json",
            }),
          );
        },
        catch: (cause) => new RunsError({ cause }),
      });
    }),
};
