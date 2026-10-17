import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { demoHttp } from "../renewal/demo-http.ts";
import { readFile } from "node:fs/promises";
import { validateDemoCache } from "../renewal/demo-http.ts";
import { demoDraft } from "../renewal/demo-portfolio.ts";
import { restrictedTestSender } from "../renewal/demo-send-live.ts";
export async function handler(event: APIGatewayProxyEventV2) {
  // API Gateway always supplies requestContext. JSON posted to HTTP is a body,
  // never a Lambda event. Only an IAM-authorized direct invocation reaches this.
  if (!event.requestContext) {
    const command = event as unknown as Record<string, unknown>;
    if (
      Object.keys(command).sort().join(",") !== "customerId,operation" ||
      command.operation !== "SEND_ONE_VERIFIED_NORTHGATE_TEST" ||
      command.customerId !== "REN-C0211"
    )
      throw new Error("Unsupported operator operation");
    const cache = validateDemoCache(
      JSON.parse(await readFile("demo-data/verified-demo.json", "utf8")),
    );
    const account = cache.accounts.find((a) => a.id === "REN-C0211");
    if (!account) throw new Error("Verified Northgate unavailable");
    const messageId = await restrictedTestSender.sendOnce(demoDraft(account).email, account.id);
    return { accepted: true, messageId };
  }
  const host = event.requestContext.domainName;
  const body = event.body
    ? event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body
    : undefined;
  const response = await demoHttp(
    new Request(`https://${host}${event.rawPath}`, {
      method: event.requestContext.http.method,
      headers: event.headers as Record<string, string>,
      ...(body ? { body } : {}),
    }),
    {
      cachePath: "demo-data/verified-demo.json",
      assetRoot: "demo-web",
    },
  );
  return {
    statusCode: response.status,
    headers: Object.fromEntries(response.headers),
    body: await response.text(),
  };
}
