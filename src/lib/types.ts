// Mirror of the Rust command contract. Field names are camelCase to match the
// serde `rename_all = "camelCase"` structs. No type here ever carries a password.

export type SslMode = "require" | "verifyFull";

export interface ConnectionMeta {
  id: string;
  label: string;
  host: string;
  port: number;
  database: string;
  username: string;
  sslMode: SslMode;
  rootCertPath: string | null;
  readOnly: boolean;
  isProd: boolean;
  statementTimeoutMs: number;
  rowLimit: number;
}

export function blankConnection(): ConnectionMeta {
  return {
    id: "",
    label: "",
    host: "",
    port: 5432,
    database: "",
    username: "",
    sslMode: "require",
    rootCertPath: null,
    readOnly: false,
    isProd: false,
    statementTimeoutMs: 30_000,
    rowLimit: 1_000,
  };
}
