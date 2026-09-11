import type { CvItem } from "../decoders/types";

export function parseCvListFilter(raw: string): { kind: "empty" } | { kind: "number"; n: number } | { kind: "text"; q: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { kind: "empty" };
  if (/^-?\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isInteger(n)) return { kind: "number", n };
  }
  return { kind: "text", q: trimmed.toLowerCase() };
}

export function cvMatchesFilter(
  item: CvItem,
  raw: string,
  value: number | undefined,
  description: string | undefined,
): boolean {
  const filter = parseCvListFilter(raw);
  if (filter.kind === "empty") return true;
  if (filter.kind === "number") {
    return item.cv === filter.n || value === filter.n;
  }
  return (description ?? "").toLowerCase().includes(filter.q);
}
