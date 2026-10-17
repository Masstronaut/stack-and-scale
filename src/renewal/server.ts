import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { analyzePortfolio, rankAccounts, selectDocuments, verifyAnalysis } from "./core.ts";
import { createFixturePortfolio } from "./fixture.ts";
import type { Manifest, Portfolio, RankedAccount } from "./model.ts";

const root = new URL("../../", import.meta.url);
const staticFiles: Record<string, { file: string; type: string }> = {
  "/": { file: "src/renewal/web/index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "src/renewal/web/app.js", type: "text/javascript; charset=utf-8" },
  "/style.css": { file: "src/renewal/web/style.css", type: "text/css; charset=utf-8" },
};

export async function createRenewerServer(options: { live?: boolean } = {}) {
  const manifest: Manifest = JSON.parse(
    await readFile(new URL("docs/dataset/box-manifest.json", root), "utf8"),
  );
  const csrf = randomBytes(32).toString("hex");
  let portfolio: Portfolio | null = null;
  let fixture: Portfolio | null = null;
  let running = false;
  let progress = { stage: "idle", completed: 0, total: 24, detail: "" };
  const drafts = new Map<string, { account: RankedAccount; portfolioId: string }>();
  const drafting = new Set<string>();
  const enabled = options.live === true;
  const publicOrigin = process.env.RENEWER_PUBLIC_ORIGIN;
  if (publicOrigin && !/^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.ts\.net(?::\d+)?$/.test(publicOrigin)) {
    throw new Error("Preview origin must be an explicit Tailscale HTTPS origin");
  }
  const publicHost = publicOrigin ? new URL(publicOrigin).host : null;
  // No sender exists in this local-review server. An approval payload cannot enable it.
  const sendEnabled = false;
  const view = (p: Portfolio | null) =>
    p && {
      id: p.id,
      mode: p.mode,
      generatedAt: p.generatedAt,
      asOf: p.asOf,
      accounts: p.topFive.map((a) => ({
        id: a.customerId,
        name: a.name,
        reason: a.primary.reason,
      })),
    };

  return createServer(async (req, res) => {
    const json = (code: number, body: unknown) => {
      res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
    };
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    const host = req.headers.host ?? "";
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) && host !== publicHost)
      return json(403, { error: "Unapproved preview host" });
    const url = new URL(req.url ?? "/", `http://${host}`);
    try {
      if (req.method === "GET" && staticFiles[url.pathname]) {
        const asset = staticFiles[url.pathname];
        res.writeHead(200, { "content-type": asset.type, "cache-control": "no-store" });
        res.end(await readFile(new URL(asset.file, root)));
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/state")
        return json(200, {
          token: csrf,
          liveEnabled: enabled,
          sendEnabled,
          progress,
          running,
          portfolio: view(portfolio),
          fixture: view(fixture),
          cached: portfolio !== null && !running,
          blocker: enabled
            ? null
            : "Live analysis is not enabled. AWS access and the Box application identity still require verification.",
        });
      if (req.method !== "POST" || !url.pathname.startsWith("/api/"))
        return json(404, { error: "Not found" });
      const approvedOrigin =
        req.headers.origin === `http://${host}` ||
        (publicOrigin !== undefined && req.headers.origin === publicOrigin);
      if (!approvedOrigin || req.headers["x-renewer-token"] !== csrf)
        return json(403, { error: "Request authorization failed" });
      if (!String(req.headers["content-type"]).startsWith("application/json"))
        return json(415, { error: "JSON required" });
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 8192) return json(413, { error: "Request too large" });
      }
      const input = JSON.parse(body || "{}") as Record<string, unknown>;
      if (url.pathname === "/api/fixture") {
        fixture = createFixturePortfolio();
        return json(200, { portfolio: view(fixture) });
      }
      if (url.pathname === "/api/analyze") {
        if (!enabled)
          return json(403, {
            error:
              "Live Box/Bedrock execution requires separate operator approval and configuration. No analysis was run.",
          });
        if (running) return json(409, { error: "Portfolio analysis already running" });
        running = true;
        progress = {
          stage: "connecting",
          completed: 0,
          total: 24,
          detail: "Verifying provider access",
        };
        void (async () => {
          try {
            const { createLocalLiveProvider } = await import("./live.ts");
            const provider = await createLocalLiveProvider();
            const result = await analyzePortfolio(
              manifest,
              provider,
              (event) => {
                progress = event;
              },
              manifestDate(),
            );
            portfolio = result;
            drafts.clear();
          } catch {
            progress = {
              stage: "error",
              completed: progress.completed,
              total: 24,
              detail:
                "Analysis could not be completed. No new top five published. Check provider access, source versions, and evidence validation.",
            };
          } finally {
            running = false;
          }
        })();
        return json(202, { started: true });
      }
      if (url.pathname === "/api/draft") {
        if (typeof input.customerId !== "string" || typeof input.portfolioId !== "string")
          return json(400, { error: "Select an account from the current top five" });
        const p = input.mode === "fixture" ? fixture : portfolio;
        if (!p || p.id !== input.portfolioId)
          return json(409, { error: "Portfolio changed; refresh before generating a draft" });
        let account = p.topFive.find((a) => a.customerId === input.customerId);
        if (!account) return json(403, { error: "Customer is not in this run's top five" });
        const key = `${p.id}:${account.customerId}`;
        if (drafting.has(key)) return json(409, { error: "Email generation already running" });
        drafting.add(key);
        try {
          if (p.mode === "live") {
            if (!enabled) return json(403, { error: "Live generation disabled" });
            const customer = manifest.customers.find((c) => c.customer_id === account!.customerId)!;
            const { createLocalLiveProvider } = await import("./live.ts");
            const provider = await createLocalLiveProvider();
            const sources = [];
            for (const doc of selectDocuments(manifest, customer.customer_id))
              sources.push(await provider.read(doc));
            const verified = verifyAnalysis(
              await provider.analyze(customer, sources),
              customer,
              sources,
              p.asOf,
            );
            account = rankAccounts([verified])[0];
          }
          drafts.set(key, { account, portfolioId: p.id });
          return json(200, {
            draft: {
              id: key,
              customerId: account.customerId,
              name: account.name,
              mode: p.mode,
              generatedAt: new Date().toISOString(),
              email: account.email,
              sources: account.sources,
              claims: account.analysis.claims.map((c) => ({
                text: c.text,
                sourceIds: c.citations.map((r) => r.sourceId),
              })),
              verification: account.verification,
              notice:
                "Exact supporting passages, dates, amounts, and metric inputs were matched. This is not a guarantee of semantic correctness; review before sending.",
            },
          });
        } finally {
          drafting.delete(key);
        }
      }
      if (url.pathname === "/api/send") {
        // Deliberately fail closed even if the browser submits approved:true or a recipient.
        return json(403, {
          error:
            "Email delivery is disabled for local implementation review. No email was sent. Enablement requires separate approval, a verified SES sender, server-side recipient allowlisting, and durable duplicate-send protection.",
        });
      }
      return json(404, { error: "Not found" });
    } catch {
      return json(400, {
        error:
          "Request or evidence validation failed. No email was sent and no Box file was changed.",
      });
    }
  });
}

function manifestDate() {
  // Explicit demo clock, not the host clock silently changing the demonstration.
  return process.env.RENEWER_AS_OF ?? "2026-10-17";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.RENEWER_PORT ?? 4317);
  const server = await createRenewerServer({
    live: process.argv.includes("--allow-live-analysis"),
  });
  server.listen(port, "127.0.0.1", () =>
    console.log(`The Renewer: http://127.0.0.1:${port} (email and Box writes disabled)`),
  );
}
