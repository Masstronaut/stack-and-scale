import { createServer, type Server } from "node:http";
import { pathToFileURL } from "node:url";
import { getHealth } from "./lib/health.ts";

export function createHealthServer(): Server {
  return createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(getHealth()));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const port = Number(process.env.PORT ?? 3000);
  createHealthServer().listen(port, () => {
    console.log(`health server listening on http://localhost:${port}/health`);
  });
}
