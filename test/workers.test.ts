import { describe, expect, it } from "vite-plus/test";
import type { SQSEvent, SQSHandler } from "aws-lambda";
import { Effect } from "effect";
import type { PipelineJob } from "../src/jobs/messages.ts";
import { BoxService, type BoxServiceShape, type FileRef } from "../src/services/box.ts";
import { BoxError } from "../src/services/errors.ts";
import { JobQueueService, type JobQueueServiceShape } from "../src/services/jobs.ts";
import { loadManifest, selectAgreementFiles, type BoxManifest } from "../src/lib/manifest.ts";
import { LlmService, type LlmServiceShape } from "../src/services/llm.ts";
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

const CLASSIFY_PREFIX = "Is the following document";

interface BoxFakeOptions {
  readonly files: readonly FileRef[];
  readonly metadataByFile?: Record<string, Record<string, string>>;
  readonly failFileText?: readonly string[];
}

const makeBoxFake = (options: BoxFakeOptions) => {
  const metadataWrites: { fileId: string; metadata: Record<string, string> }[] = [];
  const box: BoxServiceShape = {
    listAllFiles: () => Effect.succeed(options.files),
    getFileText: (fileId) =>
      options.failFileText?.includes(fileId)
        ? Effect.fail(new BoxError({ cause: new Error(`box is down for ${fileId}`) }))
        : Effect.succeed(`text of ${fileId}`),
    getFileMetadata: (fileId) => Effect.succeed(options.metadataByFile?.[fileId] ?? {}),
    updateFileMetadata: (fileId, metadata) =>
      Effect.sync(() => {
        metadataWrites.push({ fileId, metadata: { ...metadata } });
      }),
    uploadFile: (name) => Effect.succeed({ fileId: `uploaded-${name}` }),
  };
  return { box, metadataWrites };
};

interface LlmFakeOptions {
  readonly replies?: Readonly<Record<string, { classify: string; expiration: string }>>;
  readonly defaultExpiration?: string;
}

const makeLlmFake = (options: LlmFakeOptions = {}) => {
  const calls: string[] = [];
  const llm: LlmServiceShape = {
    complete: (prompt) =>
      Effect.sync(() => {
        calls.push(prompt);
        const reply = Object.entries(options.replies ?? {}).find(([fileId]) =>
          prompt.includes(fileId),
        )?.[1];
        if (!reply) {
          return prompt.startsWith(CLASSIFY_PREFIX) ? "no" : (options.defaultExpiration ?? "none");
        }
        return prompt.startsWith(CLASSIFY_PREFIX) ? reply.classify : reply.expiration;
      }),
  };
  return { llm, calls };
};

const makeQueueFake = () => {
  const enqueued: PipelineJob[] = [];
  const queues: JobQueueServiceShape = {
    enqueue: (job) =>
      Effect.sync(() => {
        enqueued.push(job);
      }),
  };
  return { queues, enqueued };
};

const runScan = async (
  box: BoxServiceShape,
  llm: LlmServiceShape,
  queues: JobQueueServiceShape,
  agreements = selectAgreementFiles(loadManifest()),
) =>
  Effect.runPromise(
    contractScanner
      .processJob({ source: "manual" }, agreements)
      .pipe(
        Effect.provideService(BoxService, box),
        Effect.provideService(LlmService, llm),
        Effect.provideService(JobQueueService, queues),
      ),
  );

