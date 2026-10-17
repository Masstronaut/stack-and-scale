import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import type { AddressInfo } from "node:net";
import { createHealthServer } from "../src/server.ts";

let server: ReturnType<typeof createHealthServer>;
let baseUrl: string;

beforeAll(async () => {
  server = createHealthServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

describe("GET /health", () => {
  it("answers 200 with a healthy JSON payload", async () => {
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const body = (await response.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.service).toBe("stack-and-scale");
    expect(typeof body.stage).toBe("string");
    expect(typeof body.timestamp).toBe("string");
    expect(Number.isNaN(Date.parse(body.timestamp as string))).toBe(false);
  });

  it("answers 404 for unknown routes", async () => {
    const response = await fetch(`${baseUrl}/nope`);

    expect(response.status).toBe(404);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.error).toBe("not found");
  });

  it("rejects non-GET methods on /health", async () => {
    const response = await fetch(`${baseUrl}/health`, { method: "POST" });

    expect(response.status).toBe(404);
  });
});
