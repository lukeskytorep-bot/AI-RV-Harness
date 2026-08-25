use serde::Deserialize;
use serde_json::Value as JsonValue;
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

const DATABASE_URL: &str = "sqlite:rv_harness.db";
const MAX_TRANSACTION_STATEMENTS: usize = 5_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseTransactionStatement {
    query: String,
    #[serde(default)]
    values: Vec<JsonValue>,
}

#[tauri::command]
pub async fn database_execute_transaction(
    db_instances: State<'_, DbInstances>,
    statements: Vec<DatabaseTransactionStatement>,
) -> Result<Vec<u64>, String> {
    if statements.is_empty() {
        return Ok(Vec::new());
    }
    if statements.len() > MAX_TRANSACTION_STATEMENTS {
        return Err("database transaction contains too many statements".to_string());
    }
    if statements.iter().any(|statement| statement.query.trim().is_empty()) {
        return Err("database transaction contains an empty statement".to_string());
    }

    let instances = db_instances.0.read().await;
    let pool = match instances.get(DATABASE_URL) {
        Some(DbPool::Sqlite(pool)) => pool,
        None => return Err("RV Harness database is not loaded".to_string()),
    };
    let mut transaction = pool.begin().await.map_err(|error| error.to_string())?;
    let mut rows_affected = Vec::with_capacity(statements.len());

    for statement in statements {
        let mut query = sqlx::query(&statement.query);
        for value in statement.values {
            query = match value {
                JsonValue::Null => query.bind(Option::<String>::None),
                JsonValue::Bool(value) => query.bind(value),
                JsonValue::Number(value) => {
                    if let Some(value) = value.as_i64() {
                        query.bind(value)
                    } else if let Some(value) = value.as_u64() {
                        if value <= i64::MAX as u64 {
                            query.bind(value as i64)
                        } else {
                            query.bind(value as f64)
                        }
                    } else {
                        query.bind(value.as_f64().unwrap_or_default())
                    }
                }
                JsonValue::String(value) => query.bind(value),
                structured @ (JsonValue::Array(_) | JsonValue::Object(_)) => query.bind(structured.to_string()),
            };
        }
        let result = match query.execute(&mut *transaction).await {
            Ok(result) => result,
            Err(error) => {
                let message = error.to_string();
                transaction
                    .rollback()
                    .await
                    .map_err(|rollback_error| format!("{message}; rollback failed: {rollback_error}"))?;
                return Err(message);
            }
        };
        rows_affected.push(result.rows_affected());
    }

    transaction.commit().await.map_err(|error| error.to_string())?;
    Ok(rows_affected)
}
