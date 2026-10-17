import { describe, expect, it } from "vite-plus/test";
import type { SQSEvent, SQSHandler } from "aws-lambda";
import { Effect } from "effect";
import type {
  PipelineJob,
  RelatedDocumentsJob,
  SalesNotesJob,
  SalesSlidesJob,
} from "../src/jobs/messages.ts";
import { ArtifactsServiceLive } from "../src/services/artifacts-live.ts";
import { ArtifactsService, type ArtifactsServiceShape } from "../src/services/artifacts.ts";
import { BoxService, type BoxServiceShape, type FileRef } from "../src/services/box.ts";
import { BoxError, LlmError } from "../src/services/errors.ts";
import { JobQueueService, type JobQueueServiceShape } from "../src/services/jobs.ts";
import {
  findDocumentByFileId,
  loadManifest,
  selectAgreementFiles,
  selectSharedKnowledgeFiles,
  type BoxManifest,
  type ManifestDocument,
} from "../src/lib/manifest.ts";
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

const CLASSIFY_PREFIX = "Is the following document";

interface BoxFakeOptions {
  readonly files: readonly FileRef[];
  readonly metadataByFile?: Record<string, Record<string, string>>;
  readonly failFileText?: readonly string[];
}

const makeBoxFake = (options: BoxFakeOptions) => {
  const metadataWrites: { fileId: string; metadata: Record<string, string> }[] = [];
  const uploads: { name: string; content: string }[] = [];
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
    uploadFile: (name, content) =>
      Effect.sync(() => {
        uploads.push({ name, content });
        return { fileId: `uploaded-${name}` };
      }),
  };
  return { box, metadataWrites, uploads };
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

const makeDoc = (
  documentId: string,
  customerId: string | null,
  documentType: string,
  boxFileId: string,
  provenance = "synthetic",
): ManifestDocument => ({
  document_id: documentId,
  customer_id: customerId,
  document_type: documentType,
  provenance,
  filename: `${documentId}.pdf`,
  box_folder_id: "f1",
  box_file_id: boxFileId,
});

const relatedManifest: BoxManifest = {
  customers: [
    {
      customer_id: "REN-C1",
      customer_name: "Acme",
      box_folder_id: "f1",
      source_contract_id: "CUAD-1",
      source_box_file_id: "src-1",
      document_types: [
        "PROFILE",
        "AGREEMENT",
        "EMAILS",
        "REQUESTS",
        "HISTORY",
        "USAGECSV",
        "USAGE",
        "OBLIGATIONS",
      ],
    },
    {
      customer_id: "REN-C2",
      customer_name: "Beta",
      box_folder_id: "f2",
      source_contract_id: "CUAD-2",
      source_box_file_id: "src-2",
      document_types: ["AGREEMENT", "PROFILE"],
    },
  ],
  documents: [
    makeDoc("D1-PROFILE", "REN-C1", "PROFILE", "prof-1"),
    makeDoc("D1-AGREEMENT", "REN-C1", "AGREEMENT", "agr-1"),
    makeDoc("D1-EMAILS", "REN-C1", "EMAILS", "mail-1"),
    makeDoc("D1-REQUESTS", "REN-C1", "REQUESTS", "req-1"),
    makeDoc("D1-HISTORY", "REN-C1", "HISTORY", "hist-1"),
    makeDoc("D1-USAGECSV", "REN-C1", "USAGECSV", "ucsv-1"),
    makeDoc("D1-USAGE", "REN-C1", "USAGE", "usage-1"),
    makeDoc("D1-OBLIGATIONS", "REN-C1", "OBLIGATIONS", "oblig-1"),
    makeDoc("D1-ORIGINAL", "REN-C1", "CUAD_ORIGINAL", "src-1", "original_cuad"),
    makeDoc("D2-AGREEMENT", "REN-C2", "AGREEMENT", "agr-2"),
    makeDoc("D2-PROFILE", "REN-C2", "PROFILE", "prof-2"),
    makeDoc("SHARED-CATALOG", null, "PRODUCT_KNOWLEDGE", "cat-1"),
    makeDoc("SHARED-RELEASES", null, "PRODUCT_KNOWLEDGE", "rel-1"),
    makeDoc("SHARED-ROADMAP", null, "PRODUCT_KNOWLEDGE", "road-1"),
    makeDoc("SHARED-PRICING", null, "PRODUCT_KNOWLEDGE", "price-1"),
  ],
};

