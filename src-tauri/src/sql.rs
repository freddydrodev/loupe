//! SQL identifier quoting. App-generated SQL never interpolates raw user input
//! as identifiers — schema/table/column names always pass through here, and
//! values always travel as bound parameters.

/// Quotes a single identifier the way Postgres `quote_ident` does: wrap in
/// double quotes and double any embedded double quotes. This makes the
/// identifier safe to embed literally even if it contains spaces, keywords, or
/// quote characters.
pub fn quote_ident(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

/// Quotes a `schema.name` pair.
pub fn quote_qualified(schema: &str, name: &str) -> String {
    format!("{}.{}", quote_ident(schema), quote_ident(name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn doubles_embedded_quotes() {
        assert_eq!(quote_ident("plain"), "\"plain\"");
        assert_eq!(quote_ident("a\"b"), "\"a\"\"b\"");
        // An injection attempt is neutralized into a single (absurd) identifier.
        assert_eq!(
            quote_ident("users\"; DROP TABLE users;--"),
            "\"users\"\"; DROP TABLE users;--\""
        );
    }

    #[test]
    fn qualifies() {
        assert_eq!(quote_qualified("public", "my table"), "\"public\".\"my table\"");
    }
}
