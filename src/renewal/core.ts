import { createHash, randomUUID } from "node:crypto";
import type {
  Analysis,
  Customer,
  Manifest,
  ManifestDocument,
  Portfolio,
  RankedAccount,
  Source,
  VerifiedAccount,
} from "./model.ts";

const kinds = new Set(["deadline", "service", "adoption", "capacity", "preparation"]);
const valueKinds = new Set(["recurring", "variable", "noncash", "unknown"]);
const normalized = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

export function daysUntil(asOf: string, date: string | null): number | null {
  if (date === null) return null;
  const parse = (input: string) => {
    assert(/^\d{4}-\d{2}-\d{2}$/.test(input), "Invalid date format");
    const time = Date.parse(`${input}T00:00:00Z`);
    assert(
      Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === input,
      "Invalid calendar date",
    );
    return time;
  };
  return Math.round((parse(date) - parse(asOf)) / 86400000);
}

export function validateManifest(manifest: Manifest) {
  assert(
    manifest.customers.length === 24 && manifest.documents.length === 220,
    "Expected the approved 24-customer / 220-file manifest",
  );
  assert(new Set(manifest.customers.map((c) => c.customer_id)).size === 24, "Duplicate customer");
  assert(new Set(manifest.documents.map((d) => d.box_file_id)).size === 220, "Duplicate file");
  assert(
    manifest.documents.filter((d) => d.document_type === "PRODUCT_KNOWLEDGE").length === 4,
    "Missing shared references",
  );
  for (const c of manifest.customers) {
    const docs = manifest.documents.filter(
      (d) => d.customer_id === c.customer_id && d.provenance === "synthetic",
    );
    assert(
      docs.length === 8 && docs.every((d) => d.box_folder_id === c.box_folder_id),
      "Invalid customer document scope",
    );
    assert(
      docs.filter((d) => d.document_type === "AGREEMENT").length === 1,
      "Expected one active demo agreement",
    );
  }
  for (const doc of manifest.documents)
    assert(
      /^\d+$/.test(doc.box_file_id) && /^\d+$/.test(doc.verified_box_version_id),
      "Invalid Box identity",
    );
}

export function selectDocuments(manifest: Manifest, customerId: string): ManifestDocument[] {
  assert(
    manifest.customers.some((c) => c.customer_id === customerId),
    "Unknown customer",
  );
  return manifest.documents.filter(
    (d) =>
      (d.customer_id === customerId && d.provenance === "synthetic") ||
      d.document_type === "PRODUCT_KNOWLEDGE",
  );
}

