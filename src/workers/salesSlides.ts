import { Data, Effect, Result } from "effect";
import type { SalesSlidesJob } from "../jobs/messages.ts";
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
import { createSqsWorker, parseJson, withRunTracking } from "./runner.ts";

// Worker for issue #5: generate the sales conversation deck.
//
// input:  SalesSlidesJob { contractFileId, relevantDocumentIds,
//         salesNotesFileId, runId? } (from worker #4; the runId closes out
//         the run started by worker #2)
// output: a self-contained static HTML slide deck uploaded to box as
//         "Sales Deck <customer>.html" (gated on BOX_WRITE_ENABLED) and
//         written to the artifact sink as
//         "artifacts/<contractFileId>/sales-deck.html".
//
// Manifest-first (see docs/dataset/WORKERS.md): the contract resolves by
// exact manifest id - unknown or customer-less ids fail so they dead-letter.
// Related documents are read best-effort like worker #4: an unreadable
// document is logged and skipped so the deck stays grounded in what WAS read.
// An empty salesNotesFileId is worker #4's write-gate degraded mode: the
// talking points are then derived straight from contract + related docs.
// The deck LLM call is the core output, so its failure is fatal. The box
// upload and the artifact write are independent gates (BOX_WRITE_ENABLED vs
// ARTIFACTS_BUCKET), so a deck can land in one sink and not the other.

/** Raised when contractFileId has no single customer-scoped manifest match. */
class ContractResolutionError extends Data.TaggedError("ContractResolutionError")<{
  readonly contractFileId: string;
}> {}

interface ContextDocument {
  /** Citation label, e.g. "PROFILE: profile.pdf" or "SALES NOTES". */
  readonly label: string;
  readonly text: string;
}

const writesEnabled = () => process.env.BOX_WRITE_ENABLED === "true";

// "[doc_type: filename]" - the citation format the deck prompt asks for.
const citationLabel = (document: ManifestDocument): string =>
  `${document.document_type}: ${document.filename}`;

// Defensive label for ids missing from the manifest (worker #3 only emits
// manifest ids, so this should not happen in practice).
const fallbackLabel = (fileId: string): string => `document: ${fileId}`;

const deckPrompt = (
  customerName: string,
  notes: ContextDocument | undefined,
  contract: ContextDocument,
  contextDocuments: readonly ContextDocument[],
) =>
  `Customer: ${customerName}

Primary contract:
[${contract.label}]
${contract.text}${
    notes === undefined
      ? ""
      : `\n\nSALES NOTES (primary talking-points source, drafted earlier for this account):
[SALES NOTES]
${notes.text}`
  }

Related documents:
${contextDocuments
  .map((document) => `[${document.label}]\n${document.text}`)
  .join(
    "\n\n",
  )}\n\nProduce a compelling renewal-conversation slide deck for the AE to walk ${customerName} through. Reply with ONE complete, self-contained static HTML document:
- inline CSS only: no JavaScript, no frameworks, no external assets - it must open and be readable with zero tooling;
- one slide per <section class="slide">, each with an <h2> heading and short bullets;
- slides in this order: a title slide (customer, renewal context), value realized today (recompute or quote exact usage figures from USAGECSV/USAGE content when present, showing inputs, formula, period and currency - never invent numbers), talking points to help the customer get more value out of their existing contract, new and upcoming capabilities to help the customer get more value from the product (grounded in ROADMAP/RELEASE_NOTES/PRODUCT_KNOWLEDGE documents when present), and next steps;
- cite every factual claim inline as [doc_type: filename];
- reply with the HTML document only, starting with <!DOCTYPE html>.`;

const build = (job: SalesSlidesJob, boxManifest: BoxManifest) =>
  Effect.gen(function* () {
    const box = yield* BoxService;
    const llm = yield* LlmService;
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
    // deck, so that failure propagates.
    const contractText = yield* box.getFileText(contract.box_file_id);

    // Step 3: read the related documents best-effort. One unreadable
    // document is logged and skipped; the deck stays grounded in what WAS
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
        console.warn(`sales slides: skipping unreadable document ${fileId}`, text.failure);
        failedDocumentIds.push(fileId);
        continue;
      }
      contextDocuments.push({ label, text: text.success });
    }

    // Step 4: the notes from worker #4 are the primary talking-points
    // source when a file id was handed over. An empty id is the write-gate
    // degraded mode (see salesNotes): derive talking points from the
    // contract + related docs instead. A failed read falls back the same
    // way rather than dead-lettering on a non-essential input.
    let notes: ContextDocument | undefined;
    if (job.salesNotesFileId === "") {
      console.log(
        "sales slides: no notes file id (worker #4 write-gate degraded mode), deriving talking points from contract + related docs",
      );
    } else {
      const notesText = yield* Effect.result(box.getFileText(job.salesNotesFileId));
      if (Result.isFailure(notesText)) {
        console.warn(
          "sales slides: notes read failed, deriving talking points from contract + related docs",
          notesText.failure,
        );
      } else {
        notes = { label: "SALES NOTES", text: notesText.success };
      }
    }

    // Step 5: draft the deck in one LLM call. Failure here is fatal - the
    // deck is the core output.
    const deck = yield* llm.complete(
      deckPrompt(customerName, notes, contextDocuments[0]!, contextDocuments.slice(1)),
    );
    const slideCount = (deck.match(/<section\b/g) ?? []).length;

    // Step 6: upload the deck to box, gated behind BOX_WRITE_ENABLED. With
    // the gate off the deck is only logged.
    const deckFileName = `Sales Deck ${customerName}.html`;
    let deckFileId = "";
    if (writesEnabled()) {
      deckFileId = (yield* box.uploadFile(deckFileName, deck)).fileId;
    } else {
      console.log(`box write disabled, would upload ${deckFileName}:`, deck);
    }

    // Step 7: the artifact sink is an independent gate (ARTIFACTS_BUCKET,
    // see ArtifactsServiceLive) - a write is attempted either way.
    const artifact = yield* artifacts.putArtifact(
      `artifacts/${job.contractFileId}/sales-deck.html`,
      deck,
      "text/html",
    );

    // Run summary (also captured in the run record's output).
    console.log(
      "slides run:",
      JSON.stringify({
        customerId: contract.customer_id,
        customerName,
        slides: slideCount,
        artifactKey: artifact.key,
        artifactBucket: artifact.bucket,
        boxFileId: deckFileId,
        notesIncluded: notes !== undefined,
        failedDocumentIds,
      }),
    );

    return {
      contractFileId: job.contractFileId,
      customerId: contract.customer_id,
      customerName,
      deckFileName,
      deckFileId,
      artifactKey: artifact.key,
      artifactBucket: artifact.bucket,
      failedDocumentIds,
      slides: slideCount,
      deck,
    };
  });

export const processJob = (job: SalesSlidesJob, boxManifest: BoxManifest = loadManifest()) =>
  withRunTracking(
    {
      stage: "salesSlides",
      key: (tracked) => `${tracked.contractFileId}/salesSlides`,
      artifactKeys: (tracked) => [`artifacts/${tracked.contractFileId}/sales-deck.html`],
    },
    job,
    build(job, boxManifest),
  );

const withLiveServices = (job: SalesSlidesJob) =>
  processJob(job).pipe(
    Effect.provideService(RunTrackerService, RunTrackerServiceLive),
    Effect.provideService(BoxService, BoxServiceLive),
    Effect.provideService(LlmService, LlmServiceLive),
    Effect.provideService(ArtifactsService, ArtifactsServiceLive),
  );

export const handler = createSqsWorker(parseJson, withLiveServices);
