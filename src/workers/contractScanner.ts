import { Effect } from "effect";
import type { ScanContractsJob } from "../jobs/messages.ts";
import { BoxService, BoxServiceStub } from "../services/box.ts";
import { LlmService, LlmServiceStub } from "../services/llm.ts";
import { createSqsWorker, parseJson } from "./runner.ts";

// Worker for issue #2: find all contracts and add contract
// expiration/termination date as metadata in box.
//
// input:  ScanContractsJob (a full pass over box)
// output: `expirationDate` metadata stamped on every contract, and (once
//         chaining is wired) one RelatedDocumentsJob per contract found.

const processJob = (_job: ScanContractsJob) =>
  Effect.gen(function* () {
    const box = yield* BoxService;
    const llm = yield* LlmService;

    // Step 1: look through all documents in box.
    const documents = yield* box.listAllFiles();

    for (const document of documents) {
      const text = yield* box.getFileText(document.id);

      // Step 2: identify which documents are contracts.
      // TODO(#2): replace the naive yes/no prompt with a proper classifier
      // (structured output). Cache the verdict in box metadata so repeat
      // scans don't re-classify everything. Consider running steps 3-4 as a
      // separate sub-job per contract (the issue wording suggests this) so
      // one contract failing doesn't fail the whole scan.
      const isContract = yield* llm.complete(
        `Is the following document a contract? Answer yes or no.\n\n${text}`,
      );
      if (isContract.trim().toLowerCase() !== "yes") continue;

      // Step 3: for each contract, have the LLM determine the contract
      // expiration/termination date.
      // TODO(#2): prompt for structured output ({ expirationDate,
      // terminationNoticePeriod, autoRenew }) instead of stuffing the raw
      // reply into metadata. Handle "not found" explicitly.
      const expiration = yield* llm.complete(
        `What is the expiration/termination date of this contract?\n\n${text}`,
      );

      // Step 4: update the contract metadata in box to include the
      // expiration date.
      // TODO(#2): write through the box metadata template (see BoxService
      // notes); skip the write when the date is unchanged. Then enqueue a
      // RelatedDocumentsJob for this contract via JobQueueService.
      yield* box.updateFileMetadata(document.id, {
        expirationDate: expiration,
      });
    }
  }).pipe(
    // TODO: swap the stubs for live layers (real Box/LLM clients) once the
    // implementations exist.
    Effect.provideService(BoxService, BoxServiceStub),
    Effect.provideService(LlmService, LlmServiceStub),
  );

export const handler = createSqsWorker(parseJson, processJob);