/** Strict runtime boundary for untrusted model output. This is not a legal/semantic guarantee. */
export function parseAnalysis(raw: unknown): Analysis {
  assert(raw && typeof raw === "object", "Analysis must be an object");
  const a = raw as Analysis;
  const text = (v: unknown, max = 2000) => typeof v === "string" && v.length > 0 && v.length <= max;
  assert(text(a.customerId) && text(a.offering), "Missing account identity");
  assert(Array.isArray(a.claims) && a.claims.length > 0 && a.claims.length <= 60, "Invalid claims");
  assert(new Set(a.claims.map((c) => c.id)).size === a.claims.length, "Duplicate claim IDs");
  for (const c of a.claims) {
    assert(
      text(c.id) &&
        text(c.text) &&
        Array.isArray(c.citations) &&
        c.citations.length > 0 &&
        c.citations.length <= 8,
      "Invalid claim",
    );
    for (const r of c.citations)
      assert(
        text(r.sourceId) && text(r.version) && text(r.quote, 3000) && r.quote.trim().length >= 8,
        "Invalid citation",
      );
  }
  assert(
    a.value && valueKinds.has(a.value.kind) && text(a.value.period) && text(a.value.claimId),
    "Invalid consideration",
  );
  assert(
    a.value.amount === null || (Number.isFinite(a.value.amount) && a.value.amount >= 0),
    "Invalid amount",
  );
  assert(a.value.currency === null || /^[A-Z]{3}$/.test(a.value.currency), "Invalid currency");
  assert(
    a.value.amount === null || a.value.currency !== null,
    "An amount requires an original currency",
  );
  assert(
    a.value.kind !== "noncash" || a.value.amount === null,
    "Noncash cannot be invented cash value",
  );
  for (const date of [a.expiration, a.notice])
    assert(
      date === null || (typeof date === "string" && daysUntil("2026-10-17", date) !== null),
      "Invalid date",
    );
  assert(typeof a.noticeConvention === "string", "Missing notice convention");
  assert(a.expirationClaimId === null || text(a.expirationClaimId), "Invalid expiration source");
  assert(a.noticeClaimId === null || text(a.noticeClaimId), "Invalid notice source");
  assert(
    Array.isArray(a.opportunities) && a.opportunities.length > 0 && a.opportunities.length <= 8,
    "Missing opportunities",
  );
  const ids = new Set(a.claims.map((c) => c.id));
  const refs = (r: unknown): r is string[] =>
    Array.isArray(r) && r.length > 0 && r.every((id) => typeof id === "string" && ids.has(id));
  assert(ids.has(a.value.claimId), "Missing value evidence");
  for (const id of [a.expirationClaimId, a.noticeClaimId])
    assert(id === null || ids.has(id), "Missing date evidence");
  assert(a.expiration === null || a.expirationClaimId !== null, "Expiration requires evidence");
  assert(a.notice === null || a.noticeClaimId !== null, "Notice requires evidence");
  for (const o of a.opportunities)
    assert(
      kinds.has(o.kind) &&
        text(o.title, 120) &&
        text(o.reason) &&
        text(o.action) &&
        refs(o.claimIds) &&
        Number.isInteger(o.impact) &&
        o.impact >= 0 &&
        o.impact <= 4 &&
        Number.isInteger(o.actionability) &&
        o.actionability >= 0 &&
        o.actionability <= 4,
      "Invalid opportunity",
    );
  assert(Array.isArray(a.metrics) && a.metrics.length <= 20, "Invalid metrics");
  for (const m of a.metrics)
    assert(
      text(m.name) &&
        text(m.unit) &&
        text(m.period) &&
        typeof m.partial === "boolean" &&
        Number.isFinite(m.used) &&
        m.used >= 0 &&
        Number.isFinite(m.capacity) &&
        m.capacity > 0 &&
        refs(m.claimIds),
      "Invalid metric",
    );
  assert(
    Array.isArray(a.unknowns) && a.unknowns.length <= 30 && a.unknowns.every((s) => text(s)),
    "Invalid unknowns",
  );
  return a;
}

