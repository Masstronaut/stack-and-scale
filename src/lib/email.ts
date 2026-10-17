import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { Resource } from "sst";

const ses = new SESv2Client();

export async function sendFileNotification(to: string, file: { name: string; size: number }) {
  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: Resource.Email.sender,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: `File "${file.name}" processed` },
          Body: {
            Text: {
              Data: `Pulled "${file.name}" (${file.size} bytes) from Box.`,
            },
          },
        },
      },
    }),
  );
}
