import manifest from "../../docs/dataset/box-manifest.json" with { type: "json" };

// The committed box manifest (docs/dataset/box-manifest.json) maps the 24
// fictional customers to their box folders/files for the renewal demo. See
// docs/dataset/WORKERS.md for the worker retrieval contract.

export interface ManifestCustomer {
  readonly customer_id: string;
  readonly customer_name: string;
  readonly box_folder_id: string;
  readonly box_folder_url?: string;
  readonly source_contract_id: string;
  readonly source_box_file_id: string;
  readonly document_types: readonly string[];
}

export interface ManifestDocument {
  readonly document_id: string;
  /** null for the customer-less shared Product Knowledge files. */
  readonly customer_id: string | null;
  readonly document_type: string;
  readonly provenance: string;
  readonly filename: string;
  readonly box_folder_id: string;
  readonly box_file_id: string;
  readonly box_url?: string;
  readonly verified_box_version_id?: string;
}

export interface BoxManifest {
  readonly customers: readonly ManifestCustomer[];
  readonly documents: readonly ManifestDocument[];
}

/** The manifest committed with the repo (ships inside the lambda bundle). */
export const loadManifest = (): BoxManifest => manifest;

/**
 * The scan targets for worker #2: the synthetic per-account AGREEMENT files.
 * The historical CUAD originals (`source_box_file_id`) are source evidence,
 * never scan targets, so any id collision is excluded defensively.
 */
export const selectAgreementFiles = (boxManifest: BoxManifest): readonly ManifestDocument[] => {
  const originalFileIds = new Set(
    boxManifest.customers.map((customer) => customer.source_box_file_id),
  );
  return boxManifest.documents.filter(
    (document) =>
      document.document_type === "AGREEMENT" && !originalFileIds.has(document.box_file_id),
  );
};

/**
 * Exact box_file_id lookup for worker #3 contract resolution. Returns
 * undefined for unknown or ambiguous ids so callers can fail instead of
 * guessing.
 */
export const findDocumentByFileId = (
  boxManifest: BoxManifest,
  boxFileId: string,
): ManifestDocument | undefined => {
  const matches = boxManifest.documents.filter((document) => document.box_file_id === boxFileId);
  return matches.length === 1 ? matches[0] : undefined;
};

/** All of one customer's manifest documents, in manifest order. */
export const selectCustomerFiles = (
  boxManifest: BoxManifest,
  customerId: string,
): readonly ManifestDocument[] =>
  boxManifest.documents.filter((document) => document.customer_id === customerId);

/**
 * The customer-less shared Product Knowledge references (catalog, release
 * notes, roadmap, pricing tiers), in manifest order.
 */
export const selectSharedKnowledgeFiles = (boxManifest: BoxManifest): readonly ManifestDocument[] =>
  boxManifest.documents.filter((document) => document.document_type === "PRODUCT_KNOWLEDGE");
