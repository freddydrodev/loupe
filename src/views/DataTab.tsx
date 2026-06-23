import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useSwr, evictAll } from "../lib/swr";
import { cellText } from "../lib/cells";
import { formatInt } from "../lib/format";
import { typeFamily } from "../lib/pgtypes";
import type {
  Cell,
  ColumnInfo,
  ConnectionMeta,
  PkPredicate,
  ReferencingConstraint,
  RowColumn,
  RowsResult,
  SortSpec,
  TableRef,
} from "../lib/types";
import { CellValue } from "../components/CellValue";
import { CellEditor } from "../components/CellEditor";
import { BulkBar } from "../components/BulkBar";
import { Confirm } from "../components/Confirm";
import { DeleteConfirmBody } from "../components/DeleteConfirmBody";
import { TypeBadge } from "../components/TypeBadge";
import { ExportDialog } from "../components/ExportDialog";
import { ImportDialog } from "../components/ImportDialog";
import { useSqlAutocomplete } from "../components/SqlAutocomplete";
import { parseFkTarget } from "../lib/relations";
import { SQL_KEYWORDS, rankSuggestions, sqlLiteral, type Suggestion } from "../lib/sqlComplete";
import "./DataTab.css";

interface Props {
  connection: ConnectionMeta;
  table: TableRef;
}

interface Editing {
  ri: number;
  ci: number;
}

interface PendingDelete {
  pks: PkPredicate[][];
  count: number;
}

