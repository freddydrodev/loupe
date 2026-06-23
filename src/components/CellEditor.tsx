import { useState } from "react";
import type { Cell, ColumnInfo } from "../lib/types";
import { typeFamily } from "../lib/pgtypes";
import { parseFkTarget } from "../lib/relations";
import { FkPicker } from "./FkPicker";

interface Props {
  column: ColumnInfo;
  /** Current cell value to seed the editor. */
  initial: Cell;
  onCommit: (value: Cell) => void;
  onCancel: () => void;
  busy?: boolean;
  error?: string | null;
  /** Label for the confirm button (e.g. "Apply" in the bulk bar). */
  commitLabel?: string;
}

function initialText(value: Cell, isJson: boolean): string {
  if (value === null) return "";
  if (isJson || typeof value === "object") return JSON.stringify(value, null, 0);
  return String(value);
}

/** Type-aware inline editor with a NULL toggle. Owns its draft and reports the
 *  final value through `onCommit`. Reused for single-cell edits and bulk edits. */
export function CellEditor({
  column,
  initial,
  onCommit,
  onCancel,
  busy,
  error,
  commitLabel = "Save",
}: Props) {
  const family = typeFamily(column.dataType);
  const isJson = family === "json";
  const fk = column.fkTarget ? parseFkTarget(column.fkTarget) : null;

  const [isNull, setIsNull] = useState(initial === null);
  const [text, setText] = useState(() => initialText(initial, isJson));
  const [bool, setBool] = useState<boolean>(initial === true);
  const [localErr, setLocalErr] = useState<string | null>(null);

  function commit() {
    setLocalErr(null);
    if (isNull) {
      onCommit(null);
      return;
    }
    if (family === "bool") {
      onCommit(bool);
      return;
    }
    if (isJson) {
      try {
        onCommit(JSON.parse(text) as Cell);
      } catch (e) {
        setLocalErr(`Invalid JSON: ${String(e)}`);
      }
      return;
    }
    // text / number / uuid / datetime / other: send as a string; the backend
    // casts the placeholder to the column type, so Postgres re-parses it.
    onCommit(text);
  }

  const shownError = error ?? localErr;

  return (
    <div className="cell-editor">
      <div className="cell-editor-input">
        {isNull ? (
          <span className="c-null">NULL</span>
        ) : fk ? (
          <FkPicker
            target={fk}
            value={text}
            onChange={setText}
            onSubmit={commit}
            onCancel={onCancel}
            autoFocus
          />
        ) : family === "bool" ? (
          <select
            className="input"
            value={String(bool)}
            autoFocus
            onChange={(e) => setBool(e.currentTarget.value === "true")}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") onCancel();
            }}
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        ) : isJson ? (
          <textarea
            className="input mono cell-editor-json"
            value={text}
            autoFocus
            onChange={(e) => setText(e.currentTarget.value)}
            onKeyDown={(e) => {
              // Cmd/Ctrl+Enter commits; plain Enter inserts a newline.
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit();
              if (e.key === "Escape") onCancel();
            }}
          />
        ) : (
          <input
            className="input mono"
            type="text"
            inputMode={family === "int" || family === "decimal" ? "decimal" : undefined}
            value={text}
            autoFocus
            onChange={(e) => setText(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") onCancel();
            }}
          />
        )}
      </div>

      <div className="cell-editor-actions">
        {column.nullable && (
          <label className="cell-editor-null" title="Set this field to NULL">
            <input
              type="checkbox"
              checked={isNull}
              onChange={(e) => setIsNull(e.currentTarget.checked)}
            />
            NULL
          </label>
        )}
        <button className="btn btn-sm btn-primary" onClick={commit} disabled={busy}>
          {busy ? "…" : commitLabel}
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>

      {shownError && <div className="cell-editor-err status err">{shownError}</div>}
    </div>
  );
}
