import { api } from "../lib/api";
import { useSwr } from "../lib/swr";
import type { ColumnInfo, ConnectionMeta, ConstraintInfo, IndexInfo, TableRef } from "../lib/types";
import { TypeBadge } from "../components/TypeBadge";
import "./StructureTab.css";

interface Props {
  connection: ConnectionMeta;
  table: TableRef;
}

interface Structure {
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  constraints: ConstraintInfo[];
}

const CONSTRAINT_LABEL: Record<ConstraintInfo["kind"], string> = {
  primaryKey: "PK",
  unique: "UNIQUE",
  foreignKey: "FK",
  check: "CHECK",
  exclusion: "EXCLUDE",
  other: "—",
};

export function StructureTab({ connection, table }: Props) {
  const cacheKey = `struct|${connection.id}|${table.schema}.${table.name}`;
  const { data, error, loading } = useSwr<Structure>(cacheKey, async () => {
    const [columns, indexes, constraints] = await Promise.all([
      api.getTableColumns(table.schema, table.name),
      api.getTableIndexes(table.schema, table.name),
      api.getTableConstraints(table.schema, table.name),
    ]);
    return { columns, indexes, constraints };
  });

  // First visit with nothing cached: show a loader. Otherwise paint the last
  // known structure (stale) and let the fetch refresh it in the background.
  if (loading) return <div className="ws-placeholder">Loading structure…</div>;
  if (error && !data) return <div className="struct-error status err">{error}</div>;

  const columns = data?.columns ?? [];
  const indexes = data?.indexes ?? [];
  const constraints = data?.constraints ?? [];

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
