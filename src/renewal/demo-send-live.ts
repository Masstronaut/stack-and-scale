import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { TEST_ADDRESS, type SendService } from "./demo-send.ts";
const s3 = new S3Client({ region: "us-west-2", maxAttempts: 1 });
const ses = new SESv2Client({ region: "us-west-2", maxAttempts: 1 });
export function reservationCommand(bucket: string, customerId: string) {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: "one-reviewed-test.json",
    ContentType: "application/json",
    Body: JSON.stringify({
      customerId,
      reservedAt: new Date().toISOString(),
      recipient: TEST_ADDRESS,
    }),
  });
  // Existing SDK predates this input; set the documented conditional header
  // before signing so S3 atomically enforces the single-test reservation.
  command.middlewareStack.add(
    (next) => async (args) => {
      const request = args.request as { headers: Record<string, string> };
      request.headers["if-none-match"] = "*";
      return next(args);
    },
    { step: "build", name: "reserveSingleTestEmail" },
  );
  return command;
}
export const restrictedTestSender: SendService = {
  async sendOnce(email, customerId) {
    const bucket = process.env.RENEWER_SEND_LEDGER;
    if (!bucket) throw new Error("send-not-configured");
    // Global one-test budget. A reservation is never deleted, including ambiguous
    // SES failures: no automatic retry can duplicate a delivered message.
    try {
      await s3.send(reservationCommand(bucket, customerId));
    } catch (e) {
      if (
        e instanceof Error &&
        ["PreconditionFailed", "ConditionalRequestConflict"].includes(e.name)
      )
        throw new Error("test-already-reserved");
      throw new Error("reservation-failed-no-send");
    }
    try {
      const response = await ses.send(
        new SendEmailCommand({
          FromEmailAddress: TEST_ADDRESS,
          Destination: { ToAddresses: [TEST_ADDRESS] },
          Content: {
            Simple: {
              Subject: { Data: email.subject, Charset: "UTF-8" },
              Body: { Text: { Data: email.body, Charset: "UTF-8" } },
            },
          },
        }),
      );
      if (!response.MessageId) throw new Error("missing-message-id");
      return response.MessageId;
    } catch {
      throw new Error("delivery-unconfirmed-no-retry");
    }
  },
};
