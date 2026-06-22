# Loupe

A modern desktop PostgreSQL client, built for Neon-first workflows. Explore
schemas, browse and filter data, run SQL, and import/export JSON & XLSX — with
security as a first-class requirement.

Built with **Tauri 2** (Rust core) + **React + TypeScript + Vite** (UI).
Database access uses **sqlx 0.8** over **rustls** TLS.

## Security model

- **Credentials never reach the webview.** The password is stored in the OS
  keychain (`keyring`); only non-secret metadata (host, db, user, SSL mode,
  flags) is persisted, to the app config dir as an atomic, `0600` JSON file.
  The frontend calls Tauri commands and only ever receives serialized results.
- **TLS is mandatory by construction.** Connections are built with
  `PgSslMode::Require` or `VerifyFull` only — a plaintext (`NoTls`) connection
  is impossible. `verify-full` requires a root certificate.
- **`channel_binding` is never set** — sqlx does not support it and including it
  breaks Neon auth. Pasted connection strings are parsed in Rust and any
  password/`channel_binding` is dropped; the user re-enters the password.
- **No SQL injection in app-generated queries.** Identifiers (schema, table,
  column) are quoted with `quote_ident`; values always travel as bound
  parameters. Sort columns are validated against the real column set.
- **Write guards.** Per-connection read-only toggle (default on for "prod"
  connections, enforced server-side via a `READ ONLY` transaction);
  confirmation before destructive editor statements (`UPDATE`/`DELETE` without
  `WHERE`, `DROP`/`TRUNCATE`/`ALTER`); a configurable `statement_timeout`
  (default 30s) and row cap (default 1000) with server-side pagination.
- **Safe import.** Extension + max-size checks, values bound as parameters only
  (file content is never executed), per-row `SAVEPOINT` rejection, atomic
  per-batch transactions, and a dry-run mode that writes nothing.
- **Locked-down Tauri.** Strict CSP, no remote origins, DevTools off in release,
  minimal capabilities (file open/save dialogs only — no `fs`/`shell`/`http`).
  Connection passwords are zeroized after the connect options are built.

## Features

- **Connections** — saved connection cards, structured form or pasted DSN,
  `SELECT 1` test, read-only / prod flags, keychain-backed secrets.
- **Sidebar** — schema → table/view tree with search and row estimates.
- **Data tab** — type-colored grid, server pagination, parameterized `WHERE`
  filter, click-to-sort, realistic "1–50 of N" counter.
- **Structure tab** — columns (type, nullable, default, PK/FK), indexes,
  constraints.
- **Query tab** — mono editor, `Cmd/Ctrl+Enter`, duration + row/affected count,
  read-only enforcement, destructive-statement confirmation.
- **Export** — full selection streamed to JSON or XLSX (never fully buffered),
  respecting active filter and sort, with progress.
- **Import** — JSON/XLSX preview, column mapping, insert/upsert, dry-run, atomic
  batches, and a per-row inserted/updated/skipped/rejected report.

## Type color system

Every Postgres type is identifiable by color + glyph in both the data grid and
the structure view: integers (blue), text (green), decimals (teal), date/time
(amber), boolean (violet), uuid (pink), json (orange), other (grey).

## Development

```bash
pnpm install
pnpm tauri dev      # run the desktop app
pnpm tauri build    # produce a release bundle
```

Backend checks:

```bash
cd src-tauri
cargo test          # unit tests (identifier quoting, TLS policy, coercion)
cargo audit         # advisory scan (policy in .cargo/audit.toml)
```

## Known advisories

`cargo audit` is clean against the policy in `src-tauri/.cargo/audit.toml`, which
acknowledges a set of unfixable transitive advisories (notably `rsa` via
`sqlx-postgres`, medium severity, no upstream fix; and unmaintained Tauri Linux
GTK bindings). None is critical. They are reviewed at each dependency bump.
