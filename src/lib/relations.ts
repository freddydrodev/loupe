import type { OnDeleteAction } from "./types";

/** A parsed `ColumnInfo.fkTarget` reference. */
export interface FkTarget {
  schema: string;
  table: string;
  column: string;
}

/** Parses a foreign-key target string as produced by the backend:
 *  `"table(column)"` (schema defaults to `public`) or `"schema.table(column)"`.
 *  Returns null when the string does not match (defensive). */
export function parseFkTarget(fkTarget: string): FkTarget | null {
  const m = fkTarget.trim().match(/^(?:([^.(]+)\.)?([^.(]+)\(([^)]+)\)$/);
  if (!m) return null;
  const [, schema, table, column] = m;
  return { schema: schema ?? "public", table, column };
}

const ON_DELETE_LABELS: Record<OnDeleteAction, string> = {
  noAction: "NO ACTION",
  restrict: "RESTRICT",
  cascade: "CASCADE",
  setNull: "SET NULL",
  setDefault: "SET DEFAULT",
};

export function onDeleteLabel(action: OnDeleteAction): string {
  return ON_DELETE_LABELS[action] ?? action;
}
