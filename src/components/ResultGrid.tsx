import { useMemo } from "react";
import { cellText } from "../lib/cells";
import { typeFamily } from "../lib/pgtypes";
import type { Cell, RowColumn } from "../lib/types";
import { CellValue } from "./CellValue";
import { TypeBadge } from "./TypeBadge";

/** Read-only typed grid for query results (and any column/row pair). */
export function ResultGrid({ columns, rows }: { columns: RowColumn[]; rows: Cell[][] }) {
  const families = useMemo(() => columns.map((c) => typeFamily(c.dataType)), [columns]);

  return (
    <div className="grid-scroll">
      <table className="grid">
        <thead>
          <tr>
            <th className="rownum-h" />
            {columns.map((c, i) => (
              <th key={`${c.name}-${i}`}>
                <div className="col-head" style={{ cursor: "default" }}>
                  <TypeBadge dataType={c.dataType} compact />
                  <span className="col-name">{c.name}</span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              <td className="rownum mono">{ri + 1}</td>
              {row.map((cell, ci) => (
                <td key={ci} title={cellText(cell)}>
                  <CellValue value={cell} family={families[ci] ?? "other"} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
