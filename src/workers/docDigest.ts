import { Data, Effect, Result } from "effect";
import type { DocDigestJob } from "../jobs/messages.ts";
import { ArtifactsService } from "../services/artifacts.ts";
import { ArtifactsServiceLive } from "../services/artifacts-live.ts";
import { BoxService } from "../services/box.ts";
import { BoxServiceLive } from "../services/box-live.ts";
import {
  findDocumentByFileId,
  loadManifest,
  type BoxManifest,
  type ManifestDocument,
} from "../lib/manifest.ts";
import { RunTrackerService } from "../services/runs.ts";
import { RunTrackerServiceLive } from "../services/runs-live.ts";
import { LlmService } from "../services/llm.ts";
import { LlmServiceLive } from "../services/llm-live.ts";
import { JobQueueService } from "../services/jobs.ts";
import { JobQueueServiceLive } from "../services/jobs-live.ts";
import { createSqsWorker, parseJson, withRunTracking } from "./runner.ts";

// Worker stage between relatedDocuments and salesNotes: compress each
// related document into a compact digest block.
//
// input:  DocDigestJob { contractFileId, relevantDocumentIds, runId? }
//         (from relatedDocuments)
// output: one digest document per contract stored as the run artifact
//         `artifacts/<contractFileId>/doc-digest.md`, plus one SalesNotesJob
//         carrying the digest key for the sales notes worker.
//
// Why: salesNotes used to stuff the full extracted text of ~8 PDFs into one
// prompt and hit LLM input-token limits (truncation mid-prompt loses
// information). Here EACH document gets its own small LLM call that extracts
// the renewal-relevant facts (asks, promises, negotiation history, exact
// usage figures, release/roadmap/pricing facts), cited line-by-line, so the
// notes prompt stays small and complete.
//
// Manifest-first (see docs/dataset/WORKERS.md): the contract resolves by
// exact manifest id - unknown or customer-less ids fail so they dead-letter.
// Per-doc failures (unreadable or extraction failed) are logged and skipped;
// only when EVERY document fails does the job fail so it dead-letters. The
// artifact write is bucket-gated like every artifact: with ARTIFACTS_BUCKET
// unset nothing can be handed off, so the notes job gets an empty digestKey
// and falls back to reading the documents directly.

/** Raised when contractFileId has no single customer-scoped manifest match. */
class ContractResolutionError extends Data.TaggedError("ContractResolutionError")<{
  readonly contractFileId: string;
}> {}

interface DigestBlock {
  readonly fileId: string;
  readonly label: string;
  readonly block: string;
}

// Soft cap enforced defensively: the LLM is asked for ~1500 characters, an
// overlong reply is cut so the notes prompt cannot blow up anyway.
const MAX_BLOCK_CHARS = 1500;

// "[doc_type: filename]" - the citation format every digest line carries.
const citationLabel = (document: ManifestDocument): string =>
  `${document.document_type}: ${document.filename}`;

// Defensive label for ids missing from the manifest (worker #3 only emits
// manifest ids, so this should not happen in practice).
const fallbackLabel = (fileId: string): string => `document: ${fileId}`;

const digestPrompt = (customerName: string, label: string, text: string) =>
  `Customer: ${customerName}

Document:
[${label}]
${text}

Extract the renewal-relevant facts from this document into ONE compact markdown block of at most ~1500 characters:
- the customer's asks/requests and open questions
- promises made: obligations, deliverables, commitments
- negotiation history highlights (dates, positions, outcomes)
- usage metrics: quote exact figures, formula inputs, period and currency when present - never invent numbers
- for shared product knowledge documents: only the release/roadmap/pricing facts that could matter to this customer
Every line must carry its citation as [${label}]. Reply with the markdown block only, no preamble.`;

const clampBlock = (block: string): string =>
  block.length <= MAX_BLOCK_CHARS ? block : `${block.slice(0, MAX_BLOCK_CHARS)}\n[truncated]`;

const digestDocument = (
  customerId: string,
  customerName: string,
  contract: ManifestDocument,
  blocks: readonly DigestBlock[],
): string => {
  const sections = blocks
    .map((entry) => `## ${entry.label} (file id ${entry.fileId})\n\n${entry.block}`)
    .join("\n\n");
  return `# Document digests - ${customerName} (${customerId})

Contract: ${citationLabel(contract)} (file id ${contract.box_file_id})
Generated: ${new Date().toISOString()}

${sections}`;
};

