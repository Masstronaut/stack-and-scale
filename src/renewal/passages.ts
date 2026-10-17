/** Presentation-only normalization. Never remove decimal/grouping punctuation,
 * signs, digits, negation, or substitute OCR lookalikes (O/0, l/1). */
export function normalizePassage(text: string) {
  return (
    text
      .normalize("NFKC")
      .replace(/\u00ad/g, "")
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[‐‑–—−]/g, "-")
      .replace(/([A-Za-z])-\r?\n(?=[a-z])/g, "$1")
      // Spaces before commas/semicolons in PDF references; never touch decimal
      // or grouping separators between digits.
      .replace(/(?<=[A-Za-z])\s+([,;:])/g, "$1")
      .replace(/\s+/g, " ")
      .trim()
  );
}

export interface Passage {
  text: string;
  start: number;
  end: number;
}

/** Bound context to a sentence, labeled row or wrapped label/value. Never use
 * arbitrary +/- character windows: those can borrow another clause's role. */
export function sourcePassages(text: string): Passage[] {
  const result: Passage[] = [];
  const pattern = /[^\n\f]+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const line = match[0];
    const previous = result.at(-1);
    const gap = previous ? text.slice(previous.end, match.index) : "";
    const continuation =
      previous &&
      !/[\f]|\n\s*\n/.test(gap) &&
      !/[.;]$/.test(previous.text.trim()) &&
      !line.includes("|") &&
      (!/^[^:]{1,80}:/.test(line) || /[A-Za-z]-$/.test(previous.text)) &&
      !previous.text.includes("|");
    if (continuation && previous.text.length + line.length < 1800) {
      previous.end = match.index + line.length;
      previous.text = text.slice(previous.start, previous.end);
    } else result.push({ text: line, start: match.index, end: match.index + line.length });
  }
  return result.flatMap((p) => {
    // Sentence/semicolon boundaries protect separate dates; decimal dots remain.
    const parts = [...p.text.matchAll(/[^;]+?(?:[.;](?=\s|$)|$)/g)].filter((m) => m[0].trim());
    return parts.map((m) => ({
      text: m[0],
      start: p.start + m.index!,
      end: p.start + m.index! + m[0].length,
    }));
  });
}

export function anchorReference(text: string, quote: string) {
  const normalized = normalizePassage(text),
    needle = normalizePassage(quote);
  if (!needle || !normalized.includes(needle))
    return { code: "normalized-text-mismatch", passages: [] as Passage[] };
  const passages = sourcePassages(text);
  const direct = passages.filter((p) => normalizePassage(p.text).includes(needle));
  if (direct.length > 1) return { code: "ambiguous-reference", passages: [] as Passage[] };
  if (direct.length === 1) return { code: "anchored", passages: direct };
  // A broad quote can span multiple clauses. Retain only whole, quoted clauses;
  // callers must establish role and value within one clause, never their union.
  const contained = passages.filter((p) => needle.includes(normalizePassage(p.text)));
  return {
    code: contained.length ? "anchored" : "context-boundary-ambiguous",
    passages: contained,
  };
}
