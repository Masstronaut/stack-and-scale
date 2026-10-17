import { Effect } from "effect";
import type { RelatedDocumentsJob } from "../jobs/messages.ts";
import { BoxService, BoxServiceStub } from "../services/box.ts";
import { LlmService, LlmServiceStub } from "../services/llm.ts";
import { createSqsWorker, parseJson } from "./runner.ts";

// Worker for issue #3: identify documents related to a customer contract.
//
// input:  RelatedDocumentsJob { contractFileId }
// output: list of internal documents relevant to the customer & contract,
//         passed on to the sales notes worker (and, once decided, persisted
//         somewhere durable - box metadata or a result file).

const processJob = (job: RelatedDocumentsJob) =>
  Effect.gen(function* () {
    const box = yield* BoxService;
    const llm = yield* LlmService;

    // Step 1: LLM read through the contract to identify the customer and any
    // core asks from them or promises made to them.
    // TODO(#3): extract a structured customer profile ({ customer,
    // asks[], promises[] }) rather than free text; include the contract
    // metadata from worker #2 if present.
    const contractText = yield* box.getFileText(job.contractFileId);
    const customerProfile = yield* llm.complete(
      `Identify the customer and their core asks/promises:\n\n${contractText}`,
    );

    // Step 2: scan box for other documents related to the customer, their
    // asks, promises made to them, and any internal roadmaps or plans with
    // info relevant to the customer.
    // TODO(#3): don't rely on a single pass - search box by customer name and
    // per-ask keywords, then rank with the LLM. Cap document sizes / use
    // summaries to stay within context limits.
    const candidates = yield* box.listAllFiles();

    // Step 3: generate the list of all the relevant documents stored in box.
    // TODO(#3): have the LLM justify each inclusion (relevance note) - the
    // AE will want to know why a document made the cut.
    const reply = yield* llm.complete(
      `Which of these documents are relevant?\n\n${customerProfile}\n\n${JSON.stringify(candidates)}`,
    );
    const relevantDocumentIds = candidates.map((candidate) => candidate.id);

    return {
      contractFileId: job.contractFileId,
      relevantDocumentIds,
      llmReply: reply,
    };
  }).pipe(
    // TODO: swap the stubs for live layers (real Box/LLM clients) once the
    // implementations exist.
    Effect.provideService(BoxService, BoxServiceStub),
    Effect.provideService(LlmService, LlmServiceStub),
  );

export const handler = createSqsWorker(parseJson, processJob);