export function verifyAnalysis(
  raw: unknown,
  customer: Customer,
  sources: Source[],
  asOf: string,
  fixture = false,
): VerifiedAccount {
  const a = parseAnalysis(raw);
  assert(a.customerId === customer.customer_id, "Cross-customer analysis rejected");
  const byId = new Map(sources.map((s) => [s.id, s]));
  for (const claim of a.claims)
    for (const r of claim.citations) {
      const s = byId.get(r.sourceId);
      assert(
        s && (s.customerId === customer.customer_id || s.customerId === null),
        "Citation outside account scope",
      );
      assert(s.version === r.version, "Citation version mismatch");
      assert(normalized(s.text).includes(normalized(r.quote)), "Unsupported citation passage");
    }
  const quoteFor = (id: string | null) =>
    a.claims
      .find((c) => c.id === id)
      ?.citations.map((c) => c.quote)
      .join(" ") ?? "";
  // Require ISO dates in source evidence; ambiguous natural-language dates require review.
  if (a.expiration)
    assert(
      quoteFor(a.expirationClaimId).includes(a.expiration),
      "Expiration does not match cited evidence",
    );
  if (a.notice)
    assert(quoteFor(a.noticeClaimId).includes(a.notice), "Notice does not match cited evidence");
  const numbers = (s: string) =>
    (s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => Number(n.replaceAll(",", "")));
  if (a.value.amount !== null) {
    const quote = quoteFor(a.value.claimId);
    assert(
      quote.includes(a.value.currency!) && numbers(quote).includes(a.value.amount),
      "Money does not match cited amount/currency",
    );
  }
  for (const m of a.metrics) {
    const n = numbers(m.claimIds.map(quoteFor).join(" "));
    assert(n.includes(m.used) && n.includes(m.capacity), "Metric inputs absent from evidence");
  }
  const referenced = new Set(a.claims.flatMap((c) => c.citations.map((r) => r.sourceId)));
  return {
    customerId: customer.customer_id,
    name: customer.customer_name,
    analysis: a,
    daysToExpiration: daysUntil(asOf, a.expiration),
    daysToNotice: daysUntil(asOf, a.notice),
    evidenceQuality: Math.min(1, referenced.size / 5),
    metrics: a.metrics.map((m) => ({
      ...m,
      percent: Math.round((m.used / m.capacity) * 1000) / 10,
    })),
    sources: sources
      .filter((s) => referenced.has(s.id))
      .map((s) => ({
        id: s.id,
        version: s.version,
        name: s.name,
        url: fixture ? "" : `https://app.box.com/file/${s.id}`,
      })),
    verification: fixture ? "fixture" : "source-matched",
  };
}

export function formatValue(a: Analysis) {
  const v = a.value;
  if (v.kind === "noncash") return "Noncash consideration";
  if (v.amount === null || !v.currency) return "Value requires review";
  return `${new Intl.NumberFormat("en-US", { style: "currency", currency: v.currency, currencyDisplay: "code", maximumFractionDigits: 0 }).format(v.amount)} · ${v.period}${v.kind === "variable" ? " · variable" : ""}`;
}

function urgency(a: VerifiedAccount) {
  const days = [a.daysToNotice, a.daysToExpiration].filter((v): v is number => v !== null);
  if (!days.length) return 0.3;
  const nearest = Math.min(...days);
  return nearest < 0
    ? 1
    : nearest <= 14
      ? 1
      : nearest <= 30
        ? 0.9
        : nearest <= 60
          ? 0.7
          : nearest <= 90
            ? 0.5
            : 0.2;
}

export function rankAccounts(accounts: VerifiedAccount[]): RankedAccount[] {
  return accounts
    .map((a) => {
      const primary = [...a.analysis.opportunities].sort(
        (x, y) =>
          y.impact + y.actionability - (x.impact + x.actionability) ||
          x.title.localeCompare(y.title),
      )[0];
      const scores = {
        urgency: urgency(a),
        impact: primary.impact / 4,
        actionability: primary.actionability / 4,
        evidence: a.evidenceQuality,
      };
      const score = Math.round(
        (scores.urgency * 0.35 +
          scores.impact * 0.2 +
          scores.actionability * 0.3 +
          scores.evidence * 0.15) *
          100,
      );
      const bullets = a.analysis.opportunities
        .map((o) => `• ${o.title}: ${o.reason}\n  Suggested action: ${o.action}`)
        .join("\n\n");
      const evidence = a.sources
        .map(
          (s) =>
            `${s.name}${s.url ? `: ${s.url}` : " (fixture evidence, not a Box document)"} [version ${s.version}]`,
        )
        .join("\n");
      const email = {
        subject: `Renewal preparation | ${a.name}`,
        body: `PRIVATE · INTERNAL AE BRIEF\nSynthetic demo data · ${a.verification === "fixture" ? "FIXTURE PREVIEW — not a real customer analysis" : "Source passages matched; commercial/semantic review required"}\n\nHello account team,\n\nPrioritize ${a.name}: ${primary.reason}\n\nContract consideration: ${formatValue(a.analysis)}\nExpiration: ${a.analysis.expiration ?? "Unknown — confirm"}${a.daysToExpiration === null ? "" : ` (${a.daysToExpiration} days)`}\nNotice deadline: ${a.analysis.notice ?? "Unknown — confirm"}${a.daysToNotice === null ? "" : ` (${a.daysToNotice} days)`}\nNotice convention: ${a.analysis.noticeConvention || "Confirm against agreement"}\n\n${bullets}\n\n${a.metrics.map((m) => `${m.name}: ${m.used.toLocaleString()} / ${m.capacity.toLocaleString()} ${m.unit} (${m.percent}%) · ${m.period}${m.partial ? " · partial observation window" : ""}`).join("\n")}\n\nOpen questions:\n${a.analysis.unknowns.map((s) => `• ${s}`).join("\n") || "• Confirm customer priorities in the renewal review."}\n\nRecommended next step: ${primary.action}\n\nSource register:\n${evidence}\n\nPrepared by The Renewer · Stack & Scale`,
      };
      return { ...a, score, scores, primary, email, rank: 0 };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.daysToNotice ?? Infinity) - (b.daysToNotice ?? Infinity) ||
        a.customerId.localeCompare(b.customerId),
    )
    .map((a, i) => ({ ...a, rank: i + 1 }));
}

