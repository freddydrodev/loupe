//! Server-side paginated table browsing.
//!
//! Identifiers (schema, table, sort column) are quoted via `sql::quote_ident`
//! and the sort column is validated against the real column set, so a column or
//! table name can never inject SQL. Values flow only through bound parameters.
//! Types Loupe cannot decode natively are cast to `text` in the SELECT list so
//! decoding never fails.

use crate::cell::cell_to_json;
use crate::error::{AppError, AppResult};
use crate::introspect::{table_columns, ColumnInfo};
use crate::sql::{quote_ident, quote_qualified};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{PgPool, Row};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SortSpec {
    pub column: String,
    #[serde(default)]
    pub descending: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetRowsOpts {
    /// Raw boolean WHERE expression authored by the user (their own database).
    #[serde(default)]
    pub filter: Option<String>,
    #[serde(default)]
    pub sort: Option<SortSpec>,
    pub limit: i64,
    pub offset: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RowColumn {
    pub name: String,
    pub data_type: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RowsResult {
    pub columns: Vec<RowColumn>,
    pub rows: Vec<Vec<Value>>,
    pub total: i64,
}

/// Returns true for types Loupe does not decode directly; these are cast to
/// `text` in the SELECT so they still render (arrays, enums, interval, inet…).
fn needs_text_cast(data_type: &str) -> bool {
    let mut t = data_type.trim().to_lowercase();
    if t.ends_with("[]") {
        return true; // arrays render as their text form
    }
    if let Some(p) = t.find('(') {
        t.truncate(p);
    }
    let t = t.trim();
    !matches!(
        t,
        "smallint"
            | "integer"
            | "bigint"
            | "real"
            | "double precision"
            | "numeric"
            | "decimal"
            | "boolean"
            | "text"
            | "character varying"
            | "character"
            | "char"
            | "\"char\""
            | "name"
            | "citext"
            | "uuid"
            | "json"
            | "jsonb"
            | "timestamp with time zone"
            | "timestamp without time zone"
            | "date"
            | "time without time zone"
    )
}

/// Builds the SELECT projection, casting non-native types to text.
pub(crate) fn projection(columns: &[ColumnInfo]) -> String {
    columns
        .iter()
        .map(|c| {
            let q = quote_ident(&c.name);
            if needs_text_cast(&c.data_type) {
                format!("{q}::text AS {q}")
            } else {
                q
            }
        })
        .collect::<Vec<_>>()
        .join(", ")
}

/// Builds the WHERE clause from the optional user filter.
pub(crate) fn where_clause(filter: &Option<String>) -> String {
    match filter {
        Some(f) if !f.trim().is_empty() => format!(" WHERE ({})", f.trim()),
        _ => String::new(),
    }
}

/// Builds a validated ORDER BY clause; the column must belong to the relation.
pub(crate) fn order_clause(columns: &[ColumnInfo], sort: &Option<SortSpec>) -> AppResult<String> {
    match sort {
        Some(s) => {
            if !columns.iter().any(|c| c.name == s.column) {
                return Err(AppError::Validation(format!(
                    "Unknown sort column: {}",
                    s.column
                )));
            }
            let dir = if s.descending { "DESC" } else { "ASC" };
            Ok(format!(" ORDER BY {} {dir}", quote_ident(&s.column)))
        }
        None => Ok(String::new()),
    }
}

pub async fn get_rows(
    pool: &PgPool,
    schema: &str,
    table: &str,
    opts: &GetRowsOpts,
) -> AppResult<RowsResult> {
    let columns = table_columns(pool, schema, table).await?;
    if columns.is_empty() {
        return Err(AppError::Validation(format!(
            "Relation {schema}.{table} has no readable columns."
        )));
    }

    let from = quote_qualified(schema, table);
    let where_sql = where_clause(&opts.filter);
    let order_sql = order_clause(&columns, &opts.sort)?;

    let limit = opts.limit.clamp(0, 100_000);
    let offset = opts.offset.max(0);

    // Total count honoring the filter (mapped so a bad filter is a clear error).
    let count_sql = format!("SELECT count(*) AS n FROM {from}{where_sql}");
    let total: i64 = sqlx::query(&count_sql)
        .fetch_one(pool)
        .await
        .map_err(map_query_error)?
        .get("n");

    let data_sql = format!(
        "SELECT {} FROM {from}{where_sql}{order_sql} LIMIT $1 OFFSET $2",
        projection(&columns)
    );
    let pg_rows = sqlx::query(&data_sql)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await
        .map_err(map_query_error)?;

    let mut rows = Vec::with_capacity(pg_rows.len());
    for row in &pg_rows {
        let mut cells = Vec::with_capacity(columns.len());
        for i in 0..columns.len() {
            cells.push(cell_to_json(row, i)?);
        }
        rows.push(cells);
    }

    Ok(RowsResult {
        columns: columns
            .into_iter()
            .map(|c| RowColumn {
                name: c.name,
                data_type: c.data_type,
            })
            .collect(),
        rows,
        total,
    })
}

/// Surfaces the user's filter mistakes as plain validation errors.
fn map_query_error(e: sqlx::Error) -> AppError {
    AppError::Db(e.to_string())
}
