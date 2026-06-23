import { useCallback, useEffect, useRef, useState } from "react";
import {
  clauseAtCursor,
  fkContextAtCursor,
  tokenAtCursor,
  type Clause,
  type Suggestion,
} from "../lib/sqlComplete";

type SqlElement = HTMLInputElement | HTMLTextAreaElement;

export interface AutocompleteCtx {
  /** Prefix typed up to the caret. */
  token: string;
  /** Column on the left of a `col <op> …` comparison, if the caret is on its value. */
  fkColumn: string | null;
  /** The SQL clause governing the caret, used to scope suggestions. */
  clause: Clause | null;
  text: string;
  caret: number;
}

interface Opts {
  value: string;
  onChange: (v: string) => void;
  getSuggestions: (ctx: AutocompleteCtx) => Suggestion[] | Promise<Suggestion[]>;
}

/**
 * Token-level autocomplete for a single `<input>` / `<textarea>`. The caller
 * composes the returned handlers and renders `dropdown` inside a relatively
 * positioned wrapper. Mirrors the proven FkPicker combobox patterns (debounce,
 * outside-click close, mousedown-select before blur).
 */
export function useSqlAutocomplete({ value, onChange, getSuggestions }: Opts) {
  const elRef = useRef<SqlElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);

  const span = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const reqId = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCaret = useRef<number | null>(null);

  // Keep latest closures without making them re-subscribe effects.
  const getRef = useRef(getSuggestions);
  getRef.current = getSuggestions;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const valueRef = useRef(value);
  valueRef.current = value;

  // Close when focus leaves the whole control.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Restore the caret after a controlled re-render following an insertion.
  useEffect(() => {
    if (pendingCaret.current == null || !elRef.current) return;
    const c = pendingCaret.current;
    pendingCaret.current = null;
    elRef.current.focus();
    elRef.current.setSelectionRange(c, c);
  }, [value]);

  const recompute = useCallback((el: SqlElement) => {
    const text = el.value;
    const caret = el.selectionStart ?? text.length;
    const { token, start, end } = tokenAtCursor(text, caret);
    const fkColumn = fkContextAtCursor(text, caret);
    const clause = clauseAtCursor(text, caret);
    // Need a typed prefix, unless picking a value or inside a known clause
    // (so `SELECT `, `FROM `, `WHERE ` offer suggestions with nothing typed yet).
    if (!fkColumn && !clause && token.length === 0) {
      setOpen(false);
      return;
    }
    span.current = { start, end };
    const myReq = ++reqId.current;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      try {
        const out = await getRef.current({ token, fkColumn, clause, text, caret });
        if (myReq !== reqId.current) return;
        setItems(out);
        setHi(0);
        setOpen(out.length > 0);
      } catch {
        if (myReq !== reqId.current) return;
        setItems([]);
        setOpen(false);
      }
    }, 120);
  }, []);

  const insert = useCallback((s: Suggestion) => {
    const el = elRef.current;
    if (!el) return;
    const { start, end } = span.current;
    const v = valueRef.current;
    pendingCaret.current = start + s.text.length;
    onChangeRef.current(v.slice(0, start) + s.text + v.slice(end));
    reqId.current++; // invalidate any in-flight fetch
    setOpen(false);
  }, []);

  /** Returns true when the keystroke was consumed by the open dropdown. */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (!open || items.length === 0) return false;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setHi((h) => (h + 1) % items.length);
          return true;
        case "ArrowUp":
          e.preventDefault();
          setHi((h) => (h - 1 + items.length) % items.length);
          return true;
        case "Enter":
        case "Tab":
          e.preventDefault();
          insert(items[hi]);
          return true;
        case "Escape":
          e.preventDefault();
          setOpen(false);
          return true;
        default:
          return false;
      }
    },
    [open, items, hi, insert],
  );

  const onInput = useCallback(
    (e: React.SyntheticEvent<SqlElement>) => recompute(e.currentTarget),
    [recompute],
  );

  const dropdown =
    open && items.length > 0 ? (
      <ul className="ac-menu" role="listbox">
        {items.map((s, i) => (
          <li key={`${s.kind}:${s.text}:${i}`} className="ac-item" role="option" aria-selected={i === hi}>
            <button
              type="button"
              className={`ac-item-btn${i === hi ? " active" : ""}`}
              // mousedown (not click) so it fires before the input blurs.
              onMouseDown={(ev) => {
                ev.preventDefault();
                insert(s);
              }}
              onMouseEnter={() => setHi(i)}
            >
              <span className="ac-text mono">{s.text}</span>
              {s.badge && <span className="ac-badge">{s.badge}</span>}
              {s.detail && <span className="ac-detail">{s.detail}</span>}
            </button>
          </li>
        ))}
      </ul>
    ) : null;

  return { elRef, wrapRef, onKeyDown, onInput, dropdown };
}
