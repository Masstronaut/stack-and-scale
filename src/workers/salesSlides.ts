import { Effect } from "effect";
import type { SalesSlidesJob } from "../jobs/messages.ts";
import { BoxService, BoxServiceStub } from "../services/box.ts";
import { LlmService, LlmServiceStub } from "../services/llm.ts";
import { createSqsWorker, parseJson } from "./runner.ts";

// Worker for issue #5: generate the sales conversation slides.
//
// input:  SalesSlidesJob { contractFileId, relevantDocumentIds,
//         salesNotesFileId }
// output: sales deck the AE will use to close the renewal, stored in box.

const processJob = (job: SalesSlidesJob) =>
  Effect.gen(function* () {
    const box = yield* BoxService;
    const llm = yield* LlmService;

    // Gather the inputs: the contract, the relevant documents from worker
    // #3, and the sales notes from worker #4.
    const contractText = yield* box.getFileText(job.contractFileId);
    const notes = yield* box.getFileText(job.salesNotesFileId);
    const supportingDocs = [];
    for (const fileId of job.relevantDocumentIds) {
      supportingDocs.push(yield* box.getFileText(fileId));
    }

    // Work: put together a compelling pitch for the AE to walk through with
    // the customer. The deck should cover:
    // - help the customer figure out the value they are getting already
    // - talking points to help the customer get more value out of their
    //   existing contract
    // - new and upcoming capabilities to help the customer get more value
    //   from the product
    // TODO(#5): generate a structured slide outline (title, bullets, speaker
    // notes, source doc references) instead of free-form text.
    const deckContent = yield* llm.complete(
      `Create the sales deck content.\n\nContract:\n${contractText}\n\nSales notes:\n${notes}\n\nSupporting documents:\n${supportingDocs.join("\n---\n")}`,
    );

    // Output: sales deck (slidev, pdf, html, whatever) stored in box.
    // TODO(#5): render the content to an actual artifact - e.g. slidev
    // markdown -> export to pdf/html in a Lambda layer, or store the slidev
    // source and render on demand. Pick a format and record it in metadata.
    const stored = yield* box.uploadFile("sales-deck.md", deckContent);

    return { salesDeckFileId: stored.fileId };
  }).pipe(
    // TODO: swap the stubs for live layers (real Box/LLM clients) once the
    // implementations exist.
    Effect.provideService(BoxService, BoxServiceStub),
    Effect.provideService(LlmService, LlmServiceStub),
  );

export const handler = createSqsWorker(parseJson, processJob);
