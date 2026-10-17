import type { SQSEvent, SQSHandler } from "aws-lambda";
import { pullBoxFile, createBoxClient } from "../lib/box.ts";
import { sendFileNotification } from "../lib/email.ts";

export interface JobMessage {
  fileId: string;
  recipient: string;
}

export const handler: SQSHandler = async (event: SQSEvent) => {
  const batchItemFailures: { itemIdentifier: string }[] = [];
  const client = await createBoxClient();

  for (const record of event.Records) {
    try {
      const job = JSON.parse(record.body) as JobMessage;
      const file = await pullBoxFile(client, job.fileId);
      await sendFileNotification(job.recipient, file);
    } catch (error) {
      console.error(`job ${record.messageId} failed`, error);
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};
