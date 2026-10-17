import { Data, Effect, Result } from "effect";
import type { SalesNotesJob } from "../jobs/messages.ts";
import { BoxService } from "../services/box.ts";
import { BoxServiceLive } from "../services/box-live.ts";
import {
  findDocumentByFileId,
  loadManifest,
  type BoxManifest,
  type ManifestDocument,
} from "../lib/manifest.ts";
import { LlmService } from "../services/llm.ts";
import { LlmServiceLive } from "../services/llm-live.ts";
import { JobQueueService } from "../services/jobs.ts";
import { JobQueueServiceLive } from "../services/jobs-live.ts";
import { createSqsWorker, parseJson } from "./runner.ts";

// Worker for issue #4: generate a sales notes document.
//
// input:  SalesNotesJob { contractFileId, relevantDocumentIds } (from worker #3)
// output: grounded markdown sales notes uploaded to box as
//         "Sales Notes <customer>.md", plus one SalesSlidesJob for worker #5.
//
// Manifest-first (see docs/dataset/WORKERS.md): the contract resolves by
// exact manifest id - unknown or customer-less ids fail so they dead-letter.
// Related documents are read best-effort: an unreadable document is logged
// and skipped so the notes stay grounded in what WAS read. The notes LLM
// call is the core output, so its failure is fatal to the job. Uploads are
// gated behind BOX_WRITE_ENABLED === "true"; with the gate off the notes are
// only logged and the slides job carries an empty salesNotesFileId, which
// worker #5 treats as "no notes file - derive talking points directly from
// contract + related docs".

/** Raised when contractFileId has no single customer-scoped manifest match. */
class ContractResolutionError extends Data.TaggedError("ContractResolutionError")<{
  readonly contractFileId: string;
}> {}

interface ContextDocument {
  /** Citation label, e.g. "PROFILE: profile.pdf". */
  readonly label: string;
  readonly text: string;
}

const writesEnabled = () => process.env.BOX_WRITE_ENABLED === "true";

// "[doc_type: filename]" - the citation format the notes prompt asks for.
const citationLabel = (document: ManifestDocument): string =>
  `${document.document_type}: ${document.filename}`;

// Defensive label for ids missing from the manifest (worker #3 only emits
// manifest ids, so this should not happen in practice).
const fallbackLabel = (fileId: string): string => `document: ${fileId}`;

const notesPrompt = (
  customerName: string,
  contract: ContextDocument,
  contextDocuments: readonly ContextDocument[],
) =>
  `Customer: ${customerName}

Primary contract:
[${contract.label}]
${contract.text}

Related documents:
${contextDocuments
  .map((document) => `[${document.label}]\n${document.text}`)
  .join(
    "\n\n",
  )}\n\nWrite grounded sales notes for the renewal call with this customer. Use exactly these sections: account context; current scope and renewal/notice conditions; customer priorities; value evidenced; delivery/adoption gaps; decisions required; open questions; proposed next steps; citations. In "value evidenced", recompute or quote exact usage figures from USAGECSV/USAGE content when present, showing inputs, formula, period and currency - never invent numbers. Cite every factual claim inline as [doc_type: filename]. Recommend expansion only when the evidence supports it; otherwise say which of continuation, adoption support or remediation is warranted. End with a citations section listing every document used.`;

export const processJob = (job: SalesNotesJob, boxManifest: BoxManifest = loadManifest()) =>
  Effect.gen(function* () {
    const box = yield* BoxService;
    const llm = yield* LlmService;
    const queues = yield* JobQueueService;

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

    // Step 2: the contract text is the primary input - unreadable means no
    // notes, so that failure propagates.
    const contractText = yield* box.getFileText(contract.box_file_id);

    // Step 3: read the related documents best-effort. One unreadable
    // document is logged and skipped; the notes stay grounded in what WAS
    // read.
    const contextDocuments: ContextDocument[] = [
      { label: citationLabel(contract), text: contractText },
    ];
    const failedDocumentIds: string[] = [];
    for (const fileId of job.relevantDocumentIds) {
      const document = findDocumentByFileId(boxManifest, fileId);
      const label = document === undefined ? fallbackLabel(fileId) : citationLabel(document);
      const text = yield* Effect.result(box.getFileText(fileId));
      if (Result.isFailure(text)) {
        console.warn(`sales notes: skipping unreadable document ${fileId}`, text.failure);
        failedDocumentIds.push(fileId);
        continue;
      }
      contextDocuments.push({ label, text: text.success });
    }

    // Step 4: draft the notes in one LLM call. Failure here is fatal - the
    // notes are the core output.
    const notes = yield* llm.complete(
      notesPrompt(customerName, contextDocuments[0]!, contextDocuments.slice(1)),
    );

    // Step 5: upload as markdown, gated behind BOX_WRITE_ENABLED. With the
    // gate off the notes are only logged and the slides job gets "".
    const notesFileName = `Sales Notes ${customerName}.md`;
    let salesNotesFileId = "";
    if (writesEnabled()) {
      salesNotesFileId = (yield* box.uploadFile(notesFileName, notes)).fileId;
    } else {
      console.log(`box write disabled, would upload ${notesFileName}:`, notes);
    }

    // Step 6: hand everything to the deck worker; "" means no notes file.
    yield* queues.enqueue({
      contractFileId: job.contractFileId,
      relevantDocumentIds: job.relevantDocumentIds,
      salesNotesFileId,
    });

    return {
      contractFileId: job.contractFileId,
      customerId: contract.customer_id,
      customerName,
      notesFileName,
      salesNotesFileId,
      failedDocumentIds,
      notes,
    };
  });

const withLiveServices = (job: SalesNotesJob) =>
  processJob(job).pipe(
    Effect.provideService(BoxService, BoxServiceLive),
    Effect.provideService(LlmService, LlmServiceLive),
    Effect.provideService(JobQueueService, JobQueueServiceLive),
  );

export const handler = createSqsWorker(parseJson, withLiveServices);
