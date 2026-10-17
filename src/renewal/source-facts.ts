import { createHash } from "node:crypto";
import type { Source, Customer } from "./model.ts";
import { verifyBoxExtraction } from "./box-extract.ts";
import { normalizePassage } from "./passages.ts";

export interface GroundedFact {
  field: string;
  value: unknown;
  origin: "deterministic-source";
  evidence: {
    id: string;
    fileId: string;
    version: string;
    start: number;
    end: number;
    text: string;
  }[];
  provenance: "synthetic-scenario" | "document-statement";
}
export interface SourceDecision {
  field: string;
  status: "accepted" | "rejected" | "unresolved";
  code: string;
  fact?: GroundedFact;
}
const validDate = (v: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;

/** Recover explicit source facts independently of model omissions. The model's
 * failed claims remain in modelChecks; they are never relabeled as verified. */
export function reconcileSourceFacts(response: unknown, source: Source, customer: Customer) {
  if (source.type !== "AGREEMENT" || source.customerId !== customer.customer_id)
    throw new Error("Agreement scope mismatch");
  const modelChecks = verifyBoxExtraction(
    response,
    source,
    customer.customer_name,
    customer.customer_id,
  );
  const text = source.text;
  const bodyEnd = text.indexOf("Sources and related records");
  const body = bodyEnd < 0 ? text : text.slice(0, bodyEnd);
  const provenance = /SYNTHETIC DEMO DATA/.test(body)
    ? ("synthetic-scenario" as const)
    : ("document-statement" as const);
  const decisions: SourceDecision[] = [];
  const unresolved = (field: string, code: string) =>
    decisions.push({ field, status: "unresolved", code });
  const accepted = (field: string, value: unknown, matches: RegExpMatchArray[]) => {
    const evidence = matches.map((m) => {
      const start = m.index!,
        end = start + m[0].length;
      return {
        id:
          "E" +
          createHash("sha256")
            .update(JSON.stringify([source.id, source.version, start, end]))
            .digest("hex")
            .slice(0, 20),
        fileId: source.id,
        version: source.version,
        start,
        end,
        text: text.slice(start, end),
      };
    });
    decisions.push({
      field,
      status: "accepted",
      code: "explicit-source-supported",
      fact: { field, value, origin: "deterministic-source", evidence, provenance },
    });
  };
  const unique = (pattern: RegExp) => [...body.matchAll(pattern)];
  // Parties' order is not proof of role. Require a customer/buyer/licensee label.
  const parties = unique(/^\s*(?:Customer|Buyer|Licensee)\s*[:|]\s*([^\n]+)$/gm);
  if (
    parties.length === 1 &&
    normalizePassage(parties[0][1]) === normalizePassage(customer.customer_name)
  )
    accepted("customer_name", customer.customer_name, parties);
  else unresolved("customer_name", "party-role-not-established");
  // A title on its own line in the leading document header, not bibliography hits.
  const titles = unique(/^\s*(Renewal Agreement|Service Agreement|License Agreement)\s*$/gm).filter(
    (m) => m.index! < 600,
  );
  if (titles.length === 1)
    accepted("agreement_identity", { title: titles[0][1], fileName: source.name }, titles);
  else unresolved("agreement_identity", "document-heading-ambiguous");
  const terms = unique(
    /^\s*Current term\s*[:|]?\s*(\d{4}-\d{2}-\d{2})\s+(?:through|to)\s+(\d{4}-\d{2}-\d{2})(?:\s+inclusive)?\s*$/gm,
  );
  const otherEnds = unique(
    /(?:expiration|expiry|term end)(?: date)?\s*[:|]\s*(\d{4}-\d{2}-\d{2})/gi,
  );
  if (
    terms.length === 1 &&
    validDate(terms[0][1]) &&
    validDate(terms[0][2]) &&
    terms[0][1] <= terms[0][2] &&
    otherEnds.every((m) => m[1] === terms[0][2])
  )
    accepted(
      "expiration_date",
      {
        date: terms[0][2],
        termStart: terms[0][1],
        meaning: "current-term-end-not-automatic-renewal",
      },
      terms,
    );
  else unresolved("expiration_date", "term-range-missing-or-conflicting");
  const notices = unique(
    /^\s*(?:Written notice\s*\/\s*intent deadline|Written notice deadline|Notice deadline)\s*[:|]?\s*(\d{4}-\d{2}-\d{2})\s*$/gm,
  );
  const convention = unique(/^\s*Receipt convention[^\n]+/gm),
    delivery = unique(/^\s*Delivery method[^\n]+/gm);
  if (
    notices.length === 1 &&
    validDate(notices[0][1]) &&
    convention.length === 1 &&
    delivery.length === 1
  )
    accepted(
      "notice_deadline",
      {
        date: notices[0][1],
        meaning: "written-notice-or-intent-deadline",
        receiptConvention: normalizePassage(convention[0][0]),
        delivery: normalizePassage(delivery[0][0]),
      },
      [...notices, ...convention, ...delivery],
    );
  else unresolved("notice_deadline", "notice-context-missing-or-conflicting");
  const mechanisms = unique(/^\s*Renewal mechanism\s*[:|]?\s*(Mutual written extension)\s*$/gm);
  if (mechanisms.length === 1)
    accepted(
      "renewal_mechanism",
      { mechanism: "mutual-written-extension", automaticRenewal: false },
      mechanisms,
    );
  else unresolved("renewal_mechanism", "explicit-mechanism-unavailable");
  for (const field of ["renewal_date", "termination_date", "optional_purchases"])
    unresolved(field, "no-explicit-supported-value");

  // Reconcile table labels inside the commercial schedule only. Explicit credit
  // wording and formula are both required; addition/offset cannot be guessed.
  const sections = unique(/Commercial schedule[\s\S]*?(?=\n\s*\d+\.\s|$)/g);
  if (sections.length === 1) {
    const section = sections[0],
      s = section[0];
    const exactly = (p: RegExp) => {
      const all = [...s.matchAll(p)];
      return all.length === 1 ? all[0] : null;
    };
    const currency = exactly(
      /Consideration:\s*(USD|EUR|GBP|CHF|CAD|AUD|JPY)\.\s*Basis:\s*(Annual)\./g,
    );
    const minimum = exactly(/^\s*Minimum charge\s+(\d+(?:\.\d{1,2})?)\s*$/gm);
    const rate = exactly(/^\s*Contractual unit rate or share\s+(0\.\d+|1(?:\.0+)?)\s*$/gm);
    const revenue = exactly(/^\s*Eligible revenue input\s+(\d+(?:\.\d{1,2})?)\s*$/gm);
    const credit =
      /annual minimum is credited against the stated royalty, not added a second time/i.test(
        normalizePassage(s),
      );
    const formula = /max\(minimum,\s*rate\s*\*\s*eligible annual net revenue\)/i.test(
      normalizePassage(s),
    );
    const conflict =
      /\b(?:in addition to|added to the royalty|minimum plus|supersed\w*|amend\w*|proposed|draft)\b/i.test(
        s,
      );
    if (currency && minimum && rate && revenue && credit && formula && !conflict) {
      // Decimal-string inputs preserved; calculation uses integers, never floats.
      const cents = (v: string) => {
        const [whole, fraction = ""] = v.split(".");
        return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
      };
      const digits = rate[1].split(".")[1] ?? "";
      const numerator = BigInt(rate[1].replace(".", "")),
        denominator = 10n ** BigInt(digits.length);
      const royaltyNumerator = cents(revenue[1]) * numerator;
      if (royaltyNumerator % denominator !== 0n)
        unresolved("commercial_terms", "rounding-convention-required");
      else {
        const royalty = royaltyNumerator / denominator,
          min = cents(minimum[1]),
          total = royalty > min ? royalty : min;
        const decimal = (n: bigint) => `${n / 100n}.${String(n % 100n).padStart(2, "0")}`;
        accepted(
          "commercial_terms",
          {
            kind: "royalty-with-credited-annual-minimum",
            currency: currency[1],
            period: "year",
            minimum: minimum[1],
            royaltyRate: rate[1],
            revenueBasis: "eligible-annual-net-revenue",
            minimumTreatment: "credited-not-additive",
            illustration: {
              eligibleRevenue: revenue[1],
              royalty: decimal(royalty),
              applicableFloor: decimal(total),
              formula: "max(minimum, rate * eligible annual net revenue)",
              notReceipts: true,
            },
          },
          [section],
        );
      }
    } else unresolved("commercial_terms", "royalty-structure-missing-or-conflicting");
  } else unresolved("commercial_terms", "commercial-section-ambiguous");
  const billing = modelChecks.find((c) => c.field === "billing_terms");
  if (
    billing?.evidence.some((e) =>
      /monthly aggregate service statement|service reporting/i.test(normalizePassage(e.text)),
    )
  )
    decisions.push({
      field: "billing_terms",
      status: "rejected",
      code: "service-reporting-is-not-payment-terms",
    });
  else unresolved("billing_terms", "explicit-payment-cadence-unavailable");

  const included = unique(
    /(?:^|\n)([^\n.]+? is an included fictional service enhancement from (\d{4}-\d{2}-\d{2}))\./g,
  );
  const roadmap = unique(
    /(?:^|\n|\.\s+)([^.\n]+?(?:\n[^.\n]+?)? is not purchased or committed; it remains a nonbinding roadmap item)\./g,
  );
  if (included.length === 1 && validDate(included[0][2]))
    accepted(
      "included_entitlements",
      {
        statement: normalizePassage(included[0][1]),
        effectiveDate: included[0][2],
        classification: "included-scenario-enhancement",
      },
      included,
    );
  else unresolved("included_entitlements", "included-status-missing-or-conflicting");
  if (roadmap.length === 1)
    accepted(
      "roadmap_exclusions",
      { statement: normalizePassage(roadmap[0][1]), purchased: false, committed: false },
      roadmap,
    );
  else unresolved("roadmap_exclusions", "roadmap-status-unresolved");
  const execution = unique(
    /Status: effective within the fictional scenario only; this document is not actually\s+signed and has no legal effect\./g,
  );
  if (execution.length === 1)
    accepted(
      "execution_status",
      { effectiveOnlyWithinScenario: true, actuallySigned: false, legalEffect: false },
      execution,
    );
  else unresolved("execution_status", "execution-status-not-established");
  // Unknown amendments cannot be resolved by selecting an earlier convenient row.
  // Historical-reference material is excluded above, but operative changes block
  // automatic recovery until a dedicated precedence parser can reconcile them.
  if (/\b(?:amendment|amended|supersedes|superseding|revised terms)\b/i.test(body)) {
    for (const d of decisions) {
      if (d.status === "accepted" && d.field !== "agreement_identity") {
        d.status = "unresolved";
        d.code = "operative-amendment-requires-reconciliation";
        delete d.fact;
      }
    }
  }
  return {
    modelChecks,
    decisions,
    acceptedFacts: decisions.flatMap((d) => (d.fact ? [d.fact] : [])),
  };
}

/** Offline reasoning input: unresolved/rejected values never enter the fact list. */
export function reasoningPacket(result: ReturnType<typeof reconcileSourceFacts>) {
  return {
    facts: result.acceptedFacts,
    unknowns: result.decisions
      .filter((d) => d.status !== "accepted")
      .map((d) => ({ field: d.field, status: d.status, code: d.code })),
    limitations: [
      "Document statements, not independent proof of performance or payment.",
      "Synthetic scenario provenance must be retained.",
    ],
  };
}
