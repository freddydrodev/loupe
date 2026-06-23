// Typed wrappers over the Tauri command surface. The frontend talks to the
// Rust core only through these functions.

import { invoke } from "@tauri-apps/api/core";
import type {
  AffectedResult,
  BulkUpdateOpts,
  ColumnInfo,
  ConnectionMeta,
  ConstraintInfo,
  DeleteRowsOpts,
  ExportOpts,
  ExportResult,
  FkSample,
  FkSampleOpts,
  GetRowsOpts,
  ImportOpts,
  ImportPreview,
  ImportReport,
  IndexInfo,
  QueryOutcome,
  ReferencingConstraint,
  RowsResult,
  SchemaNode,
  UpdateResult,
  UpdateRowOpts,
} from "./types";

export const api = {
  appReady: () => invoke<string>("app_ready"),

  // ── Connections ──────────────────────────────────────────────────────────
  listConnections: () => invoke<ConnectionMeta[]>("list_connections"),

  saveConnection: (meta: ConnectionMeta, password: string | null) =>
    invoke<ConnectionMeta>("save_connection", { meta, password }),

  deleteConnection: (id: string) =>
    invoke<void>("delete_connection", { id }),

  testConnection: (meta: ConnectionMeta, password: string | null) =>
    invoke<void>("test_connection", { meta, password }),

  connect: (id: string) => invoke<void>("connect", { id }),

  disconnect: () => invoke<void>("disconnect"),

  currentConnection: () =>
    invoke<ConnectionMeta | null>("current_connection"),

  parseConnectionString: (url: string) =>
    invoke<ConnectionMeta>("parse_connection_string", { url }),

  // ── Schema ───────────────────────────────────────────────────────────────
  listSchemaTree: () => invoke<SchemaNode[]>("list_schema_tree"),

  getTableColumns: (schema: string, table: string) =>
    invoke<ColumnInfo[]>("get_table_columns", { schema, table }),

  getRows: (schema: string, table: string, opts: GetRowsOpts) =>
    invoke<RowsResult>("get_rows", { schema, table, opts }),

  getTableIndexes: (schema: string, table: string) =>
    invoke<IndexInfo[]>("get_table_indexes", { schema, table }),

  getTableConstraints: (schema: string, table: string) =>
    invoke<ConstraintInfo[]>("get_table_constraints", { schema, table }),

  runQuery: (sql: string, readOnly: boolean) =>
    invoke<QueryOutcome>("run_query", { sql, opts: { readOnly } }),

  exportData: (opts: ExportOpts) => invoke<ExportResult>("export_data", { opts }),

  importPreview: (path: string) => invoke<ImportPreview>("import_preview", { path }),

  importData: (opts: ImportOpts) => invoke<ImportReport>("import_data", { opts }),

  // ── Row writes & relations ─────────────────────────────────────────────────
  updateRow: (opts: UpdateRowOpts) => invoke<UpdateResult>("update_row", { opts }),

  bulkUpdateColumn: (opts: BulkUpdateOpts) =>
    invoke<AffectedResult>("bulk_update_column", { opts }),

  deleteRows: (opts: DeleteRowsOpts) => invoke<AffectedResult>("delete_rows", { opts }),

  getReferencingConstraints: (schema: string, table: string) =>
    invoke<ReferencingConstraint[]>("get_referencing_constraints", { schema, table }),

  fkSampleValues: (opts: FkSampleOpts) => invoke<FkSample[]>("fk_sample_values", { opts }),
};
