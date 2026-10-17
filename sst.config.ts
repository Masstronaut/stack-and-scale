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

    // Worker queues for the document pipeline (issues #2-#5 plus the
    // docDigest compression stage between relatedDocuments and salesNotes).
    // One queue per worker keeps retries/DLQs isolated per pipeline stage.
    // TODO: link an `LLM_API_KEY` sst.Secret to the workers once an LLM
    // provider is chosen (issues #3-#5).
    //
    // The contract scanner, the sales notes worker and the sales slides
    // worker are the stages allowed to write box (BOX_WRITE_ENABLED): the
    // scanner stamps scan metadata, the notes worker uploads the generated
    // notes, the slides worker uploads the generated deck. Both roots are
    // configurable per stage and default to the box root folder ("0");
    // generated notes land in BOX_OUTPUT_FOLDER_ID when set, defaulting to
    // the scan root. relatedDocuments and docDigest get the same root for
    // read-only contract text reads and never write box.
    //
    // Run tracking + artifacts share one private S3 bucket: workers PUT
    // stage records under `runs/<runId>/` and outputs under `artifacts/...`
    // (both gated on ARTIFACTS_BUCKET at runtime), and the /runs +
    // /artifacts routes read/presign from the same bucket.
    const boxRootFolderId = process.env.BOX_ROOT_FOLDER_ID ?? "0";
    const boxOutputFolderId = process.env.BOX_OUTPUT_FOLDER_ID ?? boxRootFolderId;

    // LLM: Bedrock Nova by default (function role credentials, no separate
    // key); LLM_PROVIDER=openai switches to an OpenAI-compatible endpoint.
    const llmEnvironment = {
      LLM_PROVIDER: process.env.LLM_PROVIDER ?? "bedrock",
      LLM_MODEL: process.env.LLM_MODEL ?? "us.amazon.nova-lite-v1:0",
    };
    const llmPermissions = [
      {
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
        resources: ["*"],
      },
    ];
    const artifacts = new sst.aws.Bucket("Artifacts");
    interface WorkerDef {
      readonly queue: string;
      readonly dlq: string;
      readonly handler: string;
      readonly environment?: Record<string, string>;
      /** Function timeout; defaults to "300 seconds". */
      readonly timeout?: string;
    }
    const workerDefs: WorkerDef[] = [
      {
        queue: "ContractScannerQueue",
        dlq: "ContractScannerDLQ",
        handler: "src/workers/contractScanner.handler",
        // One scan job processes all 24 contracts sequentially (metadata
        // reads + LLM date extraction each) - 300s is not enough.
        timeout: "900 seconds",
        environment: {
          BOX_WRITE_ENABLED: "true",
          BOX_ROOT_FOLDER_ID: boxRootFolderId,
          ARTIFACTS_BUCKET: artifacts.name,
        },
      },
      {
        queue: "RelatedDocumentsQueue",
        dlq: "RelatedDocumentsDLQ",
        handler: "src/workers/relatedDocuments.handler",
        environment: {
          BOX_ROOT_FOLDER_ID: boxRootFolderId,
          ARTIFACTS_BUCKET: artifacts.name,
        },
      },
      {
        queue: "DocDigestQueue",
        dlq: "DocDigestDLQ",
        handler: "src/workers/docDigest.handler",
        environment: {
          BOX_ROOT_FOLDER_ID: boxRootFolderId,
          ARTIFACTS_BUCKET: artifacts.name,
        },
      },
      {
        queue: "SalesNotesQueue",
        dlq: "SalesNotesDLQ",
        handler: "src/workers/salesNotes.handler",
        environment: {
          BOX_WRITE_ENABLED: "true",
          BOX_ROOT_FOLDER_ID: boxRootFolderId,
          BOX_OUTPUT_FOLDER_ID: boxOutputFolderId,
          ARTIFACTS_BUCKET: artifacts.name,
        },
      },
      {
        queue: "SalesSlidesQueue",
        dlq: "SalesSlidesDLQ",
        handler: "src/workers/salesSlides.handler",
        environment: {
          BOX_WRITE_ENABLED: "true",
          BOX_ROOT_FOLDER_ID: boxRootFolderId,
          BOX_OUTPUT_FOLDER_ID: boxOutputFolderId,
          ARTIFACTS_BUCKET: artifacts.name,
        },
      },
    ];

    const workerQueues: Record<string, sst.aws.Queue> = {};
    for (const def of workerDefs) {
      const deadLetterQueue = new sst.aws.Queue(def.dlq);
      workerQueues[def.queue] = new sst.aws.Queue(def.queue, {
        visibilityTimeout: "1800 seconds",
        dlq: { queue: deadLetterQueue.arn, retry: 3 },
      });
    }

    // Each worker links the queue of the downstream pipeline stage it
    // enqueues to, so its function can read `Resource.<QueueName>.url`.
    const downstreamQueues: Record<string, string[]> = {
      ContractScannerQueue: ["RelatedDocumentsQueue"],
      RelatedDocumentsQueue: ["DocDigestQueue"],
      DocDigestQueue: ["SalesNotesQueue"],
      SalesNotesQueue: ["SalesSlidesQueue"],
      SalesSlidesQueue: [],
    };
    for (const def of workerDefs) {
      workerQueues[def.queue].subscribe(
        {
          handler: def.handler,
          timeout: def.timeout ?? "300 seconds",
          environment: { ...llmEnvironment, ...def.environment },
          permissions: llmPermissions,
          link: [
            boxClientId,
            boxClientSecret,
            boxEnterpriseId,
            artifacts,
            ...downstreamQueues[def.queue].map((name) => workerQueues[name]),
          ],
        },
        { batch: { size: 1, partialResponses: true } },
      );
    }

    // HTTP API with a health check endpoint for deployment/pipeline checks,
    // plus the run-tracking dashboard surface: /runs lists recent runs,
    // /artifacts hands out presigned GET urls for artifact keys (the bucket
    // itself stays private), /dashboard serves the polling UI.
    const api = new sst.aws.ApiGatewayV2("Api");
    api.route("GET /health", { handler: "src/functions/api.handler" });
    api.route("GET /runs", {
      handler: "src/functions/runs.handler",
      link: [artifacts],
      environment: { ARTIFACTS_BUCKET: artifacts.name },
    });
    api.route("GET /artifacts", {
      handler: "src/functions/artifact.handler",
      link: [artifacts],
      environment: { ARTIFACTS_BUCKET: artifacts.name },
    });
    api.route("GET /dashboard", { handler: "src/functions/dashboard.handler" });

    return {
      api: api.url,
      contractScannerQueue: workerQueues["ContractScannerQueue"].url,
      relatedDocumentsQueue: workerQueues["RelatedDocumentsQueue"].url,
      docDigestQueue: workerQueues["DocDigestQueue"].url,
      salesNotesQueue: workerQueues["SalesNotesQueue"].url,
      salesSlidesQueue: workerQueues["SalesSlidesQueue"].url,
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
