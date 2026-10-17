import { Effect, Result } from "effect";
import type { ScanContractsJob } from "../jobs/messages.ts";
import { BoxService, type FileRef } from "../services/box.ts";
import { BoxServiceLive } from "../services/box-live.ts";
import type { BoxError, LlmError, QueueError } from "../services/errors.ts";
import { loadManifest, selectAgreementFiles, type ManifestDocument } from "../lib/manifest.ts";
import { LlmService } from "../services/llm.ts";
import { LlmServiceLive } from "../services/llm-live.ts";
import { JobQueueService } from "../services/jobs.ts";
import { JobQueueServiceLive } from "../services/jobs-live.ts";
import { createSqsWorker, parseJson } from "./runner.ts";

// Worker for issue #2: find all contracts and add contract
// expiration/termination date as metadata in box.
//
// input:  ScanContractsJob (a full pass over box)
// output: `expirationDate`/`isContract` metadata stamped on every contract
//         and one RelatedDocumentsJob enqueued per contract for worker #3.
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

const processFile = (file: FileRef, knownContract: boolean) =>
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
      return { fileId: file.id, isContract: false as const };
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
    yield* queues.enqueue({ contractFileId: file.id });
    return { fileId: file.id, isContract: true as const, expirationDate };
  });

export const processJob = (
  _job: ScanContractsJob,
  agreements: readonly ManifestDocument[] = selectAgreementFiles(loadManifest()),
) =>
  Effect.gen(function* () {
    const box = yield* BoxService;

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
      const outcome = yield* Effect.result(processFile(file, manifestMode));
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

    return {
      scanned: documents.length,
      contracts: results.filter((result) => result.isContract).length,
      mode: manifestMode ? "manifest" : "full-scan",
    };
  });

const withLiveServices = (job: ScanContractsJob) =>
  processJob(job).pipe(
    Effect.provideService(BoxService, BoxServiceLive),
    Effect.provideService(LlmService, LlmServiceLive),
    Effect.provideService(JobQueueService, JobQueueServiceLive),
  );

export const handler = createSqsWorker(parseJson, withLiveServices);
