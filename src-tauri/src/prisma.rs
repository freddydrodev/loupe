//! Minimal, best-effort Prisma schema parser used purely to *enrich* relation
//! info shown before a delete. It is line-oriented (not a full PSL grammar):
//! it extracts `model` blocks, `@@map`/`@map` name mappings, and `@relation`
//! `fields`/`onDelete`. Anything it doesn't understand is ignored, and a parse
//! failure never blocks editing — relation info simply falls back to DB-only.

use crate::introspect::ReferencingConstraint;
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct PrismaRelation {
    /// Scalar field names listed in `@relation(fields: [...])`.
    pub local_fields: Vec<String>,
    /// `onDelete` action as written in the schema (e.g. "Cascade"), if present.
    pub on_delete: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct PrismaModel {
    pub model: String,
    /// `@@map` value, or the model name when no `@@map` is present.
    pub table: String,
    /// field name -> column name (`@map`); identity when unmapped.
    pub field_to_column: HashMap<String, String>,
    pub relations: Vec<PrismaRelation>,
}

fn capture_quoted(line: &str, attr: &str) -> Option<String> {
    // Finds `attr("value")` and returns "value".
    let idx = line.find(attr)?;
    let rest = &line[idx + attr.len()..];
    let open = rest.find('"')?;
    let after = &rest[open + 1..];
    let close = after.find('"')?;
    Some(after[..close].to_string())
}

fn capture_bracket_list(line: &str, key: &str) -> Vec<String> {
    // Finds `key: [a, b]` and returns [a, b] (quotes stripped, trimmed).
    let Some(idx) = line.find(key) else {
        return Vec::new();
    };
    let rest = &line[idx + key.len()..];
    let Some(open) = rest.find('[') else {
        return Vec::new();
    };
    let after = &rest[open + 1..];
    let Some(close) = after.find(']') else {
        return Vec::new();
    };
    after[..close]
        .split(',')
        .map(|s| s.trim().trim_matches('"').to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

fn capture_on_delete(line: &str) -> Option<String> {
    let idx = line.find("onDelete:")?;
    let rest = line[idx + "onDelete:".len()..].trim_start();
    let token: String = rest
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric())
        .collect();
    if token.is_empty() {
        None
    } else {
        Some(token)
    }
}

/// Parses the text of a Prisma schema into its model definitions. Best-effort.
pub fn parse_schema(text: &str) -> Vec<PrismaModel> {
    let mut models: Vec<PrismaModel> = Vec::new();
    let mut current: Option<PrismaModel> = None;

    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with("//") {
            continue;
        }

        if current.is_none() {
            // Look for the start of a model block: `model Name {`.
            if let Some(rest) = line.strip_prefix("model ") {
                let name: String = rest
                    .trim()
                    .chars()
                    .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                    .collect();
                if !name.is_empty() {
                    current = Some(PrismaModel {
                        table: name.clone(),
                        model: name,
                        ..Default::default()
                    });
                }
            }
            continue;
        }

        let model = current.as_mut().unwrap();

        if line.starts_with('}') {
            models.push(current.take().unwrap());
            continue;
        }

        if line.starts_with("@@map") {
            if let Some(t) = capture_quoted(line, "@@map") {
                model.table = t;
            }
            continue;
        }
        // Block-level attributes other than @@map are ignored.
        if line.starts_with("@@") {
            continue;
        }

        // Field line: `<field> <Type> <attrs...>`.
        let mut it = line.split_whitespace();
        let Some(field) = it.next() else { continue };
        if !field.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            continue;
        }
        // Skip the type token; attributes (if any) live in the remainder.
        let _ty = it.next();

        if let Some(col) = capture_quoted(line, "@map") {
            model.field_to_column.insert(field.to_string(), col);
        }

        if line.contains("@relation") {
            let local_fields = capture_bracket_list(line, "fields:");
            if !local_fields.is_empty() {
                model.relations.push(PrismaRelation {
                    local_fields,
                    on_delete: capture_on_delete(line),
                });
            }
        }
    }
    // Tolerate a missing closing brace at EOF.
    if let Some(m) = current.take() {
        models.push(m);
    }
    models
}

/// Reads and parses the schema at `path`, returning `None` on any I/O or parse
/// problem (enrichment is strictly optional).
pub fn load_models(path: &str) -> Option<Vec<PrismaModel>> {
    let text = std::fs::read_to_string(path).ok()?;
    let models = parse_schema(&text);
    if models.is_empty() {
        None
    } else {
        Some(models)
    }
}

/// Annotates DB-derived referencing constraints with the Prisma model name and
/// the schema-declared `onDelete`, matched by referencing table + columns.
pub fn enrich_referencing(refs: &mut [ReferencingConstraint], path: &str) {
    let Some(models) = load_models(path) else {
        return;
    };
    // Index models by their mapped table name.
    let by_table: HashMap<&str, &PrismaModel> =
        models.iter().map(|m| (m.table.as_str(), m)).collect();

    for c in refs.iter_mut() {
        let Some(model) = by_table.get(c.referencing_table.as_str()) else {
            continue;
        };
        c.prisma_model = Some(model.model.clone());

        // Map each relation's local fields to their column names, then match the
        // set against the constraint's referencing columns.
        let want: std::collections::HashSet<&str> =
            c.referencing_columns.iter().map(|s| s.as_str()).collect();
        for rel in &model.relations {
            let cols: std::collections::HashSet<String> = rel
                .local_fields
                .iter()
                .map(|f| model.field_to_column.get(f).cloned().unwrap_or_else(|| f.clone()))
                .collect();
            if cols.len() == want.len() && cols.iter().all(|c| want.contains(c.as_str())) {
                c.prisma_on_delete = rel.on_delete.clone();
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCHEMA: &str = r#"
        model User {
          id    Int    @id @default(autoincrement())
          email String @unique
          posts Post[]
          @@map("users")
        }

        model Post {
          id       Int  @id
          title    String
          authorId Int  @map("author_id")
          author   User @relation(fields: [authorId], references: [id], onDelete: Cascade)
          @@map("posts")
        }
    "#;

    #[test]
    fn parses_map_and_relation() {
        let models = parse_schema(SCHEMA);
        assert_eq!(models.len(), 2);
        let post = models.iter().find(|m| m.model == "Post").unwrap();
        assert_eq!(post.table, "posts");
        assert_eq!(post.field_to_column.get("authorId").unwrap(), "author_id");
        assert_eq!(post.relations.len(), 1);
        assert_eq!(post.relations[0].local_fields, vec!["authorId"]);
        assert_eq!(post.relations[0].on_delete.as_deref(), Some("Cascade"));
    }

    #[test]
    fn enriches_matching_constraint() {
        let models = parse_schema(SCHEMA);
        // Build the index inline to test the matching logic.
        let post = models.iter().find(|m| m.model == "Post").unwrap();
        // The FK column on posts is author_id (mapped from authorId).
        let cols: std::collections::HashSet<String> = post.relations[0]
            .local_fields
            .iter()
            .map(|f| post.field_to_column.get(f).cloned().unwrap())
            .collect();
        assert!(cols.contains("author_id"));
    }

    #[test]
    fn tolerates_garbage() {
        let models = parse_schema("not a schema at all\n}{}{");
        assert!(models.is_empty() || models.iter().all(|m| m.relations.is_empty()));
    }
}
