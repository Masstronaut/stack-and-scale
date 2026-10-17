import { Effect } from "effect";
import type { SalesNotesJob } from "../jobs/messages.ts";
import { BoxService, BoxServiceStub } from "../services/box.ts";
import { LlmService, LlmServiceStub } from "../services/llm.ts";
import { createSqsWorker, parseJson } from "./runner.ts";

// Worker for issue #4: generate a sales notes document.
//
// input:  SalesNotesJob { contractFileId, relevantDocumentIds }
// output: sales notes for the account executive to use on the renewal call,
//         stored in box (and, once chaining is wired, a SalesSlidesJob
//         enqueued for the deck worker).

const processJob = (job: SalesNotesJob) =>
  Effect.gen(function* () {
    const box = yield* BoxService;
    const llm = yield* LlmService;

    // Load the contract and every relevant document for context.
    const contractText = yield* box.getFileText(job.contractFileId);
    const supportingDocs = [];
    for (const fileId of job.relevantDocumentIds) {
      supportingDocs.push(yield* box.getFileText(fileId));
    }

    // Work: the LLM figures out talking points and supporting data using the
    // provided documents to help an account executive successfully close the
    // sale for a contract renewal with the customer.
    // TODO(#4): replace the single prompt with a real notes structure -
    // customer background, renewal asks, value delivered, talking points per
    // ask with citations to the supporting documents. Consider map-reduce
    // (summarize each doc, then synthesize) to fit context limits.
    const notes = yield* llm.complete(
      `Write sales notes for this renewal call.\n\nContract:\n${contractText}\n\nSupporting documents:\n${supportingDocs.join("\n---\n")}`,
    );

    // Output: sales notes for the account executive, stored in box.
    // TODO(#4): name/desk the output consistently (e.g. "Sales notes -
    // <customer> - <contract>") and record the resulting file id somewhere
    // the deck worker (#5) can find it.
    const stored = yield* box.uploadFile("sales-notes.md", notes);

    return { salesNotesFileId: stored.fileId };
  }).pipe(
    // TODO: swap the stubs for live layers (real Box/LLM clients) once the
    // implementations exist.
    Effect.provideService(BoxService, BoxServiceStub),
    Effect.provideService(LlmService, LlmServiceStub),
  );

export const handler = createSqsWorker(parseJson, processJob);
