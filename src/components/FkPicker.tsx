import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { Cell, FkSample } from "../lib/types";
import type { FkTarget } from "../lib/relations";

interface Props {
  target: FkTarget;
  /** Current draft value (free-text allowed). */
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}

function asText(v: Cell): string {
  if (v === null) return "";
  return String(v);
}

/** Combobox over a referenced table's column: lists existing values (with an
 *  optional label) as you type, while still allowing a free-text entry. */
export function FkPicker({ target, value, onChange, onSubmit, onCancel, autoFocus }: Props) {
  const [samples, setSamples] = useState<FkSample[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounced lookup of referenced values matching the current input.
  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api.fkSampleValues({
          schema: target.schema,
          table: target.table,
          column: target.column,
          search: value.trim() || null,
          limit: 50,
        });
        if (!cancelled) setSamples(r);
      } catch {
        if (!cancelled) setSamples([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [target.schema, target.table, target.column, value]);

  // Close the dropdown when focus leaves the whole control.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  return (
    <div className="fk-picker" ref={boxRef}>
      <input
        className="input mono"
        value={value}
        autoFocus={autoFocus}
        placeholder={`→ ${target.table}.${target.column}`}
        onChange={(e) => {
          onChange(e.currentTarget.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmit?.();
          if (e.key === "Escape") {
            setOpen(false);
            onCancel?.();
          }
        }}
        aria-label={`Foreign key value for ${target.column}`}
      />
      {open && (samples.length > 0 || loading) && (
        <ul className="fk-options" role="listbox">
          {loading && samples.length === 0 && <li className="fk-opt muted">Searching…</li>}
          {samples.map((s, i) => (
            <li key={i} className="fk-opt" role="option" aria-selected={asText(s.value) === value}>
              <button
                type="button"
                className="fk-opt-btn"
                onMouseDown={(e) => {
                  // mousedown (not click) so it fires before the input blurs.
                  e.preventDefault();
                  onChange(asText(s.value));
                  setOpen(false);
                }}
              >
                <span className="mono">{asText(s.value)}</span>
                {s.label && s.label !== asText(s.value) && (
                  <span className="fk-opt-label">{s.label}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
