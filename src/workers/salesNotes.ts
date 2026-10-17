import { Data, Effect, Result } from "effect";
import type { SalesNotesJob } from "../jobs/messages.ts";
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

// Worker for issue #4: generate a sales notes document.
//
// input:  SalesNotesJob { contractFileId, relevantDocumentIds, digestKey?,
//         runId? } (from docDigest)
// output: grounded markdown sales notes uploaded to box as
//         "Sales Notes <customer>.md", the same notes stored as the run
//         artifact `artifacts/<contractFileId>/sales-notes.md`, plus one
//         SalesSlidesJob for worker #5 carrying the runId through.
//
// Primary context is the docDigest artifact when `digestKey` is set: the
// compact per-document digest blocks replace the full extracted texts and
// keep the prompt within LLM input-token limits (the related documents are
// NOT re-read in that case). An empty/absent digestKey (legacy jobs, or the
// artifact bucket gate was off) falls back to reading the documents
// directly, best-effort. A failed digest read falls back the same way.
//
// Manifest-first (see docs/dataset/WORKERS.md): the contract resolves by
// exact manifest id - unknown or customer-less ids fail so they dead-letter.
// The notes LLM call is the core output, so its failure is fatal to the job.
// Uploads are gated behind BOX_WRITE_ENABLED === "true"; with the gate off
// the notes are only logged and the slides job carries an empty
// salesNotesFileId, which worker #5 treats as "no notes file - derive
// talking points directly from contract + related docs".

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

Context documents:
${contextDocuments
  .map((document) => `[${document.label}]\n${document.text}`)
  .join(
    "\n\n",
  )}\n\nWrite grounded sales notes for the renewal call with this customer. Use exactly these sections: account context; current scope and renewal/notice conditions; customer priorities; value evidenced; delivery/adoption gaps; decisions required; open questions; proposed next steps; citations. In "value evidenced", recompute or quote exact usage figures from USAGECSV/USAGE content when present, showing inputs, formula, period and currency - never invent numbers. Cite every factual claim inline as [doc_type: filename]. Recommend expansion only when the evidence supports it; otherwise say which of continuation, adoption support or remediation is warranted. End with a citations section listing every document used.`;

const draft = (job: SalesNotesJob, boxManifest: BoxManifest) =>
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

    // Step 2: the contract text is the primary input - unreadable means no
    // notes, so that failure propagates.
    const contractText = yield* box.getFileText(contract.box_file_id);

    // Step 3: gather the context. With a digestKey the docDigest artifact is
    // the PRIMARY context and the related documents are NOT re-read (that is
    // the whole point - the full texts do not fit in the prompt). Empty key
    // or a failed digest read falls back to the legacy direct reads.
    let contextDocuments: ContextDocument[] = [
      { label: citationLabel(contract), text: contractText },
    ];
    const failedDocumentIds: string[] = [];
    let digestUsed = false;
    if (job.digestKey !== undefined && job.digestKey !== "") {
      const digest = yield* Effect.result(artifacts.getArtifact(job.digestKey));
      if (Result.isFailure(digest)) {
        console.warn(
          `sales notes: digest read failed for ${job.digestKey}, falling back to direct document reads`,
          digest.failure,
        );
      } else {
        contextDocuments = [
          ...contextDocuments,
          { label: "DOCUMENT DIGESTS", text: digest.success },
        ];
        digestUsed = true;
      }
    }
    if (!digestUsed) {
      for (const fileId of job.relevantDocumentIds) {
        const document = findDocumentByFileId(boxManifest, fileId);
        const label = document === undefined ? fallbackLabel(fileId) : citationLabel(document);
        const text = yield* Effect.result(box.getFileText(fileId));
        if (Result.isFailure(text)) {
          console.warn(`sales notes: skipping unreadable document ${fileId}`, text.failure);
          failedDocumentIds.push(fileId);
          continue;
        }
        contextDocuments = [...contextDocuments, { label, text: text.success }];
      }
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

    // Step 6: store the notes as the run artifact too - independent of the
    // box write gate so the run's artifact link exists either way (the
    // artifact sink has its own ARTIFACTS_BUCKET gate).
    yield* artifacts.putArtifact(
      `artifacts/${job.contractFileId}/sales-notes.md`,
      notes,
      "text/markdown",
    );

    // Step 7: hand everything to the deck worker; "" means no notes file.
    yield* queues.enqueue({
      contractFileId: job.contractFileId,
      relevantDocumentIds: job.relevantDocumentIds,
      salesNotesFileId,
      runId: job.runId,
    });

    return {
      contractFileId: job.contractFileId,
      customerId: contract.customer_id,
      customerName,
      digestKey: job.digestKey ?? "",
      digestUsed,
      notesFileName,
      salesNotesFileId,
      failedDocumentIds,
      notes,
    };
  });

export const processJob = (job: SalesNotesJob, boxManifest: BoxManifest = loadManifest()) =>
  withRunTracking(
    {
      stage: "salesNotes",
      key: (tracked) => `${tracked.contractFileId}/salesNotes`,
      artifactKeys: (tracked) => [`artifacts/${tracked.contractFileId}/sales-notes.md`],
    },
    job,
    draft(job, boxManifest),
  );

const withLiveServices = (job: SalesNotesJob) =>
  processJob(job).pipe(
    Effect.provideService(RunTrackerService, RunTrackerServiceLive),
    Effect.provideService(BoxService, BoxServiceLive),
    Effect.provideService(LlmService, LlmServiceLive),
    Effect.provideService(JobQueueService, JobQueueServiceLive),
    Effect.provideService(ArtifactsService, ArtifactsServiceLive),
  );

export const handler = createSqsWorker(parseJson, withLiveServices);
