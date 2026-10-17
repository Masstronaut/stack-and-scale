import { describe, expect, it } from "vite-plus/test";
import type { SQSEvent, SQSHandler } from "aws-lambda";
import * as contractScanner from "../src/workers/contractScanner.ts";
import * as relatedDocuments from "../src/workers/relatedDocuments.ts";
import * as salesNotes from "../src/workers/salesNotes.ts";
import * as salesSlides from "../src/workers/salesSlides.ts";

const sqsEvent = (...bodies: string[]): SQSEvent => ({
  Records: bodies.map((body, index) => ({
    messageId: `msg-${index}`,
    receiptHandle: "receipt",
    body,
    attributes: {} as never,
    messageAttributes: {},
    md5OfBody: "md5",
    eventSource: "aws:sqs",
    eventSourceARN: "arn:aws:sqs:us-east-1:123456789012:queue",
    awsRegion: "us-east-1",
  })),
});

const run = async (handler: SQSHandler, ...bodies: string[]) =>
  handler(sqsEvent(...bodies), {} as never);

const runOk = async (
  handler: SQSHandler,
  ...bodies: string[]
): Promise<{ batchItemFailures: { itemIdentifier: string }[] }> => {
  const result = await run(handler, ...bodies);
  expect(result.batchItemFailures).toEqual([]);
  return result;
};

describe("workers", () => {
  it("contract scanner completes a scan job (#2)", async () => {
    await runOk(contractScanner.handler, JSON.stringify({ source: "manual" }));
  });

  it("related documents completes a job (#3)", async () => {
    await runOk(relatedDocuments.handler, JSON.stringify({ contractFileId: "contract-1" }));
  });

  it("sales notes completes a job (#4)", async () => {
    await runOk(
      salesNotes.handler,
      JSON.stringify({
        contractFileId: "contract-1",
        relevantDocumentIds: ["doc-1", "doc-2"],
      }),
    );
  });

  it("sales slides completes a job (#5)", async () => {
    await runOk(
      salesSlides.handler,
      JSON.stringify({
        contractFileId: "contract-1",
        relevantDocumentIds: ["doc-1", "doc-2"],
        salesNotesFileId: "notes-1",
      }),
    );
  });

  it("routes malformed messages to the dead-letter path instead of crashing", async () => {
    const result = await run(contractScanner.handler, "not json");
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: "msg-0" }]);
  });
});
