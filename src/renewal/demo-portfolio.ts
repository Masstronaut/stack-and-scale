import { createHash } from "node:crypto";
import { reconcileSourceFacts } from "./source-facts.ts";
import { deriveUsageEvidence, validateUsageSources } from "./usage.ts";
import type { Customer, Manifest, Source } from "./model.ts";

export interface DemoBlock {
  id: string;
  kind: "risk" | "opportunity" | "action";
  text: string;
  sourceIds: string[];
}
export interface DemoAccount {
  id: string;
  name: string;
  contact: string;
  owner: string;
  blocks: DemoBlock[];
  sources: { id: string; version: string; name: string; url: string }[];
  facts: { field: string; value: unknown; evidence: unknown[] }[];
  unknowns: string[];
  score: number;
  reason: string;
  components: Record<string, number>;
  snapshotHash: string;
  publicCommercial?: {
    currentContract: string;
    renewalBasis: string;
    expansion: string;
    issue: string;
  };
  selection?: { risks: string[]; opportunities: string[]; actions: string[]; email: string[] };
}
export function prepareDemoAccount(
  customer: Customer,
  sources: Source[],
  manifest: Manifest,
  asOf: string,
): DemoAccount {
  const required = [
    "PROFILE",
    "AGREEMENT",
    "EMAILS",
    "REQUESTS",
    "HISTORY",
    "USAGECSV",
    "USAGE",
    "OBLIGATIONS",
  ];
  if (
    sources.length !== 8 ||
    required.some((t) => sources.filter((s) => s.type === t).length !== 1)
  )
    throw new Error("incomplete-source-set");
  for (const s of sources) {
    if (
      s.customerId !== customer.customer_id ||
      !manifest.documents.some(
        (d) =>
          d.customer_id === customer.customer_id &&
          d.box_folder_id === customer.box_folder_id &&
          d.box_file_id === s.id &&
          d.verified_box_version_id === s.version &&
          d.document_type === s.type &&
          d.provenance === "synthetic",
      )
    )
      throw new Error("manifest-snapshot-mismatch");
    if (s.type !== "USAGECSV" && !s.text.slice(0, 400).includes(customer.customer_name))
      throw new Error("customer-heading-conflict");
  }
  const get = (t: string) => sources.find((s) => s.type === t)!;
  const profile = get("PROFILE"),
    agreement = get("AGREEMENT"),
    emails = get("EMAILS");
  const party = profile.text.split("\n").find((l) => l.startsWith(customer.customer_name + " | "));
  const supplier = party?.split(" | ")[1];
  const role = (label: string) =>
    profile.text.match(new RegExp(label + " ([^|\\n]+)\\s*\\|\\s*([^\\s]+@[^\\s]+)"));
  const owner = role("Account executive"),
    contact = role("Operations contact");
  if (
    !supplier ||
    !owner ||
    !contact ||
    !profile.text.includes("Fictional paying customer and supplier") ||
    !agreement.text.includes(customer.customer_name + " and " + supplier) ||
    !emails.text.includes(`From: ${contact[1].trim()} <${contact[2]}>`) ||
    !emails.text.includes(`To: ${owner[1].trim()} <${owner[2]}>`) ||
    owner[2].split("@")[1] === contact[2].split("@")[1]
  )
    throw new Error("identity-not-corroborated");
  validateUsageSources(customer.customer_id, sources);
  const reconciled = reconcileSourceFacts({ answer: {} }, agreement, customer);
  const end = reconciled.acceptedFacts.find((f) => f.field === "expiration_date");
  const notice = reconciled.acceptedFacts.find((f) => f.field === "notice_deadline");
  if (!end || !notice) throw new Error("essential-deadline-unresolved");
  const expiration = (end.value as { date: string }).date,
    deadline = (notice.value as { date: string }).date;
  for (const [label, date] of [
    ["Term ends, inclusive", expiration],
    ["Written notice / intent deadline", deadline],
  ]) {
    const matches = [
      ...profile.text.matchAll(new RegExp(label + "\\s+(\\d{4}-\\d{2}-\\d{2})", "g")),
    ];
    if (matches.length !== 1 || matches[0][1] !== date)
      throw new Error("cross-document-date-conflict");
  }
  const days = Math.ceil((Date.parse(deadline) - Date.parse(asOf)) / 86400000);
  if (!Number.isFinite(days)) throw new Error("invalid-assessment-date");
  const blocks: DemoBlock[] = [
    {
      id: "term",
      kind: "risk",
      text: `Your current term ends on ${expiration}, with a written notice/intent deadline of ${deadline}.`,
      sourceIds: [agreement.id, profile.id],
    },
    {
      id: "review",
      kind: "action",
      text: "Could we arrange a renewal review to discuss the current agreement and agree on next steps before the notice deadline?",
      sourceIds: [agreement.id, profile.id],
    },
    {
      id: "prepare",
      kind: "opportunity",
      text: "A review of the current agreement and account priorities can help prepare the renewal discussion.",
      sourceIds: [agreement.id, profile.id],
    },
  ];
  const usage = deriveUsageEvidence(customer.customer_id, sources);
  const included = reconciled.acceptedFacts.find((f) => f.field === "included_entitlements");
  const candidates = usage.metrics.filter((m) => m.used <= m.capacity && m.capacity > 0);
  const feature = candidates.find(
    (m) =>
      included &&
      (included.value as { statement: string }).statement
        .toLowerCase()
        .startsWith(m.name.toLowerCase() + " is an included"),
  );
  let adoptionGap = 0;
  if (feature && included) {
    adoptionGap = 1 - feature.used / feature.capacity;
    blocks.push(
      {
        id: "adoption",
        kind: "opportunity",
        text: `${feature.name} is included. The account ledger records ${feature.used} of ${feature.capacity} ${feature.unit} using it during ${feature.period}.`,
        sourceIds: [agreement.id, get("USAGECSV").id],
      },
      {
        id: "enable",
        kind: "action",
        text: `I suggest a walkthrough of the included ${feature.name} to review how it could support your team's workflow.`,
        sourceIds: [agreement.id, get("USAGECSV").id],
      },
    );
  }
  const mechanism = reconciled.acceptedFacts.find((f) => f.field === "renewal_mechanism");
  if (mechanism)
    blocks.push({
      id: "extension",
      kind: "risk",
      text: "Extension requires mutual written agreement.",
      sourceIds: [agreement.id],
    });
  const roadmap = reconciled.acceptedFacts.find((f) => f.field === "roadmap_exclusions");
  if (roadmap)
    blocks.push({
      id: "roadmap",
      kind: "risk",
      text: (roadmap.value as { statement: string }).statement + ".",
      sourceIds: [agreement.id],
    });
  // Impact is relative demonstrated workflow impact, never nominal cross-currency cash.
  const urgency = days < 0 ? 1 : Math.max(0, 1 - days / 120);
  const impact = feature ? adoptionGap : 0.25;
  const actionability = feature ? 0.9 : 0.65;
  const evidenceQuality = 1; // Eight scoped snapshots, corroborated identity and dates.
  const score =
    100 * (0.35 * urgency + 0.2 * impact + 0.3 * actionability + 0.15 * evidenceQuality);
  const reason = `${days < 0 ? "Notice deadline passed" : `Notice due in ${days} days`}${feature ? `; ${feature.used}/${feature.capacity} ${feature.unit} using the included ${feature.name}` : "; prepare the renewal review"}.`;
  return {
    id: customer.customer_id,
    name: customer.customer_name,
    contact: contact[1].trim(),
    owner: owner[1].trim(),
    blocks,
    sources: sources.map((s) => ({
      id: s.id,
      version: s.version,
      name: s.name,
      url: `https://app.box.com/file/${s.id}`,
    })),
    facts: [
      ...reconciled.acceptedFacts,
      ...usage.claims.map((c) => ({ field: c.id, value: c.text, evidence: c.citations })),
    ],
    unknowns: reconciled.decisions
      .filter((d) => d.status !== "accepted" && d.field !== "customer_name")
      .map((d) => d.field),
    score,
    reason,
    components: { urgency, impact, actionability, evidenceQuality },
    snapshotHash: createHash("sha256").update(JSON.stringify(sources)).digest("hex"),
  };
}
export function acceptDemoSelection(account: DemoAccount, input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("invalid-model-selection");
  const v = input as Record<string, unknown>;
  if (Object.keys(v).sort().join(",") !== "actions,email,opportunities,risks")
    throw new Error("unsupported-model-output");
  for (const key of ["risks", "opportunities", "actions", "email"]) {
    const ids = v[key];
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 8 || new Set(ids).size !== ids.length)
      throw new Error("invalid-block-list");
    for (const id of ids) {
      const b = account.blocks.find((b) => b.id === id);
      if (
        !b ||
        (key !== "email" &&
          b.kind !==
            (
              { risks: "risk", opportunities: "opportunity", actions: "action" } as Record<
                string,
                string
              >
            )[key])
      )
        throw new Error("unsupported-model-claim");
    }
  }
  if (!(v.email as string[]).includes("term") || !(v.email as string[]).includes("review"))
    throw new Error("incomplete-email");
  return { ...account, selection: v as DemoAccount["selection"] };
}
export function rankDemoAccounts(accounts: DemoAccount[]) {
  return [...accounts].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 5);
}
export function demoDraft(a: DemoAccount) {
  if (!a.selection) throw new Error("unverified-model-selection");
  const blocks = a.selection.email.map((id) => a.blocks.find((b) => b.id === id)!);
  const ids = new Set(blocks.flatMap((b) => b.sourceIds));
  return {
    customerId: a.id,
    name: a.name,
    mode: "live",
    email: {
      subject: `Renewal review — ${a.name}`,
      body: `Hi ${a.contact.split(" ")[0]},\n\n${blocks.map((b) => b.text).join("\n\n")}\n\nBest,\n${a.owner}`,
    },
    sources: a.sources.filter((s) => ids.has(s.id)),
    claims: blocks.map((b) => ({ text: b.text, sourceIds: b.sourceIds })),
    verification: "verified-cached",
    ...(a.publicCommercial ? { publicCommercial: a.publicCommercial } : {}),
    notice:
      "Verified Box snapshots · reviewed source-backed wording, served from cache. Fictional scenario; preview only. Current fees are not a new renewal quote; proposals are not accepted purchases. No new model call or email send.",
  };
}
