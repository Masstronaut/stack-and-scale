import type { SQSEvent, SQSHandler } from "aws-lambda";
import { Effect } from "effect";

/**
 * Adapt an Effect-based job processor into an SQS Lambda handler with partial
 * batch responses: only the messages whose effect failed are requeued, the
 * rest are acknowledged.
 */
export const createSqsWorker = <Job>(
  parseJob: (body: string) => Job,
  processJob: (job: Job) => Effect.Effect<unknown, unknown>,
): SQSHandler => {
  return async (event: SQSEvent) => {
    const batchItemFailures: { itemIdentifier: string }[] = [];

    for (const record of event.Records) {
      try {
        const job = parseJob(record.body);
        const result = await Effect.runPromise(processJob(job));
        console.log(`job ${record.messageId} ok:`, JSON.stringify(result));
      } catch (error) {
        console.error(`job ${record.messageId} failed`, error);
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }

    return { batchItemFailures };
  };
};

/**
 * Minimal JSON parse for queue messages.
 * TODO: validate with a schema (e.g. effect/Schema) so malformed payloads are
 * rejected explicitly instead of trusting the cast.
 */
export const parseJson = <Job>(body: string): Job => JSON.parse(body) as Job;