export function DataTab({ connection, table }: Props) {
  const pageSize = Math.min(100, Math.max(1, connection.rowLimit || 100));

  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<SortSpec | null>(null);
  const [filterInput, setFilterInput] = useState("");
  const [appliedFilter, setAppliedFilter] = useState("");
  const [showExport, setShowExport] = useState(false);
  const [showImport, setShowImport] = useState(false);

  // Write-related UI state.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<Editing | null>(null);
  const [writeBusy, setWriteBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  // Reset view + selection state whenever the selected table changes.
  useEffect(() => {
    setOffset(0);
    setSort(null);
    setFilterInput("");
    setAppliedFilter("");
    setSelected(new Set());
    setEditing(null);
    setWriteError(null);
  }, [table.schema, table.name]);

  const filter = appliedFilter.trim();
  const cacheKey = [
    connection.id,
    `${table.schema}.${table.name}`,
    filter,
    sort ? `${sort.column}:${sort.descending ? "desc" : "asc"}` : "",
    pageSize,
    offset,
  ].join("|");

  const {
    data: result,
    error,
    loading,
    revalidating,
    refetch: load,
  } = useSwr<RowsResult>(cacheKey, () =>
    api.getRows(table.schema, table.name, {
      filter: filter || null,
      sort,
      limit: pageSize,
      offset,
    }),
  );

  // Column metadata (PK / FK / nullable / type) — needed to target and edit rows.
  const { data: columnsInfo } = useSwr<ColumnInfo[]>(
    `cols|${connection.id}|${table.schema}.${table.name}`,
    () => api.getTableColumns(table.schema, table.name),
  );

  // Inbound foreign keys — fetched lazily, only when a delete is pending.
  const { data: refs, loading: refsLoading } = useSwr<ReferencingConstraint[]>(
    pendingDelete ? `refs|${connection.id}|${table.schema}.${table.name}` : null,
    () => api.getReferencingConstraints(table.schema, table.name),
  );

  const busy = loading || revalidating;

  const families = useMemo(
    () => (result?.columns ?? []).map((c) => typeFamily(c.dataType)),
    [result],
  );

  const colByName = useMemo(() => {
    const m = new Map<string, ColumnInfo>();
    for (const c of columnsInfo ?? []) m.set(c.name, c);
    return m;
  }, [columnsInfo]);

  const pkColumns = useMemo(
    () => (columnsInfo ?? []).filter((c) => c.isPk).map((c) => c.name),
    [columnsInfo],
  );

  // Field/keyword/relation autocomplete for the WHERE filter. Columns of the
  // current table plus SQL keywords; for a value being typed against an FK
  // column, real values are sampled from the referenced table.
  const filterAc = useSqlAutocomplete({
    value: filterInput,
    onChange: setFilterInput,
    getSuggestions: ({ token, fkColumn }) => {
      if (fkColumn) {
        const col = colByName.get(fkColumn);
        const fk = col?.fkTarget ? parseFkTarget(col.fkTarget) : null;
        if (fk) {
          return api
            .fkSampleValues({ ...fk, search: token || null, limit: 50 })
            .then((vals) =>
              vals.map<Suggestion>((v) => ({
                kind: "fkvalue",
                text: sqlLiteral(v.value),
                detail: v.label ?? undefined,
              })),
            );
        }
      }
      const cands: Suggestion[] = [
        ...(columnsInfo ?? []).map<Suggestion>((c) => ({
          kind: "column",
          text: c.name,
          detail: c.dataType,
          badge: c.isPk ? "PK" : c.fkTarget ? "FK" : undefined,
        })),
        ...SQL_KEYWORDS.map<Suggestion>((k) => ({ kind: "keyword", text: k })),
      ];
      return rankSuggestions(token, cands);
    },
  });

  const editable =
    table.kind === "table" && !connection.readOnly && pkColumns.length > 0;

  // Why editing is unavailable, when it is.
  const disabledReason =
    table.kind !== "table"
      ? "This is a view, so its rows cannot be edited here."
      : connection.readOnly
        ? "This connection is read-only."
        : columnsInfo && pkColumns.length === 0
          ? "This table has no primary key, so rows cannot be edited or deleted. Add a primary key or unique constraint to enable editing."
          : null;

  /** Builds the full PK predicate for a row, or null if it can't be formed. */
  function rowPk(row: Cell[]): PkPredicate[] | null {
    if (!result) return null;
    const preds: PkPredicate[] = [];
    result.columns.forEach((c, i) => {
      if (pkColumns.includes(c.name)) preds.push({ column: c.name, value: row[i] });
    });
    return preds.length === pkColumns.length ? preds : null;
  }

  function onSortClick(col: RowColumn) {
    setOffset(0);
    setEditing(null);
    setSort((prev) => {
      if (!prev || prev.column !== col.name) return { column: col.name, descending: false };
      if (!prev.descending) return { column: col.name, descending: true };
      return null;
    });
  }

  function applyFilter() {
    setOffset(0);
    setSelected(new Set());
    setEditing(null);
    setAppliedFilter(filterInput);
  }

  function clearSelection() {
    setSelected(new Set());
  }

  /** After any successful write: drop caches, reload the page, reset UI. */
  function afterWrite() {
    evictAll();
    void load();
    setSelected(new Set());
    setEditing(null);
  }

  async function commitEdit(ci: number, ri: number, value: Cell) {
    if (!result) return;
    const colName = result.columns[ci].name;
    const pk = rowPk(result.rows[ri]);
    if (!pk) {
      setEditError("Could not identify this row by its primary key.");
      return;
    }
    setWriteBusy(true);
    setEditError(null);
    try {
      await api.updateRow({
        schema: table.schema,
        table: table.name,
        edits: [{ column: colName, value }],
        pk,
      });
      afterWrite();
    } catch (e) {
      setEditError(String(e));
    } finally {
      setWriteBusy(false);
    }
  }

  async function applyBulk(column: string, value: Cell) {
    if (!result) return;
    const pks = [...selected]
      .map((ri) => rowPk(result.rows[ri]))
      .filter((p): p is PkPredicate[] => p !== null);
    if (pks.length === 0) return;
    setWriteBusy(true);
    setWriteError(null);
    try {
      await api.bulkUpdateColumn({ schema: table.schema, table: table.name, column, value, pks });
      afterWrite();
    } catch (e) {
      setWriteError(String(e));
    } finally {
      setWriteBusy(false);
    }
  }

  function requestDelete(indices: number[]) {
    if (!result) return;
    const pks = indices
      .map((ri) => rowPk(result.rows[ri]))
      .filter((p): p is PkPredicate[] => p !== null);
    if (pks.length === 0) return;
    setWriteError(null);
    setPendingDelete({ pks, count: pks.length });
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setWriteBusy(true);
    setWriteError(null);
    try {
      await api.deleteRows({ schema: table.schema, table: table.name, pks: pendingDelete.pks });
      setPendingDelete(null);
      afterWrite();
    } catch (e) {
      setWriteError(String(e));
      setPendingDelete(null);
    } finally {
      setWriteBusy(false);
    }
  }

  const total = result?.total ?? 0;
  const shown = result?.rows.length ?? 0;
  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = offset + shown;
  const canPrev = offset > 0;
  const canNext = offset + pageSize < total;

  const allSelected = shown > 0 && selected.size === shown;
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(Array.from({ length: shown }, (_, i) => i)));
  }
  function toggleRow(ri: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ri)) next.delete(ri);
      else next.add(ri);
      return next;
    });
  }

  const bulkColumns = (columnsInfo ?? []).filter((c) => !c.isPk);

  return (
    <div className="data-tab">
      <div className="data-toolbar">
        <div className="filter-box">
          <span className="filter-where mono">WHERE</span>
          <div className="ac-wrap" ref={filterAc.wrapRef}>
            <input
              ref={filterAc.elRef as React.RefObject<HTMLInputElement>}
              className="input mono"
              placeholder="e.g. status = 'active' AND created_at > now() - interval '7 days'"
              value={filterInput}
              onChange={(e) => {
                setFilterInput(e.currentTarget.value);
                filterAc.onInput(e);
              }}
              onClick={filterAc.onInput}
              onKeyDown={(e) => {
                if (filterAc.onKeyDown(e)) return;
                if (e.key === "Enter") applyFilter();
              }}
              aria-label="Filter condition"
            />
            {filterAc.dropdown}
          </div>
          <button className="btn btn-sm" onClick={applyFilter} disabled={busy}>
            Apply
          </button>
          {appliedFilter && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setFilterInput("");
                setOffset(0);
                setAppliedFilter("");
              }}
            >
              Clear
            </button>
          )}
        </div>
        <div style={{ flex: 1 }} />
        {table.kind === "table" && (
          <button className="btn btn-sm" onClick={() => setShowImport(true)}>
            Import
          </button>
        )}
        <button className="btn btn-sm" onClick={() => setShowExport(true)}>
          Export
        </button>
        <button className="btn btn-sm" onClick={() => void load()} disabled={busy}>
          {busy ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {disabledReason && (
        <div className="data-banner" role="note">
          {disabledReason}
        </div>
      )}

      {writeError && (
        <div className="data-banner data-banner-err status err">
          {writeError}
          <button className="btn btn-ghost btn-sm" onClick={() => setWriteError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {editable && selected.size > 0 && (
        <BulkBar
          count={selected.size}
          columns={bulkColumns}
          busy={writeBusy}
          onApply={applyBulk}
          onDelete={() => requestDelete([...selected])}
          onClear={clearSelection}
        />
      )}

      {error ? (
        <div className="data-error">
          <div className="status err">{error}</div>
          <p className="hint">Check the filter expression, then Apply again.</p>
        </div>
      ) : (
        <div className="grid-scroll" data-stale={revalidating ? "" : undefined}>
          <table className="grid">
            <thead>
              <tr>
                {editable && (
                  <th className="sel-h">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label="Select all rows"
                    />
                  </th>
                )}
                <th className="rownum-h" />
                {(result?.columns ?? []).map((c) => {
                  const active = sort?.column === c.name;
                  return (
                    <th key={c.name}>
                      <button className="col-head" onClick={() => onSortClick(c)} title="Sort">
                        <TypeBadge dataType={c.dataType} compact />
                        <span className="col-name">{c.name}</span>
                        <span className="sort-ind">
                          {active ? (sort?.descending ? "▼" : "▲") : ""}
                        </span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {(result?.rows ?? []).map((row, ri) => (
                <tr key={ri} data-selected={selected.has(ri) ? "" : undefined}>
                  {editable && (
                    <td className="sel-cell">
                      <input
                        type="checkbox"
                        checked={selected.has(ri)}
                        onChange={() => toggleRow(ri)}
                        aria-label={`Select row ${offset + ri + 1}`}
                      />
                    </td>
                  )}
                  <td className="rownum mono">{offset + ri + 1}</td>
                  {row.map((cell, ci) => {
                    const isEditing = editing?.ri === ri && editing?.ci === ci;
                    const colInfo = colByName.get(result!.columns[ci].name);
                    if (isEditing && colInfo) {
                      return (
                        <td key={ci} className="cell-editing">
                          <CellEditor
                            column={colInfo}
                            initial={cell}
                            busy={writeBusy}
                            error={editError}
                            onCommit={(v) => void commitEdit(ci, ri, v)}
                            onCancel={() => {
                              setEditing(null);
                              setEditError(null);
                            }}
                          />
                        </td>
                      );
                    }
                    return (
                      <td
                        key={ci}
                        title={cellText(cell)}
                        className={editable ? "cell-editable" : undefined}
                        onDoubleClick={
                          editable
                            ? () => {
                                setEditError(null);
                                setEditing({ ri, ci });
                              }
                            : undefined
                        }
                      >
                        <CellValue value={cell} family={families[ci] ?? "other"} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && shown === 0 && (
            <div className="data-empty">
              {appliedFilter ? "No rows match this filter." : "This relation has no rows."}
            </div>
          )}
        </div>
      )}

      <div className="data-footer">
        <span className="count mono">
          {total === 0 ? "0 rows" : `${formatInt(rangeStart)}–${formatInt(rangeEnd)} of ${formatInt(total)}`}
        </span>
        {editable && <span className="footer-hint">Double-click a cell to edit</span>}
        <div style={{ flex: 1 }} />
        <button
          className="btn btn-sm"
          onClick={() => setOffset(Math.max(0, offset - pageSize))}
          disabled={!canPrev || busy}
        >
          ‹ Prev
        </button>
        <button
          className="btn btn-sm"
          onClick={() => setOffset(offset + pageSize)}
          disabled={!canNext || busy}
        >
          Next ›
        </button>
      </div>

      {pendingDelete && (
        <Confirm
          title={`Delete ${pendingDelete.count} ${pendingDelete.count === 1 ? "row" : "rows"}`}
          danger
          confirmLabel={writeBusy ? "Deleting…" : "Delete"}
          body={
            <DeleteConfirmBody
              count={pendingDelete.count}
              refs={refs ?? []}
              loadingRefs={refsLoading}
            />
          }
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {showExport && (
        <ExportDialog
          source={{
            kind: "table",
            schema: table.schema,
            table: table.name,
            filter: appliedFilter.trim() || null,
            sort,
            defaultName: table.name,
          }}
          onClose={() => setShowExport(false)}
        />
      )}

      {showImport && (
        <ImportDialog
          table={table}
          onClose={() => setShowImport(false)}
          onImported={() => {
            evictAll();
            void load();
          }}
        />
      )}
    </div>
  );
}