const withEnv = async <A>(
  env: Record<string, string | undefined>,
  fn: () => Promise<A>,
): Promise<A> => {
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

const fixtureManifest: BoxManifest = {
  customers: [
    {
      customer_id: "REN-C1",
      customer_name: "Acme",
      box_folder_id: "f1",
      source_contract_id: "CUAD-1",
      source_box_file_id: "src-1",
      document_types: ["AGREEMENT", "PROFILE"],
    },
    {
      customer_id: "REN-C2",
      customer_name: "Beta",
      box_folder_id: "f2",
      source_contract_id: "CUAD-2",
      source_box_file_id: "src-2",
      document_types: ["AGREEMENT"],
    },
  ],
  documents: [
    {
      document_id: "D1-AGREEMENT",
      customer_id: "REN-C1",
      document_type: "AGREEMENT",
      provenance: "synthetic",
      filename: "a1.pdf",
      box_folder_id: "f1",
      box_file_id: "agr-1",
    },
    {
      document_id: "D1-ORIGINAL",
      customer_id: "REN-C1",
      document_type: "CUAD_ORIGINAL",
      provenance: "historical",
      filename: "o1.pdf",
      box_folder_id: "f1",
      box_file_id: "src-1",
    },
    {
      document_id: "D1-PROFILE",
      customer_id: "REN-C1",
      document_type: "PROFILE",
      provenance: "synthetic",
      filename: "p1.pdf",
      box_folder_id: "f1",
      box_file_id: "prof-1",
    },
    {
      document_id: "D2-AGREEMENT",
      customer_id: "REN-C2",
      document_type: "AGREEMENT",
      provenance: "synthetic",
      filename: "a2.pdf",
      box_folder_id: "f2",
      box_file_id: "src-2",
    },
  ],
};

describe("manifest selection", () => {
  it("selects only synthetic agreements, never CUAD originals", () => {
    const selected = selectAgreementFiles(fixtureManifest);
    expect(selected.map((doc) => doc.box_file_id)).toEqual(["agr-1"]);
  });

  it("the committed manifest has one agreement per account", () => {
    expect(loadManifest().customers).toHaveLength(24);
    expect(selectAgreementFiles(loadManifest())).toHaveLength(24);
  });
});

describe("workers", () => {
  it("contract scanner completes a scan job (#2)", async () => {
    const { box } = makeBoxFake({ files: [] });
    const { llm } = makeLlmFake();
    const { queues } = makeQueueFake();
    const result = await runScan(box, llm, queues, []);
    expect(result).toEqual({ scanned: 0, contracts: 0, mode: "full-scan" });
  });

  it("scans exactly the manifest agreements without LLM classification and gates writes (#2)", async () => {
    await withEnv({ BOX_WRITE_ENABLED: "true" }, async () => {
      const { box, metadataWrites } = makeBoxFake({ files: [] });
      const { llm, calls } = makeLlmFake({ defaultExpiration: "2027-01-31" });
      const { queues, enqueued } = makeQueueFake();
      const agreements = selectAgreementFiles(loadManifest());
      const sourceIds = new Set(
        loadManifest().customers.map((customer) => customer.source_box_file_id),
      );

      const result = await runScan(box, llm, queues, agreements);

      expect(result).toEqual({ scanned: 24, contracts: 24, mode: "manifest" });
      expect(calls).toHaveLength(24); // date extraction only
      expect(calls.some((prompt) => prompt.startsWith(CLASSIFY_PREFIX))).toBe(false);
      expect(metadataWrites).toHaveLength(24);
      for (const write of metadataWrites) {
        expect(write.metadata).toEqual({
          expirationDate: "2027-01-31",
          isContract: "true",
          contractScanVerdict: "contract",
        });
        expect(agreements.some((agreement) => agreement.box_file_id === write.fileId)).toBe(true);
        expect(sourceIds.has(write.fileId)).toBe(false);
      }
      expect(enqueued).toEqual(
        agreements.map((agreement) => ({ contractFileId: agreement.box_file_id })),
      );
    });
  });

  it("skips metadata writes when the write gate is off but still enqueues (#2)", async () => {
    await withEnv({ BOX_WRITE_ENABLED: undefined }, async () => {
      const { box, metadataWrites } = makeBoxFake({ files: [] });
      const { llm, calls } = makeLlmFake({ defaultExpiration: "2027-01-31" });
      const { queues, enqueued } = makeQueueFake();

      const result = await runScan(box, llm, queues);

      expect(result).toEqual({ scanned: 24, contracts: 24, mode: "manifest" });
      expect(metadataWrites).toEqual([]);
      expect(enqueued).toHaveLength(24);
      expect(calls).toHaveLength(24);
    });
  });

  it("stamps found contracts and enqueues one related-documents job each (#2)", async () => {
    const { box, metadataWrites } = makeBoxFake({
      files: [
        { id: "contract-1", name: "msa.pdf" },
        { id: "doc-2", name: "notes.pdf" },
      ],
    });
    const { llm, calls } = makeLlmFake({
      replies: {
        "contract-1": { classify: "yes", expiration: "2027-01-31" },
        "doc-2": { classify: "no", expiration: "none" },
      },
    });
    const { queues, enqueued } = makeQueueFake();

    const result = await withEnv({ BOX_WRITE_ENABLED: "true" }, () =>
      runScan(box, llm, queues, []),
    );

    expect(result).toEqual({ scanned: 2, contracts: 1, mode: "full-scan" });
    expect(metadataWrites).toEqual([
      {
        fileId: "contract-1",
        metadata: {
          expirationDate: "2027-01-31",
          isContract: "true",
          contractScanVerdict: "contract",
        },
      },
    ]);
    expect(enqueued).toEqual([{ contractFileId: "contract-1" }]);
    expect(calls).toHaveLength(3); // 2 classifications + 1 date extraction
  });

  it("skips non-contract files without writing metadata or enqueueing (#2)", async () => {
    const { box, metadataWrites } = makeBoxFake({ files: [{ id: "doc-1", name: "memo.pdf" }] });
    const { llm, calls } = makeLlmFake({
      replies: { "doc-1": { classify: "no", expiration: "none" } },
    });
    const { queues, enqueued } = makeQueueFake();

    const result = await runScan(box, llm, queues, []);

    expect(result).toEqual({ scanned: 1, contracts: 0, mode: "full-scan" });
    expect(metadataWrites).toEqual([]);
    expect(enqueued).toEqual([]);
    expect(calls).toHaveLength(1); // only the classification
  });

  it("uses cached non-contract verdicts without calling the LLM (#2)", async () => {
    const { box, metadataWrites } = makeBoxFake({
      files: [{ id: "doc-1", name: "memo.pdf" }],
      metadataByFile: { "doc-1": { contractScanVerdict: "not-contract" } },
    });
    const { llm, calls } = makeLlmFake();
    const { queues, enqueued } = makeQueueFake();

    const result = await runScan(box, llm, queues, []);

    expect(result).toEqual({ scanned: 1, contracts: 0, mode: "full-scan" });
    expect(calls).toEqual([]);
    expect(metadataWrites).toEqual([]);
    expect(enqueued).toEqual([]);
  });

  it("stamps unparseable dates as none and still enqueues the contract (#2)", async () => {
    const { box, metadataWrites } = makeBoxFake({ files: [{ id: "contract-1", name: "msa.pdf" }] });
    const { llm } = makeLlmFake({
      replies: {
        "contract-1": { classify: "yes", expiration: "the parties did not agree on one" },
      },
    });
    const { queues, enqueued } = makeQueueFake();

    await withEnv({ BOX_WRITE_ENABLED: "true" }, () => runScan(box, llm, queues, []));

    expect(metadataWrites).toEqual([
      {
        fileId: "contract-1",
        metadata: {
          expirationDate: "none",
          isContract: "true",
          contractScanVerdict: "contract",
        },
      },
    ]);
    expect(enqueued).toEqual([{ contractFileId: "contract-1" }]);
  });

  it("keeps scanning when one file fails but fails the job when all of them do (#2)", async () => {
    const { box, metadataWrites } = makeBoxFake({
      files: [
        { id: "broken.pdf", name: "broken.pdf" },
        { id: "contract-1", name: "msa.pdf" },
      ],
      failFileText: ["broken.pdf"],
    });
    const failing = makeBoxFake({
      files: [{ id: "broken.pdf", name: "broken.pdf" }],
      failFileText: ["broken.pdf"],
    });
    const { llm } = makeLlmFake({
      replies: { "contract-1": { classify: "yes", expiration: "2027-01-31" } },
    });
    const { queues, enqueued } = makeQueueFake();

    const result = await withEnv({ BOX_WRITE_ENABLED: "true" }, () =>
      runScan(box, llm, queues, []),
    );
    expect(result).toEqual({ scanned: 2, contracts: 1, mode: "full-scan" });
    expect(metadataWrites.map((write) => write.fileId)).toEqual(["contract-1"]);
    expect(enqueued).toEqual([{ contractFileId: "contract-1" }]);

    await expect(
      withEnv({ BOX_WRITE_ENABLED: "true" }, () => runScan(failing.box, llm, queues, [])),
    ).rejects.toMatchObject({
      _tag: "BoxError",
    });
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
