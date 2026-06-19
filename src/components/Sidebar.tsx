import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { formatEstimate } from "../lib/format";
import type { ObjectKind, SchemaNode, TableRef } from "../lib/types";
import "./Sidebar.css";

interface Props {
  /** Bumped to force a reload of the tree (e.g. after a DDL query). */
  reloadKey?: number;
  selected: TableRef | null;
  onSelect: (ref: TableRef) => void;
}

function ObjectGlyph({ kind }: { kind: ObjectKind }) {
  // Table = filled grid; view = outlined; others share the view glyph.
  const isTable = kind === "table";
  return (
    <span className={`obj-glyph ${isTable ? "is-table" : "is-view"}`} aria-hidden="true">
      {isTable ? "▦" : "◇"}
    </span>
  );
}

export function Sidebar({ reloadKey, selected, onSelect }: Props) {
  const [tree, setTree] = useState<SchemaNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .listSchemaTree()
      .then((t) => {
        if (!cancelled) setTree(t);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tree;
    return tree
      .map((s) => ({
        ...s,
        objects: s.objects.filter(
          (o) => o.name.toLowerCase().includes(q) || s.schema.toLowerCase().includes(q),
        ),
      }))
      .filter((s) => s.objects.length > 0);
  }, [tree, query]);

  function toggle(schema: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(schema) ? next.delete(schema) : next.add(schema);
      return next;
    });
  }

  const totalObjects = tree.reduce((n, s) => n + s.objects.length, 0);

  return (
    <div className="sidebar">
      <div className="sidebar-search">
        <input
          className="input"
          placeholder="Search tables…"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          aria-label="Search tables and views"
        />
      </div>

      <div className="sidebar-scroll">
        {loading ? (
          <div className="sidebar-note">Loading schema…</div>
        ) : error ? (
          <div className="sidebar-note err">{error}</div>
        ) : totalObjects === 0 ? (
          <div className="sidebar-note">
            No tables or views in this database. Use the Query tab to create one.
          </div>
        ) : filtered.length === 0 ? (
          <div className="sidebar-note">No matches for “{query}”.</div>
        ) : (
          filtered.map((s) => {
            const isCollapsed = collapsed.has(s.schema);
            return (
              <div key={s.schema} className="schema-group">
                <button
                  className="schema-head"
                  onClick={() => toggle(s.schema)}
                  aria-expanded={!isCollapsed}
                >
                  <span className={`chevron ${isCollapsed ? "" : "open"}`} aria-hidden="true">
                    ▸
                  </span>
                  <span className="schema-name">{s.schema}</span>
                  <span className="schema-count">{s.objects.length}</span>
                </button>
                {!isCollapsed && (
                  <ul className="object-list">
                    {s.objects.map((o) => {
                      const isSel =
                        selected?.schema === s.schema && selected?.name === o.name;
                      return (
                        <li key={o.name}>
                          <button
                            className={`object-row ${isSel ? "selected" : ""}`}
                            onClick={() =>
                              onSelect({ schema: s.schema, name: o.name, kind: o.kind })
                            }
                            title={`${s.schema}.${o.name}`}
                          >
                            <ObjectGlyph kind={o.kind} />
                            <span className="object-name">{o.name}</span>
                            <span className="object-rows mono">
                              {formatEstimate(o.estimatedRows)}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
