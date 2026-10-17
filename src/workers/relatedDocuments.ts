import { Data, Effect, Result } from "effect";
import type { RelatedDocumentsJob } from "../jobs/messages.ts";
import { BoxService } from "../services/box.ts";
import { BoxServiceLive } from "../services/box-live.ts";
import {
  findDocumentByFileId,
  loadManifest,
  selectCustomerFiles,
  selectSharedKnowledgeFiles,
  type BoxManifest,
  type ManifestDocument,
} from "../lib/manifest.ts";
import { LlmService } from "../services/llm.ts";
import { LlmServiceLive } from "../services/llm-live.ts";
import { JobQueueService } from "../services/jobs.ts";
import { JobQueueServiceLive } from "../services/jobs-live.ts";
import { createSqsWorker, parseJson } from "./runner.ts";

// Worker for issue #3: identify documents related to a customer contract.
//
// input:  RelatedDocumentsJob { contractFileId } (from worker #2)
// output: one SalesNotesJob { contractFileId, relevantDocumentIds } for
//         worker #4; the queue message is the only artifact (no box writes).
//
// Manifest-first (see docs/dataset/WORKERS.md): the contract is resolved by
// exact manifest id - a CUAD original resolves to its mapped customer with
// provenance retained, unknown ids fail so they dead-letter. The baseline
// related set is that customer's seven non-agreement files with
// deterministic per-type reasons. The LLM only chooses among the shared
// Product Knowledge references and is best-effort: on failure the job
// continues with the baseline set alone (no LLM key required).

/** Raised when contractFileId has no single customer-scoped manifest match. */
class ContractResolutionError extends Data.TaggedError("ContractResolutionError")<{
  readonly contractFileId: string;
}> {}

// Deterministic per-type justification for each baseline file (WORKERS.md:
// PROFILE provides identity, EMAILS/HISTORY asks & negotiation context, ...).
const BASELINE_REASONS: Readonly<Record<string, string>> = {
  PROFILE: "customer identity & context",
  EMAILS: "customer correspondence & asks",
  REQUESTS: "feature request status",
  HISTORY: "account & negotiation history",
  USAGECSV: "raw product usage observations",
  USAGE: "product usage report",
  OBLIGATIONS: "delivery & service obligations",
};

const baselineReason = (document: ManifestDocument): string =>
  `${document.document_type}: ${BASELINE_REASONS[document.document_type] ?? "related customer document"}`;

/**
 * The customer's files minus the primary contract: the customer's AGREEMENT
 * is the primary input and the historical CUAD original is source evidence
 * added only on demand (WORKERS.md), so the baseline is the seven supporting
 * per-account files.
 */
const selectBaselineFiles = (
  boxManifest: BoxManifest,
  customerId: string,
  contract: ManifestDocument,
): readonly ManifestDocument[] =>
  selectCustomerFiles(boxManifest, customerId).filter(
    (document) =>
      document.document_id !== contract.document_id &&
      document.document_type !== "AGREEMENT" &&
      document.document_type !== "CUAD_ORIGINAL",
  );

const sharedSelectionPrompt = (
  customerName: string,
  contractText: string,
  shared: readonly ManifestDocument[],
) =>
  `Customer: ${customerName}\n\nContract text:\n${contractText}\n\nShared product knowledge documents:\n${shared
    .map((document) => `- file id ${document.box_file_id}: ${document.filename}`)
    .join(
      "\n",
    )}\n\nWhich of these shared documents are relevant to this contract's offering? Reply with only the relevant file ids, one per line.`;

/**
 * Keep only allowlisted shared file ids, in manifest order - the LLM never
 * widens the candidate set.
 */
const parseSelectedIds = (reply: string, allowed: readonly string[]): readonly string[] => {
  const tokens = new Set(reply.split(/[^A-Za-z0-9_-]+/));
  return allowed.filter((fileId) => tokens.has(fileId));
};

/** Which shared Product Knowledge offerings matter for THIS contract. */
const selectSharedFileIds = (
  contract: ManifestDocument,
  customerName: string,
  shared: readonly ManifestDocument[],
) =>
  Effect.gen(function* () {
    const box = yield* BoxService;
    const llm = yield* LlmService;
    const contractText = yield* box.getFileText(contract.box_file_id);
    const reply = yield* llm.complete(sharedSelectionPrompt(customerName, contractText, shared));
    return parseSelectedIds(
      reply,
      shared.map((document) => document.box_file_id),
    );
  });

export const processJob = (job: RelatedDocumentsJob, boxManifest: BoxManifest = loadManifest()) =>
  Effect.gen(function* () {
    const queues = yield* JobQueueService;

    // Step 1: resolve the contract by exact manifest id. Unknown, ambiguous
    // or customer-less (shared) ids fail the job so they dead-letter.
    const contract = findDocumentByFileId(boxManifest, job.contractFileId);
    if (contract === undefined || contract.customer_id === null) {
      return yield* Effect.fail(
        new ContractResolutionError({ contractFileId: job.contractFileId }),
      );
    }
    const customerName =
      boxManifest.customers.find((customer) => customer.customer_id === contract.customer_id)
        ?.customer_name ?? contract.customer_id;

    // Step 2: baseline set - this customer's files only, never another
    // customer's documents by keyword similarity.
    const baseline = selectBaselineFiles(boxManifest, contract.customer_id, contract).map(
      (document) => ({
        fileId: document.box_file_id,
        reason: baselineReason(document),
      }),
    );
    console.log(
      `related documents: contract ${contract.box_file_id} (${contract.document_type}, provenance ${contract.provenance}) for ${customerName}: ${baseline.length} baseline files`,
    );

    // Step 3: shared Product Knowledge selection, best-effort - any failure
    // here only shrinks the set back to the baseline.
    const shared = selectSharedKnowledgeFiles(boxManifest);
    let sharedIds: readonly string[] = [];
    const selected = yield* Effect.result(selectSharedFileIds(contract, customerName, shared));
    if (Result.isFailure(selected)) {
      console.warn(
        "related documents: shared selection failed, using baseline only",
        selected.failure,
      );
    } else {
      sharedIds = selected.success;
    }

    // Step 4: hand the union to the sales notes worker.
    const relevantDocumentIds = [...baseline.map((entry) => entry.fileId), ...sharedIds];
    yield* queues.enqueue({ contractFileId: job.contractFileId, relevantDocumentIds });

    return {
      contractFileId: job.contractFileId,
      customerId: contract.customer_id,
      contractProvenance: contract.provenance,
      baseline,
      sharedDocumentIds: sharedIds,
      relevantDocumentIds,
    };
  });

const withLiveServices = (job: RelatedDocumentsJob) =>
  processJob(job).pipe(
    Effect.provideService(BoxService, BoxServiceLive),
    Effect.provideService(LlmService, LlmServiceLive),
    Effect.provideService(JobQueueService, JobQueueServiceLive),
  );

export const handler = createSqsWorker(parseJson, withLiveServices);
