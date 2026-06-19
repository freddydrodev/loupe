import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { ColumnInfo, ConstraintInfo, IndexInfo, TableRef } from "../lib/types";
import { TypeBadge } from "../components/TypeBadge";
import "./StructureTab.css";

interface Props {
  table: TableRef;
}

const CONSTRAINT_LABEL: Record<ConstraintInfo["kind"], string> = {
  primaryKey: "PK",
  unique: "UNIQUE",
  foreignKey: "FK",
  check: "CHECK",
  exclusion: "EXCLUDE",
  other: "—",
};

export function StructureTab({ table }: Props) {
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [indexes, setIndexes] = useState<IndexInfo[]>([]);
  const [constraints, setConstraints] = useState<ConstraintInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      api.getTableColumns(table.schema, table.name),
      api.getTableIndexes(table.schema, table.name),
      api.getTableConstraints(table.schema, table.name),
    ])
      .then(([c, i, k]) => {
        if (cancelled) return;
        setColumns(c);
        setIndexes(i);
        setConstraints(k);
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [table.schema, table.name]);

  if (loading) return <div className="ws-placeholder">Loading structure…</div>;
  if (error) return <div className="struct-error status err">{error}</div>;

  return (
    <div className="struct-tab">
      <section className="struct-section">
        <h3 className="struct-h">Columns</h3>
        <table className="struct-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Nullable</th>
              <th>Default</th>
              <th>Key</th>
            </tr>
          </thead>
          <tbody>
            {columns.map((c) => (
              <tr key={c.name}>
                <td className="mono col-name-cell">{c.name}</td>
                <td>
                  <TypeBadge dataType={c.dataType} />
                </td>
                <td>
                  {c.nullable ? (
                    <span className="muted">null</span>
                  ) : (
                    <span className="not-null">not null</span>
                  )}
                </td>
                <td className="mono default-cell" title={c.default ?? ""}>
                  {c.default ?? <span className="muted">—</span>}
                </td>
                <td>
                  <div className="key-tags">
                    {c.isPk && <span className="key-tag pk">PK</span>}
                    {c.fkTarget && (
                      <span className="key-tag fk mono" title={`references ${c.fkTarget}`}>
                        FK → {c.fkTarget}
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="struct-section">
        <h3 className="struct-h">Indexes</h3>
        {indexes.length === 0 ? (
          <p className="struct-empty">No indexes.</p>
        ) : (
          <table className="struct-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Columns</th>
                <th>Unique</th>
                <th>Definition</th>
              </tr>
            </thead>
            <tbody>
              {indexes.map((ix) => (
                <tr key={ix.name}>
                  <td className="mono">
                    {ix.name}
                    {ix.primary && <span className="key-tag pk" style={{ marginLeft: 6 }}>PK</span>}
                  </td>
                  <td className="mono">{ix.columns.join(", ") || <span className="muted">expr</span>}</td>
                  <td>{ix.unique ? "yes" : <span className="muted">no</span>}</td>
                  <td className="mono def-cell" title={ix.definition}>
                    {ix.definition}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="struct-section">
        <h3 className="struct-h">Constraints</h3>
        {constraints.length === 0 ? (
          <p className="struct-empty">No constraints.</p>
        ) : (
          <table className="struct-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Kind</th>
                <th>Definition</th>
              </tr>
            </thead>
            <tbody>
              {constraints.map((k) => (
                <tr key={k.name}>
                  <td className="mono">{k.name}</td>
                  <td>
                    <span className={`key-tag kind-${k.kind}`}>{CONSTRAINT_LABEL[k.kind]}</span>
                  </td>
                  <td className="mono def-cell" title={k.definition}>
                    {k.definition}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
