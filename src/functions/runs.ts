import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import type { StageRecord } from "../services/runs.ts";

const s3 = new S3Client({});

// Same gate as the writers: without the bucket there is nothing to list.
const bucketName = (): string => process.env.ARTIFACTS_BUCKET ?? "";

// Keep the dashboard responsive: read records newest-first until this many
// runs are gathered instead of pulling the whole prefix.
const MAX_RUNS = 25;

export interface RunSummary {
  readonly runId: string;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly stages: readonly StageRecord[];
}

const listRecordKeys = async (
  bucket: string,
): Promise<readonly { key: string; lastModified: Date }[]> => {
  const entries: { key: string; lastModified: Date }[] = [];
  let token: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: "runs/", ContinuationToken: token }),
    );
    for (const object of page.Contents ?? []) {
      if (object.Key !== undefined) {
        entries.push({ key: object.Key, lastModified: object.LastModified ?? new Date(0) });
      }
    }
    token = page.IsTruncated === true ? page.NextContinuationToken : undefined;
  } while (token !== undefined);
  return entries.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
};

const fetchRecord = async (bucket: string, key: string): Promise<StageRecord | undefined> => {
  try {
    const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await response.Body?.transformToString();
    return body === undefined ? undefined : (JSON.parse(body) as StageRecord);
  } catch (error) {
    console.warn(`runs: skipping unreadable record ${key}`, error);
    return undefined;
  }
};

/** Group the newest run records by runId, newest run first. */
export const listRuns = async (): Promise<readonly RunSummary[]> => {
  const bucket = bucketName();
  if (bucket === "") {
    console.log("runs: ARTIFACTS_BUCKET not set, returning no runs");
    return [];
  }

  const recordsByRun = new Map<string, StageRecord[]>();
  for (const entry of await listRecordKeys(bucket)) {
    const runId = entry.key.split("/")[1] ?? "";
    if (runId === "") continue;
    const known = recordsByRun.get(runId);
    if (known === undefined && recordsByRun.size >= MAX_RUNS) continue;
    const record = await fetchRecord(bucket, entry.key);
    if (record === undefined) continue;
    (recordsByRun.get(runId) ?? recordsByRun.set(runId, []).get(runId))?.push(record);
  }

  const runs = [...recordsByRun.entries()].map(([runId, stages]) => {
    const ordered = [...stages].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const finished = ordered
      .map((record) => record.finishedAt)
      .filter((finishedAt): finishedAt is string => finishedAt !== undefined)
      .sort();
    const anyRunning = ordered.some((record) => record.status === "running");
    return {
      runId,
      startedAt: ordered[0]?.startedAt ?? "",
      // A run is only finished once no stage is still running; the final
      // stage writes its "running" record before any of this is observable.
      finishedAt: anyRunning ? undefined : finished.at(-1),
      stages: ordered,
    };
  });
  return runs.sort((a, b) =>
    (b.finishedAt ?? b.startedAt).localeCompare(a.finishedAt ?? a.startedAt),
  );
};

export const handler: APIGatewayProxyHandlerV2 = async () => ({
  statusCode: 200,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(await listRuns()),
});
