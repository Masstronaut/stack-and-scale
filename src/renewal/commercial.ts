import { normalizePassage, sourcePassages } from "./passages.ts";

export interface CommercialFact {
  kind: "recurring" | "variable" | "noncash" | "included" | "optional" | "billing";
  amount: string | null;
  currency: string | null;
  period: string | null;
  basis: string | null;
  commitment: "current-contract" | "optional-not-committed";
  statement: string;
}
const uncertain =
  /\b(?:propos\w*|draft|negotiat\w*|estimate\w*|forecast\w*|planned|roadmap|if|unless|may|could|subject to|pending|historical|previous|superseded)\b/i;
const optional = /\b(?:optional|add-on|separate(?:ly)? purchas\w*)\b/i;
const periodPatterns: [string, RegExp][] = [
  ["month", /\b(?:monthly|per month|a month)\b/i],
  ["year", /\b(?:annual(?:ly)?|yearly|per year|a year)\b/i],
  ["quarter", /\b(?:quarterly|per quarter)\b/i],
  ["one-time", /\b(?:one-time|one-off)\b/i],
];

/** Conservative grammar for explicit contract clauses, not general legal NLP.
 * Unrecognized/multi-part terms stay unresolved instead of becoming ARR. */
export function parseCommercialClause(field: string, text: string): CommercialFact | null {
  const s = normalizePassage(text);
  if (/\b(?:not included|not committed|not signed|excluded|no obligation)\b/i.test(s)) return null;
  const isOptional = optional.test(s);
  if (field !== "optional_purchases" && (uncertain.test(s) || isOptional)) return null;
  if (field === "optional_purchases") {
    if (!isOptional) return null;
    return {
      kind: "optional",
      amount: null,
      currency: null,
      period: null,
      basis: null,
      commitment: "optional-not-committed",
      statement: s,
    };
  }
  if (field === "included_entitlements") {
    if (!/\b(?:included|entitlement|allowance|licensed scope)\b/i.test(s)) return null;
    return {
      kind: "included",
      amount: null,
      currency: null,
      period: null,
      basis: null,
      commitment: "current-contract",
      statement: s,
    };
  }
  if (field === "billing_terms") {
    if (!/\b(?:billed|billing|invoiced|payment|payable)\b/i.test(s)) return null;
    const periods = periodPatterns.filter(([, p]) => p.test(s));
    if (periods.length !== 1) return null;
    return {
      kind: "billing",
      amount: null,
      currency: null,
      period: periods[0][0],
      basis: null,
      commitment: "current-contract",
      statement: s,
    };
  }
  if (field !== "commercial_terms") return null;
  if (/\bnon-?cash consideration\b/i.test(s)) {
    if (/\b[A-Z]{3}\s+\d|[$€£¥]/.test(s)) return null;
    return {
      kind: "noncash",
      amount: null,
      currency: null,
      period: null,
      basis: null,
      commitment: "current-contract",
      statement: s,
    };
  }
  const money = [
    ...s.matchAll(
      /\b(USD|EUR|GBP|CHF|CAD|AUD|JPY)\s+((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)(?![\d.,])/g,
    ),
  ];
  if (money.length !== 1 || /[$€£¥]|\d%|\d\s*percent/i.test(s)) return null;
  if (!/\b(?:fee|price|consideration|payment)\b/i.test(s)) return null;
  const periods = periodPatterns.filter(([, p]) => p.test(s));
  if (periods.length !== 1) return null;
  const perUnit = s.match(/\bper\s+(seat|user|transaction|unit|subscriber|request)\b/i);
  const variable = /\b(?:variable|usage-based|overage)\b/i.test(s) || !!perUnit;
  if (periods[0][0] === "one-time") return null; // not recurring; extend schema explicitly before using
  return {
    kind: variable ? "variable" : "recurring",
    amount: money[0][2].replaceAll(",", ""),
    currency: money[0][1],
    period: periods[0][0],
    basis: perUnit ? `per ${perUnit[1].toLowerCase()}` : variable ? null : "fixed",
    commitment: "current-contract",
    statement: s,
  };
}

export function verifyCommercial(
  field: string,
  value: string,
  contexts: string[],
  document: string,
) {
  const candidates = contexts
    .map((c) => parseCommercialClause(field, c))
    .filter((f): f is CommercialFact => !!f);
  if (candidates.length !== 1) return { code: "commercial-role-or-basis-unresolved", fact: null };
  const fact = candidates[0];
  // Model prose is never propagated: it must express the same entire tuple or
  // select an exact source span. Final factual text is rendered from source.
  const proposed = parseCommercialClause(field, value);
  const tuple = (f: CommercialFact) =>
    JSON.stringify([f.kind, f.amount, f.currency, f.period, f.basis, f.commitment]);
  if (
    !normalizePassage(fact.statement).includes(normalizePassage(value)) &&
    (!proposed ||
      tuple(proposed) !== tuple(fact) ||
      normalizePassage(proposed.statement) !== normalizePassage(fact.statement))
  )
    return { code: "commercial-interpretation-unsupported", fact: null };
  const all = sourcePassages(document)
    .map((p) => parseCommercialClause(field, p.text))
    .filter((f): f is CommercialFact => !!f);
  // Multiple competing clauses require reconciliation; never pick the convenient price.
  if (new Set(all.map((f) => JSON.stringify(f))).size > 1)
    return { code: "conflicting-commercial-terms", fact: null };
  if (uncertain.test(document) && /\b(?:amendment|amended|supersedes)\b/i.test(document))
    return { code: "commercial-amendment-unresolved", fact: null };
  return { code: "commercial-tuple-supported", fact };
}
