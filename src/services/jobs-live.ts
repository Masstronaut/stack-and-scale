import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { Effect } from "effect";
import { Resource } from "sst";
import type { PipelineJob } from "../jobs/messages.ts";
import { QueueError } from "./errors.ts";
import type { JobQueueServiceShape } from "./jobs.ts";

const sqs = new SQSClient({});

// Jobs are discriminated by their distinct fields; check the most specific
// first (salesNotes carries digestKey, docDigest carries only the doc ids,
// and salesSlides carries every field the earlier stages have).
const queueUrl = (job: PipelineJob): string => {
  if ("salesNotesFileId" in job) return Resource.SalesSlidesQueue.url;
  if ("digestKey" in job) return Resource.SalesNotesQueue.url;
  if ("relevantDocumentIds" in job) return Resource.DocDigestQueue.url;
  if ("contractFileId" in job) return Resource.RelatedDocumentsQueue.url;
  return Resource.ContractScannerQueue.url;
};

export const JobQueueServiceLive: JobQueueServiceShape = {
  enqueue: (job) =>
    Effect.tryPromise({
      try: () =>
        sqs.send(
          new SendMessageCommand({ QueueUrl: queueUrl(job), MessageBody: JSON.stringify(job) }),
        ),
      catch: (cause) => new QueueError({ cause }),
    }),
};
