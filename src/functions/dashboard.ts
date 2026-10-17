import type { APIGatewayProxyHandlerV2 } from "aws-lambda";

// Minimal self-contained dashboard for pipeline run tracking: polls GET
// /runs every 5s and links artifacts through GET /artifacts (presigned).
// No frameworks, no build step - one HTML document, inline CSS/JS.

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Renewal runs</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; background: #0f1115; color: #e6e8ee; margin: 2rem; }
  h1 { font-size: 1.15rem; font-weight: 600; margin: 0 0 1rem; }
  .stamp { color: #8b90a0; font-size: .75rem; font-weight: 400; margin-left: .6rem; }
  table { border-collapse: collapse; width: 100%; font-size: .84rem; }
  th, td { text-align: left; padding: .45rem .6rem; border-bottom: 1px solid #23262e; vertical-align: top; }
  th { color: #8b90a0; font-weight: 500; font-size: .74rem; text-transform: uppercase; letter-spacing: .04em; }
  tr:hover td { background: #151820; }
  .chip { display: inline-block; padding: .08rem .5rem; border-radius: 999px; font-size: .72rem; margin: .1rem .15rem .1rem 0; border: 1px solid; }
  .ok { color: #4ade80; border-color: #14532d; background: #052e16; }
  .failed { color: #f87171; border-color: #7f1d1d; background: #450a0a; }
  .running { color: #fbbf24; border-color: #78350f; background: #451a03; animation: pulse 1.2s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: .45; } }
  .muted { color: #8b90a0; }
  .error { color: #f87171; font-size: .74rem; margin-top: .25rem; white-space: pre-wrap; word-break: break-word; }
  a { color: #7dd3fc; text-decoration: none; margin-right: .6rem; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
<h1>Renewal runs<span class="stamp" id="updated"></span></h1>
<table>
  <thead><tr><th>Run</th><th>Started</th><th>Duration</th><th>Stages</th><th>Contract</th><th>Artifacts</th></tr></thead>
  <tbody id="rows"><tr><td colspan="6" class="muted">loading&hellip;</td></tr></tbody>
</table>
<script>
const esc = (value) => String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ARTIFACT_LINKS = [
  ["sales-notes.md", "Notes"],
  ["sales-deck.html", "Deck"],
  ["scan-summary.json", "Summary"],
];
const duration = (run) => {
  const start = Date.parse(run.startedAt);
  if (Number.isNaN(start)) return "&mdash;";
  const end = run.finishedAt ? Date.parse(run.finishedAt) : Date.now();
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  const minutes = Math.floor(seconds / 60);
  const label = minutes > 0 ? minutes + "m " + (seconds % 60) + "s" : seconds + "s";
  return run.finishedAt ? label : label + "&hellip;";
};
const chips = (run) => run.stages.map((s) =>
  '<span class="chip ' + esc(s.status) + '" title="' + esc(s.error ?? s.stage) + '">' + esc(s.stage) + "</span>"
).join("") + run.stages.filter((s) => s.status === "failed").map((s) =>
  '<div class="error">' + esc(s.error ?? "failed") + "</div>"
).join("");
const contract = (run) => {
  const withContract = run.stages.find((s) => s.input && s.input.contractFileId);
  return esc(withContract?.input?.contractFileId) || "&mdash;";
};
const artifacts = (run) => {
  const keys = [...new Set(run.stages.flatMap((s) => s.artifactKeys ?? []))];
  return keys.map((key) => {
    const link = ARTIFACT_LINKS.find(([suffix]) => key.endsWith(suffix));
    return link
      ? '<a href="/artifacts?key=' + encodeURIComponent(key) + '" target="_blank" rel="noopener">' + link[1] + "</a>"
      : "";
  }).join("") || "&mdash;";
};
const row = (run) =>
  "<tr><td>" + esc(String(run.runId).slice(0, 8)) + "</td>" +
  "<td>" + esc(new Date(run.startedAt).toLocaleString()) + "</td>" +
  "<td>" + duration(run) + "</td>" +
  "<td>" + chips(run) + "</td>" +
  "<td>" + contract(run) + "</td>" +
  "<td>" + artifacts(run) + "</td></tr>";
async function refresh() {
  try {
    const runs = await fetch("/runs").then((r) => r.json());
    document.getElementById("rows").innerHTML = runs.length
      ? runs.map(row).join("")
      : '<tr><td colspan="6" class="muted">no runs yet</td></tr>';
    document.getElementById("updated").textContent = "updated " + new Date().toLocaleTimeString();
  } catch (error) {
    document.getElementById("updated").textContent = "refresh failed: " + error;
  }
}
refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>
`;

export const handler: APIGatewayProxyHandlerV2 = async () => ({
  statusCode: 200,
  headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  body: page,
});
