import { Effect, Result } from "effect";
import type { ScanContractsJob } from "../jobs/messages.ts";
import { ArtifactsService } from "../services/artifacts.ts";
import { ArtifactsServiceLive } from "../services/artifacts-live.ts";
import { BoxService, type FileRef } from "../services/box.ts";
import { BoxServiceLive } from "../services/box-live.ts";
import type { BoxError, LlmError, QueueError } from "../services/errors.ts";
import { RunTrackerService } from "../services/runs.ts";
import { RunTrackerServiceLive } from "../services/runs-live.ts";
import { loadManifest, selectAgreementFiles, type ManifestDocument } from "../lib/manifest.ts";
import { LlmService } from "../services/llm.ts";
import { LlmServiceLive } from "../services/llm-live.ts";
import { JobQueueService } from "../services/jobs.ts";
import { JobQueueServiceLive } from "../services/jobs-live.ts";
import { createSqsWorker, parseJson, withRunTracking } from "./runner.ts";

// Worker for issue #2: find all contracts and add contract
// expiration/termination date as metadata in box.
//
// input:  ScanContractsJob (a full pass over box)
// output: `expirationDate`/`isContract` metadata stamped on every contract
//         and one RelatedDocumentsJob enqueued per contract for worker #3.
//         The pass gets a fresh runId (crypto.randomUUID) that threads
//         through every downstream job, a scan-summary artifact at
//         `artifacts/scan/<runId>/scan-summary.json`, and contractScanner
//         run records so the dashboard can follow the whole pass.
//
// Manifest-first (see docs/dataset/WORKERS.md): when the committed manifest
// has AGREEMENT entries, exactly those synthetic per-account files are
// scanned - no LLM classification, and the historical CUAD originals are
// never touched. Otherwise falls back to a full box scan with LLM
// classification (verdicts cached so repeat scans skip LLM calls).
//
// Box is read-only unless BOX_WRITE_ENABLED === "true"; disabled scans log
// the would-be metadata writes and still enqueue downstream jobs.

type ScanError = BoxError | LlmError | QueueError;

interface ScanFileResult {
  readonly fileId: string;
  readonly isContract: boolean;
  readonly expirationDate?: string;
  /** The stamp step ran for this contract (written, would-write or current). */
  readonly stamped: boolean;
  readonly enqueued: boolean;
}

const VERDICT_KEY = "contractScanVerdict";
const VERDICT_CONTRACT = "contract";
const VERDICT_NOT_CONTRACT = "not-contract";

const writesEnabled = () => process.env.BOX_WRITE_ENABLED === "true";

const classifyPrompt = (text: string) =>
  `Is the following document a contract? Answer with exactly "yes" or "no".\n\n${text}`;

const expirationPrompt = (text: string) =>
  `What is the expiration/termination date of this contract? Answer with an ISO date (yyyy-mm-dd) or exactly "none".\n\n${text}`;

const isYes = (reply: string) => reply.trim().toLowerCase().startsWith("yes");

const parseIsoDate = (reply: string): string => {
  const match = reply.match(/\d{4}-\d{2}-\d{2}/);
  return match !== null && !Number.isNaN(Date.parse(match[0])) ? match[0] : "none";
};

const processFile = (file: FileRef, knownContract: boolean, runId: string) =>
  Effect.gen(function* () {
    const box = yield* BoxService;
    const llm = yield* LlmService;
    const queues = yield* JobQueueService;

    const metadata = yield* box.getFileMetadata(file.id);
    const cachedVerdict = metadata[VERDICT_KEY];
    let text: string | undefined;
    let isContract = knownContract || cachedVerdict === VERDICT_CONTRACT;
    if (!isContract && cachedVerdict !== VERDICT_NOT_CONTRACT) {
      text = yield* box.getFileText(file.id);
      isContract = isYes(yield* llm.complete(classifyPrompt(text)));
    }
    if (!isContract) {
      return { fileId: file.id, isContract: false as const, stamped: false, enqueued: false };
    }

    text ??= yield* box.getFileText(file.id);
    const expirationDate = parseIsoDate(yield* llm.complete(expirationPrompt(text)));

    // Stamp verdict + date in one write, but skip it when everything is
    // already up to date. Writes are gated behind BOX_WRITE_ENABLED.
    const stamp = { expirationDate, isContract: "true", [VERDICT_KEY]: VERDICT_CONTRACT };
    const unchanged =
      metadata[VERDICT_KEY] === VERDICT_CONTRACT &&
      metadata.isContract === "true" &&
      metadata.expirationDate === expirationDate;
    if (!unchanged) {
      if (writesEnabled()) {
        yield* box.updateFileMetadata(file.id, stamp);
      } else {
        console.log(`box write disabled, would stamp file ${file.id}:`, JSON.stringify(stamp));
      }
    }
    yield* queues.enqueue({ contractFileId: file.id, runId });
    return {
      fileId: file.id,
      isContract: true as const,
      expirationDate,
      stamped: true,
      enqueued: true,
    };
  });

