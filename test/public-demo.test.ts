import { test, expect } from "vite-plus/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { demoHttp } from "../src/renewal/demo-http.ts";

test("anonymous previews are scoped; forged send and private routes fail closed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "public-demo-test-"));
  try {
    const ids = ["REN-C0211", "REN-C0083", "other1", "other2", "other3"];
    const accounts = ids.map((id, i) => ({
      id,
      name: id,
      contact: "Fictional Contact",
      owner: "Fictional Owner",
      score: 100 - i,
      sources: Array.from({ length: 8 }, (_, j) => ({
        id: `${i + 1}${j}`,
        version: "1",
        name: "Fixture",
        url: `https://app.box.com/file/${i + 1}${j}`,
      })),
      blocks: [
        { id: "term", kind: "risk", text: "Test-only verified block", sourceIds: [`${i + 1}0`] },
      ],
      selection: { email: ["term"] },
      reason: "Test fixture",
      facts: [],
      snapshotHash: "private-marker",
    }));
    await writeFile(
      join(dir, "cache.json"),
      JSON.stringify({
        schema: "renewer-demo-v1",
        id: "test",
        accounts,
        outcomes: Array.from({ length: 24 }, (_, i) => ({
          customerId: ids[i] ?? `other${i}`,
          status: "verified",
        })),
        usage: { private: "private-marker" },
      }),
    );
    const options = {
      cachePath: join(dir, "cache.json"),
      assetRoot: new URL("../src/renewal/demo-web", import.meta.url).pathname,
    };
    const req = (path: string, body?: unknown) =>
      new Request(`https://demo.example${path}`, {
        method: body ? "POST" : "GET",
        headers: { origin: "https://demo.example", "content-type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const home = await demoHttp(req("/"), options);
    expect(home.status).toBe(200);
    expect(home.headers.has("www-authenticate")).toBe(false);
    const state = await (await demoHttp(req("/api/state"), options)).json();
    expect(state.portfolio.accounts.map((a: { id: string }) => a.id)).toEqual(ids.slice(0, 2));
    expect(state.sendEnabled).toBe(false);
    expect(JSON.stringify(state)).not.toContain("private-marker");
    expect(state.outcomes).toBeUndefined();
    for (const customerId of ids.slice(0, 2))
      expect(
        (await demoHttp(req("/api/draft", { customerId, portfolioId: "test" }), options)).status,
      ).toBe(200);
    expect(
      (await demoHttp(req("/api/draft", { customerId: "other1", portfolioId: "test" }), options))
        .status,
    ).toBe(403);
    expect(
      (
        await demoHttp(
          req("/api/send", { operation: "SEND_ONE_VERIFIED_NORTHGATE_TEST", customerId: ids[0] }),
          options,
        )
      ).status,
    ).toBe(403);
    for (const path of ["/demo-data/verified-demo.json", "/.env", "/api/fixture", "/api/analyze"])
      expect((await demoHttp(req(path), options)).status).toBe(404);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
