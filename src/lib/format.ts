/** Compact row-estimate formatting: 1234 → "1.2k", 4_500_000 → "4.5M". */
export function formatEstimate(n: number | null): string {
  if (n === null) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}

/** Grouped exact integer: 12345 → "12,345". */
export function formatInt(n: number): string {
  return n.toLocaleString("en-US");
}
