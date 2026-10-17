// Post-deploy smoke test: hits a deployed /health endpoint and verifies it is
// serving a healthy response.
//
// Usage:
//   npm run smoke -- https://<api-id>.execute-api.<region>.amazonaws.com/health
//   HEALTH_CHECK_URL=... npm run smoke

const target = process.argv[2] ?? process.env.HEALTH_CHECK_URL;

if (!target) {
  console.error("usage: node scripts/smoke.ts <health-url>  (or set HEALTH_CHECK_URL)");
  process.exit(1);
}

const url = target.replace(/\/$/, "").endsWith("/health")
  ? target
  : `${target.replace(/\/$/, "")}/health`;

const response = await fetch(url);

if (response.status !== 200) {
  console.error(`FAIL: ${url} responded ${response.status}`);
  process.exit(1);
}

const body = (await response.json()) as Record<string, unknown>;

if (body.status !== "ok") {
  console.error(`FAIL: unexpected payload: ${JSON.stringify(body)}`);
  process.exit(1);
}

console.log(`PASS: ${url} -> ${JSON.stringify(body)}`);