const digest = (job: DocDigestJob, boxManifest: BoxManifest) =>
  Effect.gen(function* () {
    const box = yield* BoxService;
    const llm = yield* LlmService;
    const queues = yield* JobQueueService;
    const artifacts = yield* ArtifactsService;

    // Step 1: resolve the contract by exact manifest id. Unknown or
    // customer-less (shared) ids fail the job so they dead-letter.
    const contract = findDocumentByFileId(boxManifest, job.contractFileId);
    if (contract === undefined || contract.customer_id === null) {
      return yield* Effect.fail(
        new ContractResolutionError({ contractFileId: job.contractFileId }),
      );
    }
    const customerName =
      boxManifest.customers.find((customer) => customer.customer_id === contract.customer_id)
        ?.customer_name ?? job.contractFileId;

    // Step 2: one read + one extraction call per document. Any single
    // failure (unreadable document or failed extraction) is logged and
    // skipped so the digest keeps whatever was understood.
    const blocks: DigestBlock[] = [];
    const failedDocumentIds: string[] = [];
    const errors: unknown[] = [];
    for (const fileId of job.relevantDocumentIds) {
      const document = findDocumentByFileId(boxManifest, fileId);
      const label = document === undefined ? fallbackLabel(fileId) : citationLabel(document);
      const text = yield* Effect.result(box.getFileText(fileId));
      if (Result.isFailure(text)) {
        console.warn(`doc digest: skipping unreadable document ${fileId}`, text.failure);
        failedDocumentIds.push(fileId);
        errors.push(text.failure);
        continue;
      }
      const block = yield* Effect.result(
        Effect.map(llm.complete(digestPrompt(customerName, label, text.success)), clampBlock),
      );
      if (Result.isFailure(block)) {
        console.warn(`doc digest: extraction failed for document ${fileId}`, block.failure);
        failedDocumentIds.push(fileId);
        errors.push(block.failure);
        continue;
      }
      blocks.push({ fileId, label, block: block.success });
    }

    // Step 3: only a total failure dead-letters the job - the pipeline can
    // still lose single documents without stopping the whole run.
    if (job.relevantDocumentIds.length > 0 && blocks.length === 0) {
      return yield* Effect.fail(errors[0]);
    }

    // Step 4: store the digest artifact. With the bucket gate off nothing
    // can be handed over, so the notes job gets an empty digestKey and
    // falls back to its legacy direct-read path.
    let digestKey = "";
    let digest = "";
    if (blocks.length > 0) {
      digest = digestDocument(contract.customer_id, customerName, contract, blocks);
      const stored = yield* artifacts.putArtifact(
        `artifacts/${job.contractFileId}/doc-digest.md`,
        digest,
        "text/markdown",
      );
      digestKey = stored.bucket === "" ? "" : stored.key;
      console.log(
        `doc digest: ${blocks.length} blocks for ${customerName} (${failedDocumentIds.length} failed), artifact ${stored.key} bucket ${stored.bucket}`,
      );
    }

    // Step 5: hand the digest key to the sales notes worker.
    yield* queues.enqueue({
      contractFileId: job.contractFileId,
      relevantDocumentIds: job.relevantDocumentIds,
      digestKey,
      runId: job.runId,
    });

    return {
      contractFileId: job.contractFileId,
      customerId: contract.customer_id,
      customerName,
      digestKey,
      digestedDocumentIds: blocks.map((entry) => entry.fileId),
      failedDocumentIds,
      digest,
    };
  });

export const processJob = (job: DocDigestJob, boxManifest: BoxManifest = loadManifest()) =>
  withRunTracking(
    {
      stage: "docDigest",
      key: (tracked) => `${tracked.contractFileId}/docDigest`,
      artifactKeys: (tracked) => [`artifacts/${tracked.contractFileId}/doc-digest.md`],
    },
    job,
    digest(job, boxManifest),
  );

const withLiveServices = (job: DocDigestJob) =>
  processJob(job).pipe(
    Effect.provideService(RunTrackerService, RunTrackerServiceLive),
    Effect.provideService(BoxService, BoxServiceLive),
    Effect.provideService(LlmService, LlmServiceLive),
    Effect.provideService(JobQueueService, JobQueueServiceLive),
    Effect.provideService(ArtifactsService, ArtifactsServiceLive),
  );

export const handler = createSqsWorker(parseJson, withLiveServices);
