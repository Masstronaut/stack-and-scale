import type { Source, Analysis, Claim } from "./model.ts";

/** RFC-style quoted CSV cells; no evaluation, coercion of formulas, or instructions. */
export function parseUsageCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((v) => v.length)) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("Malformed usage CSV");
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const header = rows.shift();
  if (!header || new Set(header).size !== header.length) throw new Error("Invalid usage columns");
  return rows.map((values) => {
    if (values.length !== header.length) throw new Error("Malformed usage row");
    return Object.fromEntries(header.map((key, i) => [key, values[i]]));
  });
}

export function validateUsageSources(customerId: string, sources: Source[]) {
  const csv = sources.find((s) => s.type === "USAGECSV");
  if (!csv) return [];
  const rows = parseUsageCsv(csv.text);
  if (!rows.length) throw new Error("Empty usage ledger");
  for (const r of rows) {
    if (
      r.customer_id !== customerId ||
      r.designation !== "SYNTHETIC DEMO DATA" ||
      !r.row_id ||
      !r.unit ||
      !r.value ||
      !Number.isFinite(Number(r.value))
    )
      throw new Error("Usage ledger identity or numeric validation failed");
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(r.period_start) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(r.period_end) ||
      r.period_start > r.period_end
    )
      throw new Error("Usage ledger period validation failed");
    if (r.allowance !== "" && (!Number.isFinite(Number(r.allowance)) || Number(r.allowance) < 0))
      throw new Error("Invalid usage entitlement");
  }
  return rows;
}

/** Numeric utilization is generated from the ledger, never model arithmetic. */
export function deriveUsageEvidence(customerId: string, sources: Source[]) {
  const rows = validateUsageSources(customerId, sources);
  const source = sources.find((s) => s.type === "USAGECSV");
  const metrics: Analysis["metrics"] = [],
    claims: Claim[] = [];
  if (!source) return { metrics, claims };
  const latest = new Map<string, Record<string, string>>();
  for (const row of rows) {
    const key = row.metric_id ?? row.name;
    if (!latest.has(key) || latest.get(key)!.period_end < row.period_end) latest.set(key, row);
  }
  for (const row of latest.values()) {
    let capacity = row.allowance !== "" ? Number(row.allowance) : NaN;
    let companion: Record<string, string> | undefined;
    if (row.feature_id) {
      if (!/\| used$/i.test(row.name)) continue;
      companion = rows.find(
        (r) =>
          r.feature_id === row.feature_id &&
          /\| eligible$/i.test(r.name) &&
          r.period_start === row.period_start &&
          r.period_end === row.period_end &&
          r.unit === row.unit,
      );
      capacity = companion ? Number(companion.value) : NaN;
    }
    if (!Number.isFinite(capacity) || capacity <= 0 || Number(row.value) < 0) continue;
    const references = [row, ...(companion ? [companion] : [])].map((r) =>
      source.text.split(/\r?\n/).find((line) => line.includes(r.row_id)),
    );
    if (references.some((q) => !q)) throw new Error("Usage row cannot be cited");
    const id = `computed-ledger-${source.id}-${row.row_id}`;
    claims.push({
      id,
      text: `${row.name}: ${row.value} ${row.unit} observed; denominator ${capacity}; ${row.period_start} through ${row.period_end}.`,
      citations: references.map((quote) => ({
        sourceId: source.id,
        version: source.version,
        quote: quote!,
      })),
    });
    metrics.push({
      name: row.name.replace(/\s*\| used$/i, ""),
      used: Number(row.value),
      capacity,
      unit: row.unit,
      period: `${row.period_start}–${row.period_end} (${row.allowance_scope})`,
      partial: row.partial_period.toLowerCase() === "true",
      claimIds: [id],
    });
  }
  return { metrics, claims };
}
