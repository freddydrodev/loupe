//! Streaming export to JSON or XLSX.
//!
//! Rows are pulled from the server with a streaming cursor (`fetch`) so the full
//! result set is never materialized in Rust. JSON is written incrementally to
//! disk. XLSX is assembled by `rust_xlsxwriter` (which builds the workbook in
//! memory by design), but the database read remains streamed either way.
//! Progress is emitted to the window as `export-progress` events.

use crate::cell::cell_to_json;
use crate::error::{AppError, AppResult};
use crate::introspect::table_columns;
use crate::rows::{order_clause, projection, where_clause, SortSpec};
use crate::sql::quote_qualified;
use futures::TryStreamExt;
use rust_xlsxwriter::{Format, Workbook};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::{postgres::PgRow, Column, PgPool, Row};
use std::fs::File;
use std::io::{BufWriter, Write};
use tauri::Emitter;

const PROGRESS_EVERY: i64 = 500;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOpts {
    /// "table" or "query".
    pub source: String,
    /// "json" or "xlsx".
    pub format: String,
    pub path: String,
    // table source
    pub schema: Option<String>,
    pub table: Option<String>,
    pub filter: Option<String>,
    pub sort: Option<SortSpec>,
    // query source
    pub sql: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub rows: i64,
    pub path: String,
}

/// Builds the SELECT statement and any pre-known headers for the export source.
async fn resolve_sql(pool: &PgPool, opts: &ExportOpts) -> AppResult<(String, Vec<String>)> {
    match opts.source.as_str() {
        "table" => {
            let schema = opts
                .schema
                .as_deref()
                .ok_or_else(|| AppError::Validation("Missing schema for table export.".into()))?;
            let table = opts
                .table
                .as_deref()
                .ok_or_else(|| AppError::Validation("Missing table for table export.".into()))?;
            let columns = table_columns(pool, schema, table).await?;
            if columns.is_empty() {
                return Err(AppError::Validation(format!(
                    "Relation {schema}.{table} has no readable columns."
                )));
            }
            let from = quote_qualified(schema, table);
            let sql = format!(
                "SELECT {} FROM {from}{}{}",
                projection(&columns),
                where_clause(&opts.filter),
                order_clause(&columns, &opts.sort)?
            );
            let headers = columns.into_iter().map(|c| c.name).collect();
            Ok((sql, headers))
        }
        "query" => {
            let sql = opts
                .sql
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| AppError::Validation("Missing SQL for query export.".into()))?
                .to_string();
            Ok((sql, Vec::new()))
        }
        other => Err(AppError::Validation(format!("Unknown export source: {other}"))),
    }
}

fn emit_progress(window: &tauri::Window, count: i64) {
    let _ = window.emit("export-progress", count);
}

fn header_names(row: &PgRow) -> Vec<String> {
    row.columns().iter().map(|c| c.name().to_string()).collect()
}

pub async fn export_data(
    window: &tauri::Window,
    pool: &PgPool,
    opts: &ExportOpts,
) -> AppResult<ExportResult> {
    let (sql, known_headers) = resolve_sql(pool, opts).await?;
    let rows = match opts.format.as_str() {
        "json" => export_json(window, pool, &sql, &opts.path).await?,
        "xlsx" => export_xlsx(window, pool, &sql, &known_headers, &opts.path).await?,
        other => return Err(AppError::Validation(format!("Unknown export format: {other}"))),
    };
    emit_progress(window, rows);
    Ok(ExportResult {
        rows,
        path: opts.path.clone(),
    })
}

/// Streams a JSON array of objects to `path`, one object per row.
async fn export_json(
    window: &tauri::Window,
    pool: &PgPool,
    sql: &str,
    path: &str,
) -> AppResult<i64> {
    let file = File::create(path)?;
    let mut w = BufWriter::new(file);
    w.write_all(b"[")?;

    let mut headers: Vec<String> = Vec::new();
    let mut count: i64 = 0;
    let mut stream = sqlx::query(sql).fetch(pool);

    while let Some(row) = stream.try_next().await? {
        if count == 0 {
            headers = header_names(&row);
        }
        let mut obj = Map::with_capacity(headers.len());
        for (i, name) in headers.iter().enumerate() {
            obj.insert(name.clone(), cell_to_json(&row, i)?);
        }
        if count > 0 {
            w.write_all(b",")?;
        }
        serde_json::to_writer(&mut w, &Value::Object(obj))?;
        count += 1;
        if count % PROGRESS_EVERY == 0 {
            emit_progress(window, count);
        }
    }

    w.write_all(b"]")?;
    w.flush()?;
    Ok(count)
}

/// Writes one worksheet with a bold header row, typing numbers/booleans natively.
async fn export_xlsx(
    window: &tauri::Window,
    pool: &PgPool,
    sql: &str,
    known_headers: &[String],
    path: &str,
) -> AppResult<i64> {
    let mut workbook = Workbook::new();
    let sheet = workbook.add_worksheet();
    let bold = Format::new().set_bold();

    let mut headers: Vec<String> = Vec::new();
    let mut count: i64 = 0;
    let mut stream = sqlx::query(sql).fetch(pool);

    while let Some(row) = stream.try_next().await? {
        if count == 0 {
            headers = header_names(&row);
            write_header(sheet, &headers, &bold)?;
        }
        let excel_row = (count + 1) as u32; // row 0 is the header
        for (i, _name) in headers.iter().enumerate() {
            let value = cell_to_json(&row, i)?;
            write_xlsx_cell(sheet, excel_row, i as u16, &value)?;
        }
        count += 1;
        if count % PROGRESS_EVERY == 0 {
            emit_progress(window, count);
        }
    }

    // Zero-row table export still gets its header row.
    if count == 0 && !known_headers.is_empty() {
        write_header(sheet, known_headers, &bold)?;
    }

    workbook
        .save(path)
        .map_err(|e| AppError::Store(format!("Could not write spreadsheet: {e}")))?;
    Ok(count)
}

fn write_header(
    sheet: &mut rust_xlsxwriter::Worksheet,
    headers: &[String],
    bold: &Format,
) -> AppResult<()> {
    for (i, name) in headers.iter().enumerate() {
        sheet
            .write_string_with_format(0, i as u16, name, bold)
            .map_err(xlsx_err)?;
    }
    Ok(())
}

fn write_xlsx_cell(
    sheet: &mut rust_xlsxwriter::Worksheet,
    row: u32,
    col: u16,
    value: &Value,
) -> AppResult<()> {
    match value {
        Value::Null => Ok(()), // leave the cell blank
        Value::Bool(b) => sheet.write_boolean(row, col, *b).map(|_| ()).map_err(xlsx_err),
        Value::Number(n) => match n.as_f64() {
            Some(f) => sheet.write_number(row, col, f).map(|_| ()).map_err(xlsx_err),
            None => sheet
                .write_string(row, col, &n.to_string())
                .map(|_| ())
                .map_err(xlsx_err),
        },
        Value::String(s) => sheet.write_string(row, col, s).map(|_| ()).map_err(xlsx_err),
        // Nested json/arrays are serialized compactly.
        other => sheet
            .write_string(row, col, &other.to_string())
            .map(|_| ())
            .map_err(xlsx_err),
    }
}

fn xlsx_err(e: rust_xlsxwriter::XlsxError) -> AppError {
    AppError::Store(format!("Spreadsheet write error: {e}"))
}
