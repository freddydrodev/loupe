//! JSON → bound-parameter coercion shared by the import and mutate paths.
//!
//! A JSON value becomes the **text** to bind to a `$n::<type>` placeholder: the
//! SQL always casts the placeholder to the destination column's type, so a text
//! representation (the form the grid round-trips for arrays/enums/etc.) is
//! re-parsed correctly by Postgres. Values never reach SQL except as bound
//! parameters; identifiers are quoted separately (see `sql.rs`).

use serde_json::Value;

/// Quotes a string element for a Postgres array literal.
fn quote_array_elem(s: &str) -> String {
    let escaped = s.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

/// Renders a JSON array as a Postgres array literal (e.g. `{"a","b,c",1}`).
pub(crate) fn json_array_to_pg_literal(arr: &[Value]) -> Result<String, String> {
    let mut parts = Vec::with_capacity(arr.len());
    for v in arr {
        let part = match v {
            Value::Null => "NULL".to_string(),
            Value::Bool(b) => b.to_string(),
            Value::Number(n) => n.to_string(),
            Value::String(s) => quote_array_elem(s),
            Value::Array(inner) => json_array_to_pg_literal(inner)?,
            Value::Object(_) => return Err("nested object in array".into()),
        };
        parts.push(part);
    }
    Ok(format!("{{{}}}", parts.join(",")))
}

/// Produces the text to bind for `value` targeting a column of `pg_type`, or a
/// rejection reason. `None` means SQL NULL. The caller's SQL casts the
/// placeholder to `pg_type`.
pub(crate) fn value_to_bind(value: &Value, pg_type: &str) -> Result<Option<String>, String> {
    let lower = pg_type.trim().to_lowercase();
    let is_array = lower.ends_with("[]");
    let is_json = lower == "json" || lower == "jsonb";
    match value {
        Value::Null => Ok(None),
        Value::Bool(b) => Ok(Some(b.to_string())),
        Value::Number(n) => Ok(Some(n.to_string())),
        Value::String(s) => Ok(Some(s.clone())),
        Value::Array(arr) => {
            if is_json {
                Ok(Some(value.to_string()))
            } else if is_array {
                json_array_to_pg_literal(arr).map(Some)
            } else {
                Err(format!("cannot map a JSON array into column type {pg_type}"))
            }
        }
        Value::Object(_) => {
            if is_json {
                Ok(Some(value.to_string()))
            } else {
                Err(format!("cannot map a JSON object into column type {pg_type}"))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn scalars_bind_as_text() {
        assert_eq!(value_to_bind(&json!(42), "integer").unwrap(), Some("42".into()));
        assert_eq!(value_to_bind(&json!(true), "boolean").unwrap(), Some("true".into()));
        assert_eq!(value_to_bind(&Value::Null, "text").unwrap(), None);
        assert_eq!(value_to_bind(&json!("hi"), "text").unwrap(), Some("hi".into()));
    }

    #[test]
    fn json_array_becomes_pg_literal() {
        let v = json!(["a", "b,c", 1]);
        assert_eq!(
            value_to_bind(&v, "text[]").unwrap(),
            Some("{\"a\",\"b,c\",1}".into())
        );
    }

    #[test]
    fn object_into_jsonb_is_text() {
        let v = json!({"k": 1});
        let bound = value_to_bind(&v, "jsonb").unwrap().unwrap();
        assert!(bound.contains("\"k\""));
    }

    #[test]
    fn array_into_scalar_column_is_rejected() {
        assert!(value_to_bind(&json!([1, 2]), "integer").is_err());
    }
}
