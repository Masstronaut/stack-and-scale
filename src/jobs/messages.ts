// Job messages passed between the worker queues (issues #2-#5). Each worker
// consumes its own SQS queue; these are the JSON bodies of those messages.

// Worker #2 (contractScanner): kick off a full pass over box.
export interface ScanContractsJob {
  readonly source: "manual" | "schedule";
}

// Worker #3 (relatedDocuments): analyze one contract.
export interface RelatedDocumentsJob {
  readonly contractFileId: string;
}

// Worker #4 (salesNotes): draft notes for one contract.
export interface SalesNotesJob {
  readonly contractFileId: string;
  readonly relevantDocumentIds: readonly string[];
}

// Worker #5 (salesSlides): build the deck for one contract.
export interface SalesSlidesJob {
  readonly contractFileId: string;
  readonly relevantDocumentIds: readonly string[];
  readonly salesNotesFileId: string;
}

export type PipelineJob = ScanContractsJob | RelatedDocumentsJob | SalesNotesJob | SalesSlidesJob;
