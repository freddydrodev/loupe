// Lightweight client-side detection of risky statements. This is a confirmation
// gate, not a security boundary — read-only enforcement happens in Rust/Postgres.
// Comments and string/identifier literals are stripped first to cut false hits.

function strip(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""');
}

/** Returns human-readable warnings for destructive statements, or []. */
export function analyzeDestructive(sql: string): string[] {
  const s = strip(sql).toLowerCase();
  const warnings: string[] = [];

  if (/\bupdate\b/.test(s) && !/\bwhere\b/.test(s)) {
    warnings.push("UPDATE has no WHERE clause — it will modify every row.");
  }
  if (/\bdelete\s+from\b/.test(s) && !/\bwhere\b/.test(s)) {
    warnings.push("DELETE has no WHERE clause — it will remove every row.");
  }
  if (/\bdrop\b/.test(s)) {
    warnings.push("DROP permanently removes database objects.");
  }
  if (/\btruncate\b/.test(s)) {
    warnings.push("TRUNCATE empties the table irreversibly.");
  }
  if (/\balter\b/.test(s)) {
    warnings.push("ALTER changes the schema.");
  }
  return warnings;
}
