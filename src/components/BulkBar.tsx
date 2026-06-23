import { useState } from "react";
import type { Cell, ColumnInfo } from "../lib/types";
import { CellEditor } from "./CellEditor";

interface Props {
  count: number;
  /** Columns eligible for bulk edit (PK columns are excluded by the caller). */
  columns: ColumnInfo[];
  busy: boolean;
  onApply: (column: string, value: Cell) => void;
  onDelete: () => void;
  onClear: () => void;
}

/** Action bar shown when one or more rows are selected: set a single column
 *  across all of them, delete them, or clear the selection. */
export function BulkBar({ count, columns, busy, onApply, onDelete, onClear }: Props) {
  const [editingColumn, setEditingColumn] = useState<string | null>(null);

  const column = columns.find((c) => c.name === editingColumn) ?? null;

  return (
    <div className="bulk-bar">
      <span className="bulk-count">{count} selected</span>

      {column ? (
        <div className="bulk-set">
          <span className="bulk-set-label mono">SET {column.name} =</span>
          <CellEditor
            column={column}
            initial={null}
            busy={busy}
            commitLabel="Apply"
            onCommit={(value) => {
              onApply(column.name, value);
              setEditingColumn(null);
            }}
            onCancel={() => setEditingColumn(null)}
          />
        </div>
      ) : (
        <div className="bulk-actions">
          <select
            className="input bulk-col-select"
            value=""
            disabled={busy || columns.length === 0}
            onChange={(e) => setEditingColumn(e.currentTarget.value || null)}
            aria-label="Column to set"
          >
            <option value="">Set column…</option>
            {columns.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          <button className="btn btn-sm btn-danger" onClick={onDelete} disabled={busy}>
            Delete selected
          </button>
        </div>
      )}

      <div style={{ flex: 1 }} />
      <button className="btn btn-sm btn-ghost" onClick={onClear} disabled={busy}>
        Clear selection
      </button>
    </div>
  );
}