const RELATED_BASELINE_IDS = [
  "prof-1",
  "mail-1",
  "req-1",
  "hist-1",
  "ucsv-1",
  "usage-1",
  "oblig-1",
];

interface RelatedLlmFakeOptions {
  readonly reply?: string;
  readonly fail?: boolean;
}

const makeRelatedLlmFake = (options: RelatedLlmFakeOptions = {}) => {
  const calls: string[] = [];
  const llm: LlmServiceShape = {
    complete: (prompt) => {
      calls.push(prompt);
      return options.fail === true
        ? Effect.fail(new LlmError({ cause: new Error("llm unavailable") }))
        : Effect.succeed(options.reply ?? "none");
    },
  };
  return { llm, calls };
};

const runRelated = (
  job: RelatedDocumentsJob,
  box: BoxServiceShape,
  llm: LlmServiceShape,
  queues: JobQueueServiceShape,
  boxManifest: BoxManifest = relatedManifest,
) =>
  Effect.runPromise(
    relatedDocuments
      .processJob(job, boxManifest)
      .pipe(
        Effect.provideService(BoxService, box),
        Effect.provideService(LlmService, llm),
        Effect.provideService(JobQueueService, queues),
      ),
  );

const runNotes = (
  job: SalesNotesJob,
  box: BoxServiceShape,
  llm: LlmServiceShape,
  queues: JobQueueServiceShape,
  boxManifest: BoxManifest = relatedManifest,
) =>
  Effect.runPromise(
    salesNotes
      .processJob(job, boxManifest)
      .pipe(
        Effect.provideService(BoxService, box),
        Effect.provideService(LlmService, llm),
        Effect.provideService(JobQueueService, queues),
      ),
  );

const makeArtifactsFake = () => {
  const puts: { key: string; content: string | Uint8Array; contentType: string }[] = [];
  const artifacts: ArtifactsServiceShape = {
    putArtifact: (key, content, contentType) =>
      Effect.sync(() => {
        puts.push({ key, content, contentType });
        return { key, bucket: "fake-bucket" };
      }),
  };
  return { artifacts, puts };
};

const runSlides = (
  job: SalesSlidesJob,
  box: BoxServiceShape,
  llm: LlmServiceShape,
  artifacts: ArtifactsServiceShape,
  boxManifest: BoxManifest = relatedManifest,
) =>
  Effect.runPromise(
    salesSlides
      .processJob(job, boxManifest)
      .pipe(
        Effect.provideService(BoxService, box),
        Effect.provideService(LlmService, llm),
        Effect.provideService(ArtifactsService, artifacts),
      ),
  );

