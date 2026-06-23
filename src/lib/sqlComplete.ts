// Lightweight, client-side SQL autocomplete helpers. These are pure functions
// shared by the filter bar (DataTab) and the SQL editor (QueryTab) — they reason
// about tokens with simple regexes, in the same spirit as `sqlGuard.ts`. They are
// deliberately approximate: the goal is helpful suggestions, not a real parser.

import type { Cell } from "./types";

/** A single autocomplete entry shown in the dropdown and inserted on pick. */
export interface Suggestion {
  kind: "column" | "keyword" | "table" | "fkvalue" | "value";
  /** The exact text inserted into the input, replacing the current token. */
  text: string;
  /** Secondary hint shown dimmed (column type, FK label, …). */
  detail?: string;
  /** Short tag rendered as a chip (e.g. PK / FK). */
  badge?: string;
}

/** Keywords, operators and common functions worth suggesting in a WHERE/SELECT. */
export const SQL_KEYWORDS: string[] = [
  "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "NULL", "IS", "IN", "LIKE",
  "ILIKE", "BETWEEN", "EXISTS", "AS", "DISTINCT", "JOIN", "LEFT", "RIGHT",
  "INNER", "OUTER", "ON", "GROUP", "BY", "ORDER", "HAVING", "LIMIT", "OFFSET",
  "ASC", "DESC", "CASE", "WHEN", "THEN", "ELSE", "END", "TRUE", "FALSE",
  "now()", "count()", "coalesce()", "lower()", "upper()", "length()", "sum()",
  "avg()", "min()", "max()",
];

const WORD_CHAR = /[A-Za-z0-9_."]/;

/**
 * The identifier under the caret. `token` is the prefix typed up to the caret
 * (used for matching); `[start, end)` spans the whole word (used for replacement).
 */
export function tokenAtCursor(
  text: string,
  caret: number,
): { token: string; start: number; end: number } {
  let start = caret;
  while (start > 0 && WORD_CHAR.test(text[start - 1])) start--;
  let end = caret;
  while (end < text.length && WORD_CHAR.test(text[end])) end++;
  return { token: text.slice(start, caret), start, end };
}

/**
 * When the caret sits on the value side of a `col <op> …` comparison, returns the
 * bare column name on the left (schema/table qualifier and quotes stripped); else
 * null. Used to offer real values from a referenced table for FK columns.
 */
export function fkContextAtCursor(text: string, caret: number): string | null {
  const before = text.slice(0, caret);
  const m = before.match(
    /([A-Za-z_][\w".]*)\s*(?:=|!=|<>|i?like|in\s*\()\s*'?[^'\s,()]*$/i,
  );
  if (!m) return null;
  let col = m[1];
  const dot = col.lastIndexOf(".");
  if (dot >= 0) col = col.slice(dot + 1);
  return col.replace(/"/g, "");
}

/** The broad clause categories that govern which suggestions make sense. */
export type Clause = "select" | "from" | "where" | "orderby" | "groupby" | "on";

const CLAUSE_RE =
  /\b(select|from|join|into|update|where|having|on|order\s+by|group\s+by)\b/gi;

/**
 * The SQL clause governing the caret, found by scanning for the last clause
 * keyword before it. Approximate (no real parser): `SELECT`→select (fields/`*`),
 * `FROM`/`JOIN`/`INTO`/`UPDATE`→from (tables), `WHERE`/`HAVING`/`ON`→column
 * context, `ORDER BY`/`GROUP BY`→column lists. Null before any clause keyword.
 */
export function clauseAtCursor(text: string, caret: number): Clause | null {
  const before = text.slice(0, caret);
  let kw: string | null = null;
  let m: RegExpExecArray | null;
  CLAUSE_RE.lastIndex = 0;
  while ((m = CLAUSE_RE.exec(before))) kw = m[1].toLowerCase().replace(/\s+/g, " ");
  switch (kw) {
    case "select":
      return "select";
    case "from":
    case "join":
    case "into":
    case "update":
      return "from";
    case "where":
    case "having":
      return "where";
    case "on":
      return "on";
    case "order by":
      return "orderby";
    case "group by":
      return "groupby";
    default:
      return null;
  }
}

/** Table names referenced after FROM / JOIN / UPDATE / INTO (schema stripped). */
export function tablesInSql(sql: string): string[] {
  const re = /\b(?:from|join|update|into)\s+("?\w+"?(?:\."?\w+"?)?)/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    let t = m[1].replace(/"/g, "");
    const dot = t.indexOf(".");
    if (dot >= 0) t = t.slice(dot + 1);
    out.push(t);
  }
  return [...new Set(out)];
}

/** A SQL literal for a sampled cell value, ready to drop into an expression. */
export function sqlLiteral(v: Cell): string {
  if (v === null) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return "'" + String(v).replace(/'/g, "''") + "'";
}

/**
 * Filters `candidates` by `token` (case-insensitive) and ranks prefix matches
 * ahead of substring matches. Returns [] for an empty token to avoid noise.
 */
export function rankSuggestions(token: string, candidates: Suggestion[]): Suggestion[] {
  const q = token.replace(/"/g, "").toLowerCase();
  if (!q) return [];
  const prefix: Suggestion[] = [];
  const substr: Suggestion[] = [];
  for (const c of candidates) {
    const t = c.text.toLowerCase();
    if (t.startsWith(q)) prefix.push(c);
    else if (t.includes(q)) substr.push(c);
  }
  return [...prefix, ...substr].slice(0, 50);
}
