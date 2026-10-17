/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "stack-and-scale",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    await loadDotEnv();

    // Sender identity for SES. Must be a verified email address or domain
    // (new SES accounts are in sandbox mode and can only send to verified
    // destinations).
    const sender = process.env.SES_SENDER_EMAIL;
    if (!sender) {
      throw new Error(
        "SES_SENDER_EMAIL is not set. Add it to .env (local) or to the deploy workflow environment (CI).",
      );
    }
    const email = new sst.aws.Email("Email", { sender });

    // Credentials for the Box app (client credentials grant). Values are set
    // per stage with `sst secret set`, then injected into functions via `link`.
    const boxClientId = new sst.Secret("BOX_CLIENT_ID");
    const boxClientSecret = new sst.Secret("BOX_CLIENT_SECRET");
    const boxEnterpriseId = new sst.Secret("BOX_ENTERPRISE_ID");

    // Dead-letter queue for jobs that fail 3 times.
    const dlq = new sst.aws.Queue("JobDLQ");

    // Job queue. Each message is a JSON job: { fileId, recipient }.
    // Visibility timeout must cover the consumer's 60s function timeout;
    // AWS recommends 6x.
    const queue = new sst.aws.Queue("JobQueue", {
      visibilityTimeout: "360 seconds",
      dlq: { queue: dlq.arn, retry: 3 },
    });
    queue.subscribe(
      {
        handler: "src/functions/consumer.handler",
        timeout: "60 seconds",
        link: [email, boxClientId, boxClientSecret, boxEnterpriseId],
      },
      {
        batch: { size: 1, partialResponses: true },
      },
    );

    // Worker queues for the document pipeline (issues #2-#5). One queue per
    // worker keeps retries/DLQs isolated per pipeline stage.
    // TODO: link an `LLM_API_KEY` sst.Secret to the workers once an LLM
    // provider is chosen (issues #3-#5).
    const workerDefs = [
      {
        queue: "ContractScannerQueue",
        dlq: "ContractScannerDLQ",
        handler: "src/workers/contractScanner.handler",
      },
      {
        queue: "RelatedDocumentsQueue",
        dlq: "RelatedDocumentsDLQ",
        handler: "src/workers/relatedDocuments.handler",
      },
      {
        queue: "SalesNotesQueue",
        dlq: "SalesNotesDLQ",
        handler: "src/workers/salesNotes.handler",
      },
      {
        queue: "SalesSlidesQueue",
        dlq: "SalesSlidesDLQ",
        handler: "src/workers/salesSlides.handler",
      },
    ];

    const workerQueues: Record<string, string> = {};
    for (const def of workerDefs) {
      const deadLetterQueue = new sst.aws.Queue(def.dlq);
      const workerQueue = new sst.aws.Queue(def.queue, {
        visibilityTimeout: "1800 seconds",
        dlq: { queue: deadLetterQueue.arn, retry: 3 },
      });
      workerQueue.subscribe(
        {
          handler: def.handler,
          timeout: "300 seconds",
          link: [boxClientId, boxClientSecret, boxEnterpriseId],
        },
        { batch: { size: 1, partialResponses: true } },
      );
      workerQueues[def.queue] = workerQueue.url;
    }

    // HTTP API with a health check endpoint for deployment/pipeline checks.
    const api = new sst.aws.ApiGatewayV2("Api");
    api.route("GET /health", { handler: "src/functions/api.handler" });

    return {
      api: api.url,
      contractScannerQueue: workerQueues["ContractScannerQueue"],
      relatedDocumentsQueue: workerQueues["RelatedDocumentsQueue"],
      salesNotesQueue: workerQueues["SalesNotesQueue"],
      salesSlidesQueue: workerQueues["SalesSlidesQueue"],
    };
  },
});

// Load `.env` for local `sst deploy` / `sst dev` runs. Never overrides real
// env vars and is a no-op in CI (where config comes from the workflow env).
async function loadDotEnv() {
  try {
    const { readFileSync } = await import("node:fs");
    for (const line of readFileSync(".env", "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && process.env[match[1]] === undefined) {
        process.env[match[1]] = match[2];
      }
    }
  } catch {
    // .env is optional
  }
}
