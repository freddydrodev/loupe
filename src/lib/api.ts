// Typed wrappers over the Tauri command surface. The frontend talks to the
// Rust core only through these functions.

import { invoke } from "@tauri-apps/api/core";
import type {
  ColumnInfo,
  ConnectionMeta,
  GetRowsOpts,
  RowsResult,
  SchemaNode,
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
};