const scan = (job: ScanContractsJob, agreements: readonly ManifestDocument[]) =>
  Effect.gen(function* () {
    const box = yield* BoxService;
    const artifacts = yield* ArtifactsService;

    // processJob always injects a runId; the fallback keeps scan safe if it
    // is ever called directly.
    const runId = job.runId ?? crypto.randomUUID();

    // Manifest mode processes exactly the allowlisted synthetic agreements;
    // the fallback scans everything box has and classifies with the LLM.
    const manifestMode = agreements.length > 0;
    const documents: readonly FileRef[] = manifestMode
      ? agreements.map((agreement) => ({ id: agreement.box_file_id, name: agreement.filename }))
      : yield* box.listAllFiles();
    console.log(
      `contract scan: ${manifestMode ? `manifest mode (${documents.length} agreements)` : "full-scan mode"}`,
    );

    // One file failing must not fail the scan, but if nothing at all can be
    // processed the job should retry (batch item failure).
    const results: ScanFileResult[] = [];
    const errors: ScanError[] = [];
    for (const file of documents) {
      const outcome = yield* Effect.result(processFile(file, manifestMode, runId));
      if (Result.isFailure(outcome)) {
        console.error(`contract scan failed for file ${file.id}`, outcome.failure);
        errors.push(outcome.failure);
      } else {
        results.push(outcome.success);
      }
    }
    if (documents.length > 0 && errors.length === documents.length) {
      return yield* Effect.fail(errors[0]);
    }

    const contractsFound = results.filter((result) => result.isContract).length;
    const contractsStamped = results.filter((result) => result.stamped).length;
    const jobsEnqueued = results.filter((result) => result.enqueued).length;

    // Run summary artifact so every stage has an artifact link. Like the
    // notes/deck artifacts this goes through the artifact sink's bucket
    // gate; an S3 failure is fatal so runs never report a summary they
    // did not store.
    const summary = {
      runId,
      mode: manifestMode ? "manifest" : "full-scan",
      scanned: documents.length,
      contractsFound,
      contractsStamped,
      jobsEnqueued,
      contractFileIds: results.filter((result) => result.isContract).map((result) => result.fileId),
    };
    yield* artifacts.putArtifact(
      `artifacts/scan/${runId}/scan-summary.json`,
      JSON.stringify(summary, null, 2),
      "application/json",
    );
    console.log("contract scan summary:", JSON.stringify(summary));

    return {
      scanned: documents.length,
      contracts: summary.contractsFound,
      mode: summary.mode,
      contractsFound,
      contractsStamped,
      jobsEnqueued,
    };
  });

export const processJob = (
  job: ScanContractsJob,
  agreements: readonly ManifestDocument[] = selectAgreementFiles(loadManifest()),
) => {
  // One run id per scan pass: the trigger may set one, otherwise a fresh
  // uuid ties this scan to its downstream jobs, records and summary
  // artifact. Generated here so run tracking sees it too.
  const trackedJob: ScanContractsJob = { ...job, runId: job.runId ?? crypto.randomUUID() };
  return withRunTracking(
    {
      stage: "contractScanner",
      key: () => "scanner",
      artifactKeys: (tracked) =>
        tracked.runId === undefined ? [] : [`artifacts/scan/${tracked.runId}/scan-summary.json`],
    },
    trackedJob,
    scan(trackedJob, agreements),
  );
};

const withLiveServices = (job: ScanContractsJob) =>
  processJob(job).pipe(
    Effect.provideService(RunTrackerService, RunTrackerServiceLive),
    Effect.provideService(BoxService, BoxServiceLive),
    Effect.provideService(LlmService, LlmServiceLive),
    Effect.provideService(JobQueueService, JobQueueServiceLive),
    Effect.provideService(ArtifactsService, ArtifactsServiceLive),
  );

export const handler = createSqsWorker(parseJson, withLiveServices);
