//! Decodes a Postgres cell into a `serde_json::Value` by matching on the
//! returned column type. Unknown/unsupported types are cast to `text` upstream
//! (see `rows.rs`) so they arrive here as `TEXT` and decode as strings — the
//! decoder therefore never fails on an exotic type, it just renders text.

use bigdecimal::BigDecimal;
use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use serde_json::{Number, Value};
use sqlx::{postgres::PgRow, Row, TypeInfo, ValueRef};
use uuid::Uuid;

/// Builds a JSON number from a decimal/float string, falling back to a string
/// when the value cannot be represented as a JSON number (preserves precision).
fn number_or_string(s: String) -> Value {
    match serde_json::from_str::<Number>(&s) {
        Ok(n) => Value::Number(n),
        Err(_) => Value::String(s),
    }
}

fn float_value(x: f64) -> Value {
    Number::from_f64(x).map(Value::Number).unwrap_or(Value::Null)
}

/// Decodes the cell at column `i` of `row`.
pub fn cell_to_json(row: &PgRow, i: usize) -> Result<Value, sqlx::Error> {
    let raw = row.try_get_raw(i)?;
    if raw.is_null() {
        return Ok(Value::Null);
    }
    let type_name = raw.type_info().name().to_string();

    let value = match type_name.as_str() {
        "BOOL" => Value::Bool(row.try_get::<bool, _>(i)?),

        "INT2" => Value::Number(row.try_get::<i16, _>(i)?.into()),
        "INT4" => Value::Number(row.try_get::<i32, _>(i)?.into()),
        "INT8" => Value::Number(row.try_get::<i64, _>(i)?.into()),
        "OID" => Value::Number(row.try_get::<i64, _>(i)?.into()),

        "FLOAT4" => float_value(row.try_get::<f32, _>(i)? as f64),
        "FLOAT8" => float_value(row.try_get::<f64, _>(i)?),

        "NUMERIC" => number_or_string(row.try_get::<BigDecimal, _>(i)?.to_string()),

        "UUID" => Value::String(row.try_get::<Uuid, _>(i)?.to_string()),

        "JSON" | "JSONB" => row.try_get::<Value, _>(i)?,

        // Dates/times rendered as ISO 8601.
        "TIMESTAMPTZ" => Value::String(row.try_get::<DateTime<Utc>, _>(i)?.to_rfc3339()),
        "TIMESTAMP" => Value::String(
            row.try_get::<NaiveDateTime, _>(i)?
                .format("%Y-%m-%dT%H:%M:%S%.f")
                .to_string(),
        ),
        "DATE" => Value::String(row.try_get::<NaiveDate, _>(i)?.to_string()),
        "TIME" => Value::String(row.try_get::<NaiveTime, _>(i)?.to_string()),

        "TEXT" | "VARCHAR" | "BPCHAR" | "CHAR" | "NAME" | "CITEXT" | "UNKNOWN" => {
            Value::String(row.try_get::<String, _>(i)?)
        }

        // Anything else: best-effort string decode (it was likely cast to text).
        _ => match row.try_get::<String, _>(i) {
            Ok(s) => Value::String(s),
            Err(_) => Value::String(format!("<{}>", type_name.to_lowercase())),
        },
    };
    Ok(value)
}
