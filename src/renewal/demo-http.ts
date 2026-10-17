import { readFile } from "node:fs/promises";
import { demoDraft, rankDemoAccounts, type DemoAccount } from "./demo-portfolio.ts";

export interface DemoCache {
  schema: string;
  id: string;
  generatedAt: string;
  asOf: string;
  accounts: DemoAccount[];
  outcomes: { customerId: string; status: string; code?: string }[];
  usage: unknown;
}
export function validateDemoCache(cache: DemoCache) {
  if (
    cache.schema !== "renewer-demo-v1" ||
    cache.outcomes.length !== 24 ||
    new Set(cache.outcomes.map((o) => o.customerId)).size !== 24 ||
    cache.accounts.length < 5 ||
    new Set(cache.accounts.map((a) => a.id)).size !== cache.accounts.length
  )
    throw new Error("Portfolio incomplete");
  for (const a of cache.accounts) {
    if (
      !cache.outcomes.some((o) => o.customerId === a.id && o.status === "verified") ||
      !Number.isFinite(a.score) ||
      a.sources.length !== 8
    )
      throw new Error("Unverified cache");
    demoDraft(a);
  }
  return cache;
}
export async function demoHttp(
  request: Request,
  options: { cachePath: string; assetRoot: string },
) {
  const headers: Record<string, string> = {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...headers, "content-type": "application/json" },
    });
  const url = new URL(request.url);
  // Public transport cannot reach any sender, even with forged approval/auth headers.
  if (url.pathname === "/api/send")
    return json(403, { error: "Public email sending is disabled. Preview only." });
  const assets: Record<string, [string, string]> = {
    "/": ["index.html", "text/html; charset=utf-8"],
    "/app.js": ["app.js", "text/javascript; charset=utf-8"],
    "/style.css": ["style.css", "text/css; charset=utf-8"],
  };
  if (request.method === "GET" && assets[url.pathname]) {
    const [file, type] = assets[url.pathname];
    return new Response(await readFile(options.assetRoot + "/" + file), {
      headers: { ...headers, "content-type": type },
    });
  }
  try {
    const cache = validateDemoCache(JSON.parse(await readFile(options.cachePath, "utf8")));
    // Explicit presenter selection from the already verified top five.
    const selectedIds = ["REN-C0211", "REN-C0083"];
    const ranked = rankDemoAccounts(cache.accounts);
    const top = selectedIds.map((id) => ranked.find((a) => a.id === id));
    if (top.some((a) => !a)) throw new Error("Selected verified customers unavailable");
    const accounts = top as DemoAccount[];
    if (request.method === "GET" && url.pathname === "/api/state")
      return json(200, {
        cached: true,
        demo: true,
        liveEnabled: false,
        sendEnabled: false,
        running: false,
        progress: { stage: "complete", completed: 24, total: 24 },
        portfolio: {
          id: cache.id,
          mode: "live",
          generatedAt: cache.generatedAt,
          asOf: cache.asOf,
          accounts: accounts.map((a) => ({ id: a.id, name: a.name, reason: a.reason })),
        },
        attempted: cache.outcomes.length,
        verified: cache.accounts.length,
      });
    if (request.method === "POST" && url.pathname === "/api/draft") {
      if (
        request.headers.get("origin") !== url.origin ||
        !request.headers.get("content-type")?.startsWith("application/json")
      )
        return json(403, { error: "Same-origin JSON required" });
      const text = await request.text();
      if (text.length > 4096) return json(413, { error: "Request too large" });
      const input = JSON.parse(text);
      if (input.portfolioId !== cache.id)
        return json(409, { error: "Portfolio changed; reload the page" });
      const account = accounts.find((a) => a.id === input.customerId);
      if (!account) return json(403, { error: "Select a current priority account" });
      const draft = demoDraft(account);
      return json(200, {
        draft: {
          ...draft,
          generatedAt: cache.generatedAt,
          cacheProvenance: "Reviewed Box-derived commercial email retrieved from verified cache",
        },
      });
    }
    return json(404, { error: "Not found" });
  } catch {
    return json(503, { error: "Verified portfolio unavailable. No sample data substituted." });
  }
}
