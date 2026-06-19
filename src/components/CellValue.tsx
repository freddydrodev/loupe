import type { Cell } from "../lib/types";
import type { TypeFamily } from "../lib/pgtypes";

/** Renders a single decoded cell with type-aware styling:
 *  NULL in faint italic, booleans colored, json/uuid in mono. */
export function CellValue({ value, family }: { value: Cell; family: TypeFamily }) {
  if (value === null) {
    return <span className="c-null">NULL</span>;
  }
  if (typeof value === "boolean") {
    return <span className={value ? "c-true" : "c-false"}>{String(value)}</span>;
  }
  if (typeof value === "object") {
    return <span className="c-json mono">{JSON.stringify(value)}</span>;
  }
  if (family === "uuid") {
    return <span className="c-uuid mono">{String(value)}</span>;
  }
  if (typeof value === "number" || family === "int" || family === "decimal") {
    return <span className="c-num mono">{String(value)}</span>;
  }
  if (family === "datetime") {
    return <span className="c-date mono">{String(value)}</span>;
  }
  return <span>{String(value)}</span>;
}