describe("manifest selection", () => {
  it("selects only synthetic agreements, never CUAD originals", () => {
    const selected = selectAgreementFiles(fixtureManifest);
    expect(selected.map((doc) => doc.box_file_id)).toEqual(["agr-1"]);
  });

  it("the committed manifest has one agreement per account", () => {
    expect(loadManifest().customers).toHaveLength(24);
    expect(selectAgreementFiles(loadManifest())).toHaveLength(24);
  });

  it("finds documents by exact box file id, rejecting unknown or ambiguous ids", () => {
    expect(findDocumentByFileId(fixtureManifest, "agr-1")?.document_id).toBe("D1-AGREEMENT");
    expect(findDocumentByFileId(fixtureManifest, "nope")).toBeUndefined();
    expect(
      findDocumentByFileId(
        {
          customers: [],
          documents: [fixtureManifest.documents[0]!, fixtureManifest.documents[0]!],
        },
        "agr-1",
      ),
    ).toBeUndefined();
  });

  it("selects the customer-less shared product knowledge files", () => {
    const shared = selectSharedKnowledgeFiles(relatedManifest);
    expect(shared.map((doc) => doc.box_file_id)).toEqual(["cat-1", "rel-1", "road-1", "price-1"]);
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

  it("resolves a contract to its customer's seven baseline files with reasons (#3)", async () => {
    const { box } = makeBoxFake({ files: [] });
    const { llm } = makeRelatedLlmFake({ reply: "none" });
    const { queues, enqueued } = makeQueueFake();

    const result = await runRelated({ contractFileId: "agr-1" }, box, llm, queues);

    expect(result.customerId).toBe("REN-C1");
    expect(result.baseline.map((entry) => entry.fileId)).toEqual(RELATED_BASELINE_IDS);
    expect(result.baseline.map((entry) => entry.reason)).toEqual([
      "PROFILE: customer identity & context",
      "EMAILS: customer correspondence & asks",
      "REQUESTS: feature request status",
      "HISTORY: account & negotiation history",
      "USAGECSV: raw product usage observations",
      "USAGE: product usage report",
      "OBLIGATIONS: delivery & service obligations",
    ]);
    expect(result.relevantDocumentIds).toEqual(RELATED_BASELINE_IDS);
    expect(enqueued).toEqual([
      { contractFileId: "agr-1", relevantDocumentIds: RELATED_BASELINE_IDS },
    ]);
  });

  it("adds only LLM-selected shared product knowledge ids (#3)", async () => {
    const { box } = makeBoxFake({ files: [] });
    const { llm, calls } = makeRelatedLlmFake({ reply: '["cat-1", "road-1", "not-in-manifest"]' });
    const { queues, enqueued } = makeQueueFake();

    const result = await runRelated({ contractFileId: "agr-1" }, box, llm, queues);

    expect(result.sharedDocumentIds).toEqual(["cat-1", "road-1"]);
    expect(result.relevantDocumentIds).toEqual([...RELATED_BASELINE_IDS, "cat-1", "road-1"]);
    expect(enqueued).toEqual([
      {
        contractFileId: "agr-1",
        relevantDocumentIds: [...RELATED_BASELINE_IDS, "cat-1", "road-1"],
      },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("Acme"); // customer context
    expect(calls[0]).toContain("text of agr-1"); // contract text read via box
  });

  it("completes with the baseline-only set when the LLM fails (#3)", async () => {
    const { box } = makeBoxFake({ files: [] });
    const { llm } = makeRelatedLlmFake({ fail: true });
    const { queues, enqueued } = makeQueueFake();

    const result = await runRelated({ contractFileId: "agr-1" }, box, llm, queues);

    expect(result.relevantDocumentIds).toEqual(RELATED_BASELINE_IDS);
    expect(result.sharedDocumentIds).toEqual([]);
    expect(enqueued).toEqual([
      { contractFileId: "agr-1", relevantDocumentIds: RELATED_BASELINE_IDS },
    ]);
  });

  it("fails the job for unresolvable contractFileIds (#3)", async () => {
    const { box } = makeBoxFake({ files: [] });
    const { llm } = makeRelatedLlmFake();
    const { queues, enqueued } = makeQueueFake();

    await expect(
      runRelated({ contractFileId: "unknown-file" }, box, llm, queues),
    ).rejects.toMatchObject({ _tag: "ContractResolutionError", contractFileId: "unknown-file" });
    // shared docs are customer-less and cannot be resolved as contracts
    await expect(runRelated({ contractFileId: "cat-1" }, box, llm, queues)).rejects.toMatchObject({
      _tag: "ContractResolutionError",
    });
    // ambiguous ids (duplicate box file entries) are rejected too
    const ambiguous: BoxManifest = {
      customers: [],
      documents: [
        makeDoc("A", "REN-C1", "PROFILE", "dup-1"),
        makeDoc("B", "REN-C2", "PROFILE", "dup-1"),
      ],
    };
    await expect(
      runRelated({ contractFileId: "dup-1" }, box, llm, queues, ambiguous),
    ).rejects.toMatchObject({ _tag: "ContractResolutionError" });
    expect(enqueued).toEqual([]);

    // through the live handler the failure becomes a batch item failure
    const result = await run(
      relatedDocuments.handler,
      JSON.stringify({ contractFileId: "unknown-file" }),
    );
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: "msg-0" }]);
  });

  it("resolves a CUAD original to its mapped customer with provenance retained (#3)", async () => {
    const { box } = makeBoxFake({ files: [] });
    const { llm } = makeRelatedLlmFake({ reply: "none" });
    const { queues, enqueued } = makeQueueFake();

    const result = await runRelated({ contractFileId: "src-1" }, box, llm, queues);

    expect(result.customerId).toBe("REN-C1");
    expect(result.contractProvenance).toBe("original_cuad");
    expect(result.baseline.map((entry) => entry.fileId)).toEqual(RELATED_BASELINE_IDS);
    expect(result.relevantDocumentIds).not.toContain("agr-1");
    expect(result.relevantDocumentIds).not.toContain("src-1");
    expect(enqueued).toEqual([
      { contractFileId: "src-1", relevantDocumentIds: RELATED_BASELINE_IDS },
    ]);
  });

  const NOTES_JOB: SalesNotesJob = {
    contractFileId: "agr-1",
    relevantDocumentIds: RELATED_BASELINE_IDS,
  };

  it("generates grounded notes, uploads them and enqueues the slides job (#4)", async () => {
    await withEnv({ BOX_WRITE_ENABLED: "true" }, async () => {
      const { box, uploads } = makeBoxFake({ files: [] });
      const { llm, calls } = makeRelatedLlmFake({
        reply:
          "## Account context\nAcme is a long-standing customer. [PROFILE: D1-PROFILE.pdf]\n\n## Citations\n- [PROFILE: D1-PROFILE.pdf]",
      });
      const { queues, enqueued } = makeQueueFake();

      const result = await runNotes(NOTES_JOB, box, llm, queues);

      expect(calls).toHaveLength(1); // one notes prompt
      expect(calls[0]).toContain("Acme"); // customer context
      expect(calls[0]).toContain("AGREEMENT: D1-AGREEMENT.pdf"); // labeled primary contract
      expect(calls[0]).toContain("text of agr-1"); // contract text read via box
      expect(calls[0]).toContain("PROFILE: D1-PROFILE.pdf"); // labeled related doc
      expect(calls[0]).toContain("text of ucsv-1"); // usage evidence included
      expect(uploads).toHaveLength(1);
      expect(uploads[0]!.name).toBe("Sales Notes Acme.md");
      expect(uploads[0]!.content).toContain("## Citations");
      expect(result.notesFileName).toBe("Sales Notes Acme.md");
      expect(result.salesNotesFileId).toBe("uploaded-Sales Notes Acme.md");
      expect(result.failedDocumentIds).toEqual([]);
      expect(enqueued).toEqual([
        {
          contractFileId: "agr-1",
          relevantDocumentIds: RELATED_BASELINE_IDS,
          salesNotesFileId: "uploaded-Sales Notes Acme.md",
        },
      ]);
    });
  });

  it("skips the upload when the write gate is off and enqueues an empty notes id (#4)", async () => {
    await withEnv({ BOX_WRITE_ENABLED: undefined }, async () => {
      const { box, uploads } = makeBoxFake({ files: [] });
      const { llm, calls } = makeRelatedLlmFake({ reply: "## Citations\n- none" });
      const { queues, enqueued } = makeQueueFake();

      const result = await runNotes(NOTES_JOB, box, llm, queues);

      expect(calls).toHaveLength(1); // notes are still drafted
      expect(uploads).toEqual([]);
      expect(result.salesNotesFileId).toBe("");
      expect(enqueued).toEqual([
        {
          contractFileId: "agr-1",
          relevantDocumentIds: RELATED_BASELINE_IDS,
          salesNotesFileId: "",
        },
      ]);
    });
  });

  it("still produces notes from the readable documents when one is unreadable (#4)", async () => {
    await withEnv({ BOX_WRITE_ENABLED: "true" }, async () => {
      const { box, uploads } = makeBoxFake({ files: [], failFileText: ["mail-1"] });
      const { llm, calls } = makeRelatedLlmFake({
        reply: "## Citations\n- [PROFILE: D1-PROFILE.pdf]",
      });
      const { queues, enqueued } = makeQueueFake();

      const result = await runNotes(NOTES_JOB, box, llm, queues);

      expect(result.failedDocumentIds).toEqual(["mail-1"]);
      expect(calls[0]).toContain("text of agr-1");
      expect(calls[0]).toContain("PROFILE: D1-PROFILE.pdf");
      expect(calls[0]).not.toContain("text of mail-1"); // grounded in what WAS read
      expect(uploads).toHaveLength(1);
      expect(enqueued).toEqual([
        {
          contractFileId: "agr-1",
          relevantDocumentIds: RELATED_BASELINE_IDS,
          salesNotesFileId: "uploaded-Sales Notes Acme.md",
        },
      ]);
    });
  });

  it("fails the job when the notes LLM call fails (#4)", async () => {
    const { box, uploads } = makeBoxFake({ files: [] });
    const { llm } = makeRelatedLlmFake({ fail: true });
    const { queues, enqueued } = makeQueueFake();

    await expect(runNotes(NOTES_JOB, box, llm, queues)).rejects.toMatchObject({
      _tag: "LlmError",
    });
    expect(uploads).toEqual([]);
    expect(enqueued).toEqual([]);
  });

  it("fails the job for unresolvable contractFileIds (#4)", async () => {
    const { box } = makeBoxFake({ files: [] });
    const { llm } = makeRelatedLlmFake();
    const { queues, enqueued } = makeQueueFake();

    await expect(
      runNotes({ contractFileId: "unknown-file", relevantDocumentIds: [] }, box, llm, queues),
    ).rejects.toMatchObject({ _tag: "ContractResolutionError", contractFileId: "unknown-file" });
    // shared docs are customer-less and cannot be resolved as contracts
    await expect(
      runNotes({ contractFileId: "cat-1", relevantDocumentIds: [] }, box, llm, queues),
    ).rejects.toMatchObject({ _tag: "ContractResolutionError" });
    expect(enqueued).toEqual([]);

    // through the live handler the failure becomes a batch item failure
    const result = await run(
      salesNotes.handler,
      JSON.stringify({ contractFileId: "unknown-file", relevantDocumentIds: [] }),
    );
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: "msg-0" }]);
  });

  it("falls back to the contract file id in the notes filename when the customer is unresolvable (#4)", async () => {
    await withEnv({ BOX_WRITE_ENABLED: "true" }, async () => {
      const { box, uploads } = makeBoxFake({ files: [] });
      const { llm } = makeRelatedLlmFake({ reply: "notes" });
      const { queues } = makeQueueFake();
      const orphanManifest: BoxManifest = {
        customers: [],
        documents: [makeDoc("D1-AGREEMENT", "REN-C1", "AGREEMENT", "agr-1")],
      };

      const result = await runNotes(NOTES_JOB, box, llm, queues, orphanManifest);

      expect(result.customerName).toBe("agr-1");
      expect(uploads[0]!.name).toBe("Sales Notes agr-1.md");
    });
  });

  const SLIDES_JOB: SalesSlidesJob = {
    contractFileId: "agr-1",
    relevantDocumentIds: RELATED_BASELINE_IDS,
    salesNotesFileId: "uploaded-Sales Notes Acme.md",
  };

  it("builds the deck from notes + context, uploads it and writes the artifact (#5)", async () => {
    await withEnv({ BOX_WRITE_ENABLED: "true" }, async () => {
      const { box, uploads } = makeBoxFake({ files: [] });
      const { llm, calls } = makeRelatedLlmFake({
        reply:
          '<!DOCTYPE html><html><head><style>.slide{page-break-after:always}</style></head><body><section class="slide"><h2>Acme renewal</h2></section><section class="slide"><h2>Value realized [USAGE: D1-USAGE.pdf]</h2></section><section class="slide"><h2>Next steps</h2></section></body></html>',
      });
      const { artifacts, puts } = makeArtifactsFake();

      const result = await runSlides(SLIDES_JOB, box, llm, artifacts);

      expect(calls).toHaveLength(1); // one deck prompt
      expect(calls[0]).toContain("Acme"); // customer context
      expect(calls[0]).toContain("SALES NOTES"); // notes are the primary source
      expect(calls[0]).toContain("text of uploaded-Sales Notes Acme.md"); // notes text read via box
      expect(calls[0]).toContain("AGREEMENT: D1-AGREEMENT.pdf"); // labeled primary contract
      expect(calls[0]).toContain("text of usage-1"); // usage evidence included
      expect(uploads).toHaveLength(1);
      expect(uploads[0]!.name).toBe("Sales Deck Acme.html");
      expect(uploads[0]!.content).toContain("<section");
      expect(puts).toHaveLength(1);
      expect(puts[0]!.key).toBe("artifacts/agr-1/sales-deck.html");
      expect(puts[0]!.contentType).toBe("text/html");
      expect(puts[0]!.content).toContain("<section");
      expect(result.deckFileName).toBe("Sales Deck Acme.html");
      expect(result.deckFileId).toBe("uploaded-Sales Deck Acme.html");
      expect(result.artifactKey).toBe("artifacts/agr-1/sales-deck.html");
      expect(result.artifactBucket).toBe("fake-bucket");
      expect(result.slides).toBe(3);
    });
  });

  it("derives talking points without notes when salesNotesFileId is empty (#5)", async () => {
    await withEnv({ BOX_WRITE_ENABLED: "true" }, async () => {
      const { box, uploads } = makeBoxFake({ files: [] });
      const { llm, calls } = makeRelatedLlmFake({
        reply:
          '<!DOCTYPE html><html><body><section class="slide"><h2>Title</h2></section></body></html>',
      });
      const { artifacts, puts } = makeArtifactsFake();

      const result = await runSlides({ ...SLIDES_JOB, salesNotesFileId: "" }, box, llm, artifacts);

      expect(calls).toHaveLength(1); // deck is still drafted
      expect(calls[0]).not.toContain("SALES NOTES"); // degraded prompt has no notes section
      expect(calls[0]).toContain("text of agr-1"); // grounded in contract + docs
      expect(calls[0]).toContain("text of ucsv-1");
      expect(result.deckFileName).toBe("Sales Deck Acme.html");
      expect(uploads).toHaveLength(1);
      expect(puts).toHaveLength(1);
    });
  });

  it("skips the box upload when the write gate is off but still writes the artifact (#5)", async () => {
    await withEnv({ BOX_WRITE_ENABLED: undefined }, async () => {
      const { box, uploads } = makeBoxFake({ files: [] });
      const { llm, calls } = makeRelatedLlmFake({
        reply:
          '<!DOCTYPE html><html><body><section class="slide"><h2>Title</h2></section></body></html>',
      });
      const { artifacts, puts } = makeArtifactsFake();

      const result = await runSlides(SLIDES_JOB, box, llm, artifacts);

      expect(calls).toHaveLength(1); // deck is still drafted
      expect(uploads).toEqual([]); // box gate off
      expect(result.deckFileId).toBe("");
      expect(puts).toHaveLength(1); // artifact gate is independent
      expect(result.artifactKey).toBe("artifacts/agr-1/sales-deck.html");
    });
  });

  it("skips artifact writes when ARTIFACTS_BUCKET is unset (#5)", async () => {
    await withEnv({ ARTIFACTS_BUCKET: undefined }, async () => {
      const ref = await Effect.runPromise(
        ArtifactsServiceLive.putArtifact(
          "artifacts/agr-1/sales-deck.html",
          "<!DOCTYPE html><html></html>",
          "text/html",
        ),
      );

      expect(ref).toEqual({ key: "artifacts/agr-1/sales-deck.html", bucket: "" });
    });
  });

  it("fails the job when the deck LLM call fails (#5)", async () => {
    const { box, uploads } = makeBoxFake({ files: [] });
    const { llm } = makeRelatedLlmFake({ fail: true });
    const { artifacts, puts } = makeArtifactsFake();

    await expect(runSlides(SLIDES_JOB, box, llm, artifacts)).rejects.toMatchObject({
      _tag: "LlmError",
    });
    expect(uploads).toEqual([]);
    expect(puts).toEqual([]);
  });

  it("fails the job for unresolvable contractFileIds (#5)", async () => {
    const { box } = makeBoxFake({ files: [] });
    const { llm } = makeRelatedLlmFake();
    const { artifacts, puts } = makeArtifactsFake();

    await expect(
      runSlides(
        { contractFileId: "unknown-file", relevantDocumentIds: [], salesNotesFileId: "" },
        box,
        llm,
        artifacts,
      ),
    ).rejects.toMatchObject({ _tag: "ContractResolutionError", contractFileId: "unknown-file" });
    // shared docs are customer-less and cannot be resolved as contracts
    await expect(
      runSlides(
        { contractFileId: "cat-1", relevantDocumentIds: [], salesNotesFileId: "" },
        box,
        llm,
        artifacts,
      ),
    ).rejects.toMatchObject({ _tag: "ContractResolutionError" });
    expect(puts).toEqual([]);

    // through the live handler the failure becomes a batch item failure
    const result = await run(
      salesSlides.handler,
      JSON.stringify({
        contractFileId: "unknown-file",
        relevantDocumentIds: [],
        salesNotesFileId: "",
      }),
    );
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: "msg-0" }]);
  });

  it("routes malformed messages to the dead-letter path instead of crashing", async () => {
    const result = await run(contractScanner.handler, "not json");
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: "msg-0" }]);
  });
});