export async function analyzePortfolio(
  manifest: Manifest,
  provider: {
    read: (d: ManifestDocument) => Promise<Source>;
    analyze: (customer: Customer, sources: Source[]) => Promise<unknown>;
  },
  onProgress: (event: { stage: string; completed: number; total: number; detail: string }) => void,
  asOf = new Date().toISOString().slice(0, 10),
): Promise<Portfolio> {
  validateManifest(manifest);
  const cache = new Map<string, Source>();
  const accounts: VerifiedAccount[] = [];
  for (const customer of manifest.customers) {
    onProgress({
      stage: "retrieving",
      completed: accounts.length,
      total: 24,
      detail: `Reading ${customer.customer_name}`,
    });
    const sources = [];
    for (const doc of selectDocuments(manifest, customer.customer_id)) {
      let source = cache.get(doc.box_file_id);
      if (!source) {
        source = await provider.read(doc);
        assert(
          source.id === doc.box_file_id &&
            source.version === doc.verified_box_version_id &&
            source.customerId === doc.customer_id,
          "Source identity/version drift",
        );
        assert(
          source.text.length > 0 && source.text.length <= 150000,
          "Source missing or exceeds content limit",
        );
        cache.set(source.id, source);
      }
      sources.push(source);
    }
    onProgress({
      stage: "analyzing",
      completed: accounts.length,
      total: 24,
      detail: `Nova reviewing ${customer.customer_name}`,
    });
    const result = await provider.analyze(customer, sources);
    accounts.push(verifyAnalysis(result, customer, sources, asOf));
    onProgress({
      stage: "verifying",
      completed: accounts.length,
      total: 24,
      detail: `${customer.customer_name}: source passages matched`,
    });
  }
  assert(accounts.length === 24, "Incomplete portfolio cannot be published as top five");
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([...cache.values()].map((s) => [s.id, s.version]).sort()))
    .digest("hex");
  const ranked = rankAccounts(accounts);
  onProgress({
    stage: "complete",
    completed: 24,
    total: 24,
    detail: "Portfolio ranked; top five ready for review",
  });
  return {
    id: randomUUID(),
    mode: "live",
    asOf,
    generatedAt: new Date().toISOString(),
    sourceFingerprint: fingerprint,
    customersEvaluated: 24,
    sourceDocuments: 220,
    retrievedDocuments: cache.size,
    model: "Amazon Nova 2 Lite",
    accounts: ranked,
    topFive: ranked.slice(0, 5),
  };
}
