import { randomUUID } from "node:crypto";
import { rankAccounts, verifyAnalysis } from "./core.ts";
import type { Analysis, Portfolio, Source } from "./model.ts";

/** Anonymous UI fixtures only. Never represented as Box data or Nova execution. */
export function createFixturePortfolio(): Portfolio {
  const asOf = "2026-10-17";
  const accounts = Array.from({ length: 24 }, (_, i) => {
    const customerId = `example-${String(i + 1).padStart(2, "0")}`;
    const name = `Example account ${String(i + 1).padStart(2, "0")}`;
    const date = new Date(`${asOf}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 7 + ((i * 13) % 100));
    const notice = date.toISOString().slice(0, 10);
    date.setUTCDate(date.getUTCDate() + 42);
    const expiration = date.toISOString().slice(0, 10);
    const currency = ["USD", "EUR", "GBP", "CHF"][i % 4];
    const amount = 42000 + i * 7300;
    const used = 60 + i;
    const kind = (["service", "adoption", "capacity", "deadline", "preparation"] as const)[i % 5];
    const words = {
      service: [
        "Resolve an outstanding service commitment",
        "A recorded service milestone needs confirmation before renewal.",
        "Arrange a service recovery review and confirm the milestone owner.",
      ],
      adoption: [
        "Activate value already delivered",
        "A released, included capability has limited adoption.",
        "Offer an operator enablement session before discussing new spend.",
      ],
      capacity: [
        "Validate capacity before proposing expansion",
        "Observed usage approaches the included allowance; future needs need confirmation.",
        "Validate the forecast and ask which available capacity option fits.",
      ],
      deadline: [
        "Prepare before the notice window closes",
        "The notice deadline is approaching and a renewal review is actionable.",
        "Schedule the renewal review and confirm the formal notice requirements.",
      ],
      preparation: [
        "Clarify the customer's next-term needs",
        "The account has an unresolved planning question for the next term.",
        "Confirm priorities and distinguish roadmap targets from commitments.",
      ],
    }[kind];
    const descriptions = [
      i === 22
        ? "Noncash consideration only; no cash valuation is available."
        : i === 21
          ? `Illustrative variable consideration ${currency} ${amount} per year; not recurring ARR.`
          : `Annual recurring fee ${currency} ${amount}.`,
      `Term ends ${expiration}; written notice deadline ${notice}.`,
      `Observed usage ${used} of 100 units in October 1–16; partial period.`,
      `Customer record: ${words[1]}`,
      `Product/service record: ${words[0]}.`,
    ];
    const sources: Source[] = descriptions.map((text, j) => ({
      id: `${customerId}-source-${j}`,
      customerId,
      version: "fixture-v1",
      name: [
        "Example agreement",
        "Example notice clause",
        "Example usage ledger",
        "Example customer request",
        "Example service/release record",
      ][j],
      type: "FIXTURE",
      text,
    }));
    const claims = sources.map((s, j) => ({
      id: `claim-${j}`,
      text: s.text,
      citations: [{ sourceId: s.id, version: s.version, quote: s.text }],
    }));
    const a: Analysis = {
      customerId,
      offering: "Illustrative offering",
      value: {
        amount: i === 22 ? null : amount,
        currency: i === 22 ? null : currency,
        period: "year",
        kind: i === 22 ? "noncash" : i === 21 ? "variable" : "recurring",
        claimId: "claim-0",
      },
      expiration,
      expirationClaimId: "claim-1",
      notice,
      noticeClaimId: "claim-1",
      noticeConvention: "Fixture convention: confirm against the actual agreement.",
      claims,
      opportunities: [
        {
          kind,
          title: words[0],
          reason: words[1],
          action: words[2],
          claimIds: ["claim-3", "claim-4"],
          impact: 1 + ((i * 3) % 4),
          actionability: 1 + ((i * 7) % 4),
        },
      ],
      metrics: [
        {
          name: "Included capacity",
          used,
          capacity: 100,
          unit: "units",
          period: "2026-10-01–2026-10-16",
          partial: true,
          claimIds: ["claim-2"],
        },
      ],
      unknowns: [
        "Illustrative findings only. A real run must retrieve and analyze every customer from Box.",
      ],
    };
    return verifyAnalysis(
      a,
      { customer_id: customerId, customer_name: name, box_folder_id: "fixture" },
      sources,
      asOf,
      true,
    );
  });
  const ranked = rankAccounts(accounts);
  return {
    id: randomUUID(),
    mode: "fixture",
    asOf,
    generatedAt: new Date().toISOString(),
    sourceFingerprint: "anonymous-fixture-v1",
    customersEvaluated: 24,
    sourceDocuments: 120,
    retrievedDocuments: 0,
    model: "No model invoked — local fixture calculation",
    accounts: ranked,
    topFive: ranked.slice(0, 5),
  };
}
