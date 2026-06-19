import type { Cell } from "./types";

/** Full textual form of a cell, used for tooltips and copying. */
export function cellText(value: Cell): string {
  if (value === null) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
