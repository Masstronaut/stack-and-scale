export type ValueKind = "recurring" | "variable" | "noncash" | "unknown";
export type PriorityKind = "deadline" | "service" | "adoption" | "capacity" | "preparation";

export interface Source {
  id: string;
  version: string;
  customerId: string | null;
  name: string;
  type: string;
  text: string;
}

export interface Citation {
  sourceId: string;
  version: string;
  quote: string;
}

export interface Claim {
  id: string;
  text: string;
  citations: Citation[];
}

export interface Analysis {
  customerId: string;
  offering: string;
  value: {
    amount: number | null;
    currency: string | null;
    period: string;
    kind: ValueKind;
    claimId: string;
  };
  expiration: string | null;
  expirationClaimId: string | null;
  notice: string | null;
  noticeClaimId: string | null;
  noticeConvention: string;
  claims: Claim[];
  opportunities: {
    kind: PriorityKind;
    title: string;
    reason: string;
    action: string;
    claimIds: string[];
    actionability: number;
    impact: number;
  }[];
  metrics: {
    name: string;
    used: number;
    capacity: number;
    unit: string;
    period: string;
    partial: boolean;
    claimIds: string[];
  }[];
  unknowns: string[];
}

export interface Customer {
  customer_id: string;
  customer_name: string;
  box_folder_id: string;
}

export interface ManifestDocument {
  customer_id: string | null;
  document_type: string;
  provenance: string;
  filename: string;
  box_folder_id: string;
  box_file_id: string;
  verified_box_version_id: string;
}

export interface Manifest {
  customers: Customer[];
  documents: ManifestDocument[];
}

export interface VerifiedAccount {
  customerId: string;
  name: string;
  analysis: Analysis;
  daysToExpiration: number | null;
  daysToNotice: number | null;
  evidenceQuality: number;
  metrics: (Analysis["metrics"][number] & { percent: number })[];
  sources: { id: string; version: string; name: string; url: string }[];
  verification: "source-matched" | "fixture";
}

export interface RankedAccount extends VerifiedAccount {
  rank: number;
  score: number;
  scores: { urgency: number; impact: number; actionability: number; evidence: number };
  primary: Analysis["opportunities"][number];
  email: { subject: string; body: string };
}

export interface Portfolio {
  id: string;
  mode: "live" | "fixture";
  asOf: string;
  generatedAt: string;
  sourceFingerprint: string;
  customersEvaluated: number;
  sourceDocuments: number;
  retrievedDocuments: number;
  model: string;
  accounts: RankedAccount[];
  topFive: RankedAccount[];
}
