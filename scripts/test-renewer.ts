import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { request } from "node:http";
import {
  analyzePortfolio,
  daysUntil,
  parseAnalysis,
  rankAccounts,
  selectDocuments,
  validateManifest,
  verifyAnalysis,
} from "../src/renewal/core.ts";
import { createFixturePortfolio } from "../src/renewal/fixture.ts";
import { createRenewerServer } from "../src/renewal/server.ts";
import type { Analysis, Manifest, Source } from "../src/renewal/model.ts";

const manifest: Manifest = JSON.parse(
  await readFile(new URL("../docs/dataset/box-manifest.json", import.meta.url), "utf8"),
);
const fixture = () => createFixturePortfolio();
test("white workspace palette has larger text and no gradients or legacy green accents", async () => {
  const css = await readFile(new URL("../src/renewal/web/style.css", import.meta.url), "utf8");
  for (const color of ["#FFFFFF", "#FAFAFA", "#E4E4E7", "#18181B", "#F97316"])
    assert.ok(css.toLowerCase().includes(color.toLowerCase()));
  assert.ok(css.includes("font-size: 16px"));
  assert.ok(!/gradient|#c2efd5|#101514|#95a39c/i.test(css));
  const html = await readFile(new URL("../src/renewal/web/index.html", import.meta.url), "utf8");
  assert.equal((html.match(/id="analyze"/g) ?? []).length, 1);
  assert.ok(html.indexOf('id="analyze"') < html.indexOf('id="opportunities"'));
});
function evidence() {
  const account = fixture().accounts[0];
  const a = structuredClone(account.analysis);
  const sources: Source[] = a.claims.map((c, i) => ({
    id: c.citations[0].sourceId,
    version: c.citations[0].version,
    customerId: a.customerId,
    name: `Source ${i}`,
    type: "FIXTURE",
    text: c.citations[0].quote,
  }));
  const customer = {
    customer_id: a.customerId,
    customer_name: account.name,
    box_folder_id: "fixture",
  };
  return { a, sources, customer };
}

test("approved manifest contains all 24 accounts without a featured customer", () => {
  validateManifest(manifest);
  for (const customer of manifest.customers) {
    const docs = selectDocuments(manifest, customer.customer_id);
    assert.equal(docs.length, 12);
    assert.ok(
      docs.every(
        (d) => d.customer_id === customer.customer_id || d.document_type === "PRODUCT_KNOWLEDGE",
      ),
    );
  }
  assert.throws(() => selectDocuments(manifest, "unapproved"));
});

test("date arithmetic is UTC-safe and invalid dates are rejected", () => {
  assert.equal(daysUntil("2026-10-17", "2026-12-31"), 75);
  assert.equal(daysUntil("2026-10-17", "2026-11-19"), 33);
  assert.equal(daysUntil("2026-10-17", null), null);
  assert.equal(daysUntil("2026-10-17", "2026-10-16"), -1);
  assert.throws(() => daysUntil("2026-10-17", "2026-02-30"));
});

test("rankings are computed for all accounts and change when evidence scores change", () => {
  const p = fixture();
  assert.equal(p.accounts.length, 24);
  assert.equal(p.topFive.length, 5);
  assert.ok(p.topFive.every((a) => a.verification === "fixture"));
  const accounts = structuredClone(p.accounts);
  const last = accounts.at(-1)!;
  last.daysToNotice = 1;
  last.evidenceQuality = 1;
  last.analysis.opportunities[0].impact = 4;
  last.analysis.opportunities[0].actionability = 4;
  assert.equal(rankAccounts(accounts)[0].customerId, last.customerId);
  assert.deepEqual(
    rankAccounts(accounts).map((a) => a.customerId),
    rankAccounts([...accounts].reverse()).map((a) => a.customerId),
  );
});

test("currency and consideration are preserved without nominal currency-based ranking", () => {
  const a = fixture().accounts;
  assert.ok(a.some((x) => x.email.body.includes("CHF")));
  assert.ok(a.some((x) => x.email.body.includes("EUR")));
  assert.ok(a.some((x) => x.email.body.includes("Noncash consideration")));
  assert.ok(a.some((x) => x.email.body.includes("variable")));
  const first = structuredClone(a[0]);
  const old = rankAccounts([first])[0].score;
  first.analysis.value.amount = 99999999999;
  first.analysis.value.currency = "CNY";
  assert.equal(rankAccounts([first])[0].score, old);
});

test("reject unsupported source passages, cross-customer sources, and version drift", () => {
  const { a, sources, customer } = evidence();
  assert.doesNotThrow(() => verifyAnalysis(a, customer, sources, "2026-10-17"));
  a.claims[0].citations[0].quote = "This claim is fabricated and absent from the source.";
  assert.throws(() => verifyAnalysis(a, customer, sources, "2026-10-17"), /Unsupported/);
  const b = evidence();
  b.sources[0].customerId = "different-customer";
  assert.throws(() => verifyAnalysis(b.a, b.customer, b.sources, "2026-10-17"), /scope/);
  const c = evidence();
  c.sources[0].version = "new-version";
  assert.throws(() => verifyAnalysis(c.a, c.customer, c.sources, "2026-10-17"), /version/);
});

test("reject invented monetary values, date claims, and metric inputs", () => {
  const a = evidence();
  a.a.value.amount = 99999999;
  assert.throws(() => verifyAnalysis(a.a, a.customer, a.sources, "2026-10-17"), /Money/);
  const b = evidence();
  b.a.notice = "2026-10-18";
  assert.throws(() => verifyAnalysis(b.a, b.customer, b.sources, "2026-10-17"), /Notice/);
  const c = evidence();
  c.a.metrics[0].used = 99999;
  assert.throws(() => verifyAnalysis(c.a, c.customer, c.sources, "2026-10-17"), /Metric/);
});

test("noncash, malformed scores, dangling evidence and duplicate claims fail closed", () => {
  const a = evidence().a;
  a.value.kind = "noncash";
  assert.throws(() => parseAnalysis(a), /Noncash/);
  const b = evidence().a;
  b.opportunities[0].impact = 100;
  assert.throws(() => parseAnalysis(b), /opportunity/);
  const c = evidence().a;
  c.opportunities[0].claimIds = ["unknown"];
  assert.throws(() => parseAnalysis(c));
  const d = evidence().a;
  d.claims.push(d.claims[0]);
  assert.throws(() => parseAnalysis(d), /Duplicate/);
});

test("utilization uses validated inputs and preserves partial-period context", () => {
  const { a, customer, sources } = evidence();
  const result = verifyAnalysis(a, customer, sources, "2026-10-17");
  assert.equal(result.metrics[0].percent, (a.metrics[0].used / a.metrics[0].capacity) * 100);
  assert.equal(result.metrics[0].partial, true);
});

test("local HTTP flow, source mode, CSRF, and approval bypass protection", async () => {
  const server = await createRenewerServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const html = await fetch(origin).then((r) => r.text());
    assert.ok(html.includes("Renewal priorities, ready for review."));
    assert.ok(!html.includes("Customers scanned"));
    const s = (await fetch(`${origin}/api/state`).then((r) => r.json())) as {
      token: string;
      liveEnabled: boolean;
      sendEnabled: boolean;
      portfolio: unknown;
    };
    assert.equal(s.liveEnabled, false);
    assert.equal(s.sendEnabled, false);
    assert.equal(s.portfolio, null);
    const post = (path: string, input: unknown, csrf = s.token) =>
      fetch(`${origin}/api/${path}`, {
        method: "POST",
        headers: { origin, "content-type": "application/json", "x-renewer-token": csrf },
        body: JSON.stringify(input),
      });
    assert.equal((await post("fixture", {}, "wrong")).status, 403);
    assert.equal((await post("analyze", {})).status, 403);
    const f = (await post("fixture", {}).then((r) => r.json())) as {
      portfolio: { id: string; mode: string; accounts: { id: string }[] };
    };
    assert.equal(f.portfolio.mode, "fixture");
    assert.equal(f.portfolio.accounts.length, 5);
    assert.equal(
      (
        await post("draft", {
          portfolioId: f.portfolio.id,
          mode: "fixture",
          customerId: "injected-account",
        })
      ).status,
      403,
    );
    const draftResponse = await post("draft", {
      portfolioId: f.portfolio.id,
      mode: "fixture",
      customerId: f.portfolio.accounts[0].id,
    });
    assert.equal(draftResponse.status, 200);
    const d = (await draftResponse.json()) as { draft: { email: { body: string }; mode: string } };
    assert.equal(d.draft.mode, "fixture");
    assert.ok(d.draft.email.body.includes("FIXTURE PREVIEW"));
    assert.equal(
      (await post("send", { approved: true, recipient: "synthetic@example.com" })).status,
      403,
    );
    assert.equal((await fetch(`${origin}/.env`)).status, 404);
    const badHostStatus = await new Promise((resolve) => {
      const r = request(
        `${origin}/api/state`,
        { headers: { Host: "evil.example" } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      r.end();
    });
    assert.equal(badHostStatus, 403);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("portfolio pipeline evaluates every customer, reuses shared reads, and publishes only complete runs", async () => {
  const template = evidence().a;
  const reads: string[] = [];
  const analyzed: string[] = [];
  const commonText = template.claims.map((c) => c.citations[0].quote).join("\n");
  const progress: string[] = [];
  const provider = {
    read: async (d: Manifest["documents"][number]): Promise<Source> => {
      reads.push(d.box_file_id);
      return {
        id: d.box_file_id,
        version: d.verified_box_version_id,
        customerId: d.customer_id,
        name: d.filename,
        type: d.document_type,
        text: commonText,
      };
    },
    analyze: async (c: Manifest["customers"][number], sources: Source[]): Promise<Analysis> => {
      analyzed.push(c.customer_id);
      const a = structuredClone(template);
      a.customerId = c.customer_id;
      a.claims.forEach((claim, i) => {
        claim.citations[0].sourceId = sources[i].id;
        claim.citations[0].version = sources[i].version;
      });
      return a;
    },
  };
  const p = await analyzePortfolio(
    manifest,
    provider,
    (event) => {
      progress.push(event.stage);
    },
    "2026-10-17",
  );
  assert.equal(p.customersEvaluated, 24);
  assert.equal(p.retrievedDocuments, 196);
  assert.equal(new Set(reads).size, 196);
  assert.equal(reads.length, 196);
  assert.equal(new Set(analyzed).size, 24);
  assert.equal(p.topFive.length, 5);
  assert.ok(progress.includes("complete"));
  const incomplete: string[] = [];
  await assert.rejects(
    analyzePortfolio(
      manifest,
      {
        ...provider,
        analyze: async () => {
          throw new Error("model unavailable");
        },
      },
      (event) => {
        incomplete.push(event.stage);
      },
      "2026-10-17",
    ),
  );
  assert.ok(!incomplete.includes("complete"));
});
