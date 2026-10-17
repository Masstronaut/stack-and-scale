// Job messages passed between the worker queues (issues #2-#5). Each worker
// consumes its own SQS queue; these are the JSON bodies of those messages.
//
// `runId` ties every queue hop of one pipeline pass together for run tracking
// (S3 run records, see src/services/runs.ts). Worker #2 generates it; older
// messages without one are still valid - workers then skip run tracking.

// Worker #2 (contractScanner): kick off a full pass over box.
export interface ScanContractsJob {
  readonly source: "manual" | "schedule";
  readonly runId?: string;
}

// Worker #3 (relatedDocuments): analyze one contract.
export interface RelatedDocumentsJob {
  readonly contractFileId: string;
  readonly runId?: string;
}

// docDigest: compress the related documents into compact per-document
// digest blocks so salesNotes stays within LLM input-token limits (the
// full-text prompt truncated on large accounts). Sits between
// relatedDocuments and salesNotes in the pipeline.
export interface DocDigestJob {
  readonly contractFileId: string;
  readonly relevantDocumentIds: readonly string[];
  readonly runId?: string;
}

// Worker #4 (salesNotes): draft notes for one contract. `digestKey` points
// at the docDigest artifact to use as primary context; empty/absent means
// the legacy path (read the related documents directly).
export interface SalesNotesJob {
  readonly contractFileId: string;
  readonly relevantDocumentIds: readonly string[];
  readonly digestKey?: string;
  readonly runId?: string;
}

// Worker #5 (salesSlides): build the deck for one contract.
export interface SalesSlidesJob {
  readonly contractFileId: string;
  readonly relevantDocumentIds: readonly string[];
  readonly salesNotesFileId: string;
  readonly runId?: string;
}

export type PipelineJob =
  | ScanContractsJob
  | RelatedDocumentsJob
  | DocDigestJob
  | SalesNotesJob
  | SalesSlidesJob;
