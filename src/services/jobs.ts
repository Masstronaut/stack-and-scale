import { Context, Effect } from "effect";
import type { PipelineJob } from "../jobs/messages.ts";
import type { QueueError } from "./errors.ts";

export interface JobQueueServiceShape {
  /** Enqueue a downstream pipeline job on the queue for its worker. */
  readonly enqueue: (job: PipelineJob) => Effect.Effect<void, QueueError>;
}

export class JobQueueService extends Context.Service<JobQueueService, JobQueueServiceShape>()(
  "JobQueueService",
) {}

/**
 * Stub implementation. Real version should send the job JSON to the SQS queue
 * of the worker that handles it (`@aws-sdk/client-sqs` SendMessage):
 * - ScanContractsJob     -> ContractScannerQueue
 * - RelatedDocumentsJob  -> RelatedDocumentsQueue
 * - SalesNotesJob        -> SalesNotesQueue
 * - SalesSlidesJob       -> SalesSlidesQueue
 * Queue URLs come from the `Resource.<QueueName>.url` links once the queues
 * are linked to the worker functions in `sst.config.ts`.
 */
export const JobQueueServiceStub: JobQueueServiceShape = {
  enqueue: () => Effect.void,
};
