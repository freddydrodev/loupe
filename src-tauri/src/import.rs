//! Import from JSON or XLSX into an existing table.
//!
//! Safety properties:
//!  - Extension and a configurable max file size are validated before any read.
//!  - File content is never executed; values become **bound parameters** only,
//!    and identifiers (schema/table/columns) are quoted.
//!  - Each batch runs in its own transaction ("all or nothing per batch"); a
//!    per-row SAVEPOINT lets one bad row be rejected (with a reason) without
//!    poisoning its batch.
//!  - Dry-run validates everything and rolls back, writing nothing.

use crate::bind::value_to_bind;
use crate::error::{AppError, AppResult};
use crate::introspect::table_columns;
use crate::sql::{quote_ident, quote_qualified};
use calamine::{open_workbook_auto, Data, Reader};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::{PgPool, Row};
use std::collections::HashMap;
use std::path::Path;
use tauri::Emitter;

const DEFAULT_MAX_BYTES: u64 = 64 * 1024 * 1024;
const PREVIEW_ROWS: usize = 50;
const MAX_REPORTED_ERRORS: usize = 200;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub columns: Vec<String>,
    pub sample_rows: Vec<Vec<Value>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnMap {
    /// Column name in the file.
    pub file: String,
    /// Target column name in the table.
    pub column: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOpts {
    pub path: String,
    pub schema: String,
    pub table: String,
    pub mapping: Vec<ColumnMap>,
    /// "insert" | "upsertUpdate" | "upsertIgnore".
    pub mode: String,
    #[serde(default)]
    pub conflict_key: Vec<String>,
    #[serde(default)]
    pub dry_run: bool,
    #[serde(default = "default_batch")]
    pub batch_size: i64,
    #[serde(default)]
    pub max_bytes: Option<u64>,
}

fn default_batch() -> i64 {
    500
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RowError {
    pub row: i64,
    pub message: String,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub inserted: i64,
    pub updated: i64,
    pub skipped: i64,
    pub rejected: i64,
    pub errors: Vec<RowError>,
    pub dry_run: bool,
}

// ── File reading ─────────────────────────────────────────────────────────────

fn extension(path: &str) -> AppResult<String> {
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .ok_or_else(|| AppError::Validation("File has no extension.".into()))
}

fn check_size(path: &str, max: u64) -> AppResult<()> {
    let len = std::fs::metadata(path)?.len();
    if len > max {
        return Err(AppError::Validation(format!(
            "File is {} MB, over the {} MB limit.",
            len / (1024 * 1024),
            max / (1024 * 1024)
        )));
    }
    Ok(())
}

fn data_to_value(d: &Data) -> Value {
    match d {
        Data::Empty => Value::Null,
        Data::String(s) => Value::String(s.clone()),
        Data::Float(f) => serde_json::Number::from_f64(*f)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        Data::Int(i) => Value::Number((*i).into()),
        Data::Bool(b) => Value::Bool(*b),
        Data::DateTime(dt) => match dt.as_datetime() {
            Some(ndt) => Value::String(ndt.format("%Y-%m-%dT%H:%M:%S%.f").to_string()),
            None => Value::String(dt.to_string()),
        },
        Data::DateTimeIso(s) | Data::DurationIso(s) => Value::String(s.clone()),
        Data::Error(e) => Value::String(format!("#ERR:{e:?}")),
    }
}

/// Reads a file into (column names, rows aligned to those columns).
/// `limit` caps the number of data rows read (used for previews).
fn read_table(path: &str, limit: Option<usize>) -> AppResult<(Vec<String>, Vec<Vec<Value>>)> {
    match extension(path)?.as_str() {
        "json" => read_json(path, limit),
        "xlsx" | "xls" | "xlsm" => read_xlsx(path, limit),
        other => Err(AppError::Validation(format!(
            "Unsupported file type: .{other}. Use JSON or XLSX."
        ))),
    }
}

fn read_json(path: &str, limit: Option<usize>) -> AppResult<(Vec<String>, Vec<Vec<Value>>)> {
    let bytes = std::fs::read(path)?;
    let parsed: Value = serde_json::from_slice(&bytes)
        .map_err(|e| AppError::Validation(format!("Invalid JSON: {e}")))?;
    let array = match parsed {
        Value::Array(a) => a,
        _ => {
            return Err(AppError::Validation(
                "JSON import expects an array of objects at the top level.".into(),
            ))
        }
    };

    // Column order: first-seen key order across the (sampled) records.
    let mut columns: Vec<String> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    let take = limit.unwrap_or(usize::MAX);

    let mut objects: Vec<Map<String, Value>> = Vec::new();
    for (i, item) in array.into_iter().enumerate() {
        if i >= take {
            break;
        }
        let obj = match item {
            Value::Object(o) => o,
            _ => {
                return Err(AppError::Validation(format!(
                    "Record {i} is not a JSON object."
                )))
            }
        };
        for k in obj.keys() {
            if !index.contains_key(k) {
                index.insert(k.clone(), columns.len());
                columns.push(k.clone());
            }
        }
        objects.push(obj);
    }

    let rows = objects
        .into_iter()
        .map(|obj| {
            columns
                .iter()
                .map(|c| obj.get(c).cloned().unwrap_or(Value::Null))
                .collect()
        })
        .collect();
    Ok((columns, rows))
}

fn read_xlsx(path: &str, limit: Option<usize>) -> AppResult<(Vec<String>, Vec<Vec<Value>>)> {
    let mut wb =
        open_workbook_auto(path).map_err(|e| AppError::Validation(format!("Cannot open workbook: {e}")))?;
    let range = wb
        .worksheet_range_at(0)
        .ok_or_else(|| AppError::Validation("The workbook has no sheets.".into()))?
        .map_err(|e| AppError::Validation(format!("Cannot read sheet: {e}")))?;

    let mut iter = range.rows();
    let header = match iter.next() {
        Some(h) => h,
        None => return Ok((Vec::new(), Vec::new())),
    };
    let columns: Vec<String> = header
        .iter()
        .enumerate()
        .map(|(i, c)| match c {
            Data::Empty => format!("column_{}", i + 1),
            other => data_to_value(other)
                .as_str()
                .map(|s| s.to_string())
                .unwrap_or_else(|| data_to_value(other).to_string()),
        })
        .collect();

    let take = limit.unwrap_or(usize::MAX);
    let mut rows = Vec::new();
    for (i, row) in iter.enumerate() {
        if i >= take {
            break;
        }
        let mut values: Vec<Value> = (0..columns.len())
            .map(|j| row.get(j).map(data_to_value).unwrap_or(Value::Null))
            .collect();
        values.truncate(columns.len());
        rows.push(values);
    }
    Ok((columns, rows))
}

pub fn import_preview(path: &str) -> AppResult<ImportPreview> {
    let (columns, sample_rows) = read_table(path, Some(PREVIEW_ROWS))?;
    Ok(ImportPreview {
        columns,
        sample_rows,
    })
}

// ── Statement building ───────────────────────────────────────────────────────

struct Plan {
    sql: String,
    /// Target Postgres type per mapped column, in mapping order.
    types: Vec<String>,
    /// File column index per mapped column, in mapping order.
    file_indexes: Vec<usize>,
}

fn build_plan(
    opts: &ImportOpts,
    file_columns: &[String],
    target_types: &HashMap<String, String>,
) -> AppResult<Plan> {
    if opts.mapping.is_empty() {
        return Err(AppError::Validation("No columns mapped.".into()));
    }
    let upsert = matches!(opts.mode.as_str(), "upsertUpdate" | "upsertIgnore");
    if upsert && opts.conflict_key.is_empty() {
        return Err(AppError::Validation(
            "Upsert mode requires at least one conflict-key column.".into(),
        ));
    }

    let file_pos: HashMap<&str, usize> = file_columns
        .iter()
        .enumerate()
        .map(|(i, c)| (c.as_str(), i))
        .collect();

    let mut types = Vec::with_capacity(opts.mapping.len());
    let mut file_indexes = Vec::with_capacity(opts.mapping.len());
    let mut col_idents = Vec::with_capacity(opts.mapping.len());
    let mut placeholders = Vec::with_capacity(opts.mapping.len());

    for (i, m) in opts.mapping.iter().enumerate() {
        let ty = target_types.get(&m.column).ok_or_else(|| {
            AppError::Validation(format!("Target column '{}' does not exist.", m.column))
        })?;
        let fpos = *file_pos.get(m.file.as_str()).ok_or_else(|| {
            AppError::Validation(format!("File column '{}' not found.", m.file))
        })?;
        types.push(ty.clone());
        file_indexes.push(fpos);
        col_idents.push(quote_ident(&m.column));
        // Cast each text placeholder to the destination column's type.
        placeholders.push(format!("${}::{}", i + 1, ty));
    }

    let from = quote_qualified(&opts.schema, &opts.table);
    let mut sql = format!(
        "INSERT INTO {from} ({}) VALUES ({})",
        col_idents.join(", "),
        placeholders.join(", ")
    );

    if upsert {
        // Validate conflict-key columns exist.
        for k in &opts.conflict_key {
            if !target_types.contains_key(k) {
                return Err(AppError::Validation(format!(
                    "Conflict-key column '{k}' does not exist."
                )));
            }
        }
        let conflict = opts
            .conflict_key
            .iter()
            .map(|k| quote_ident(k))
            .collect::<Vec<_>>()
            .join(", ");

        if opts.mode == "upsertUpdate" {
            // Update every mapped column that is not part of the conflict key.
            let sets: Vec<String> = opts
                .mapping
                .iter()
                .filter(|m| !opts.conflict_key.contains(&m.column))
                .map(|m| {
                    let q = quote_ident(&m.column);
                    format!("{q} = EXCLUDED.{q}")
                })
                .collect();
            if sets.is_empty() {
                sql.push_str(&format!(" ON CONFLICT ({conflict}) DO NOTHING"));
            } else {
                sql.push_str(&format!(
                    " ON CONFLICT ({conflict}) DO UPDATE SET {}",
                    sets.join(", ")
                ));
            }
        } else {
            sql.push_str(&format!(" ON CONFLICT ({conflict}) DO NOTHING"));
        }
    }

    // (xmax = 0) is true for a freshly inserted row, false for an updated one;
    // DO NOTHING on conflict returns no row at all.
    sql.push_str(" RETURNING (xmax = 0)");

    Ok(Plan {
        sql,
        types,
        file_indexes,
    })
}

// ── Execution ────────────────────────────────────────────────────────────────

enum RowOutcome {
    Inserted,
    Updated,
    Skipped,
}

async fn insert_one(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    plan: &Plan,
    binds: &[Option<String>],
) -> AppResult<RowOutcome> {
    let mut q = sqlx::query(&plan.sql);
    for b in binds {
        q = q.bind(b.clone());
    }
    match q.fetch_optional(&mut **tx).await? {
        None => Ok(RowOutcome::Skipped),
        Some(row) => {
            let inserted: bool = row.try_get(0).unwrap_or(true);
            Ok(if inserted {
                RowOutcome::Inserted
            } else {
                RowOutcome::Updated
            })
        }
    }
}

fn emit_progress(window: &tauri::Window, processed: i64) {
    let _ = window.emit("import-progress", processed);
}

pub async fn import_data(
    window: &tauri::Window,
    pool: &PgPool,
    opts: &ImportOpts,
) -> AppResult<ImportReport> {
    let max = opts.max_bytes.unwrap_or(DEFAULT_MAX_BYTES);
    check_size(&opts.path, max)?;

    let (file_columns, rows) = read_table(&opts.path, None)?;

    let target_cols = table_columns(pool, &opts.schema, &opts.table).await?;
    let target_types: HashMap<String, String> = target_cols
        .into_iter()
        .map(|c| (c.name, c.data_type))
        .collect();

    let plan = build_plan(opts, &file_columns, &target_types)?;
    let batch_size = opts.batch_size.clamp(1, 10_000) as usize;

    let mut report = ImportReport {
        dry_run: opts.dry_run,
        ..Default::default()
    };

    let mut processed: i64 = 0;
    for chunk in rows.chunks(batch_size) {
        let mut tx = pool.begin().await?;

        for row in chunk {
            let row_no = processed + 1;
            processed += 1;

            // Coerce each mapped value to bind text; a coercion failure is a
            // per-row rejection that never touches the database.
            let mut binds: Vec<Option<String>> = Vec::with_capacity(plan.types.len());
            let mut coercion_error: Option<String> = None;
            for (k, &fidx) in plan.file_indexes.iter().enumerate() {
                let value = row.get(fidx).unwrap_or(&Value::Null);
                match value_to_bind(value, &plan.types[k]) {
                    Ok(b) => binds.push(b),
                    Err(e) => {
                        coercion_error = Some(e);
                        break;
                    }
                }
            }
            if let Some(e) = coercion_error {
                report.rejected += 1;
                push_error(&mut report, row_no, e);
                continue;
            }

            // Per-row savepoint so a bad row does not abort the whole batch.
            sqlx::query("SAVEPOINT Loupe_row").execute(&mut *tx).await?;
            match insert_one(&mut tx, &plan, &binds).await {
                Ok(RowOutcome::Inserted) => {
                    sqlx::query("RELEASE SAVEPOINT Loupe_row").execute(&mut *tx).await?;
                    report.inserted += 1;
                }
                Ok(RowOutcome::Updated) => {
                    sqlx::query("RELEASE SAVEPOINT Loupe_row").execute(&mut *tx).await?;
                    report.updated += 1;
                }
                Ok(RowOutcome::Skipped) => {
                    sqlx::query("RELEASE SAVEPOINT Loupe_row").execute(&mut *tx).await?;
                    report.skipped += 1;
                }
                Err(e) => {
                    sqlx::query("ROLLBACK TO SAVEPOINT Loupe_row")
                        .execute(&mut *tx)
                        .await?;
                    report.rejected += 1;
                    push_error(&mut report, row_no, e.to_string());
                }
            }
        }

        // All-or-nothing per batch; dry-run never commits.
        if opts.dry_run {
            tx.rollback().await?;
        } else {
            tx.commit().await?;
        }
        emit_progress(window, processed);
    }

    Ok(report)
}

fn push_error(report: &mut ImportReport, row: i64, message: String) {
    if report.errors.len() < MAX_REPORTED_ERRORS {
        report.errors.push(RowError { row, message });
    }
}
