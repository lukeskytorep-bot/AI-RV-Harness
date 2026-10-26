//! Isolated, versioned evaluation records. Source sessions and the original End
//! marker are never writable through this operation. The enclosing workflow
//! transaction supplies the original project's exclusive lease.
use serde_json::Value;
use sqlx::{Sqlite, Transaction};
use std::collections::HashSet;

pub(crate) const PREFIX: &str = "rvh.research.evaluation.v1:";

pub(crate) fn validate_update(previous: Option<&Value>, next: &Value, expected: i64) -> Result<(), String> {
    let fail = || "Invalid or conflicting Research evaluation record".to_string();
    let sources = next["sources"].as_array().ok_or_else(fail)?;
    let judges = next["judges"].as_array().ok_or_else(fail)?;
    let events = next["events"].as_array().ok_or_else(fail)?;
    let scores = next["scores"].as_object().ok_or_else(fail)?;
    let status = next["status"].as_str().ok_or_else(fail)?;
    if expected < 0 || next["schemaVersion"] != 1 || next["revision"].as_i64() != expected.checked_add(1)
        || next["id"].as_str().is_none_or(str::is_empty) || next["projectId"].as_str().is_none_or(str::is_empty)
        || !["en", "pl"].contains(&next["language"].as_str().unwrap_or(""))
        || !["default", "training_reveal", "legacy_analytical", "frozen_analytical_v1"].contains(&next["budgetPolicy"].as_str().unwrap_or(""))
        || !["Ready", "Running", "Incomplete", "Complete"].contains(&status)
        || sources.is_empty() || judges.is_empty() || judges.len() > 3 {
        return Err(fail());
    }
    for judge in judges {
        if judge["providerConfig"]["id"].as_str().is_none_or(str::is_empty) || judge["model"]["route"].as_str().is_none_or(str::is_empty) { return Err(fail()); }
    }
    let mut source_ids = HashSet::new();
    for source in sources {
        let id = source["sessionId"].as_str().ok_or_else(fail)?;
        let anonymous = source["anonymousSessionId"].as_str().ok_or_else(fail)?;
        let hash = source["sourceSha256"].as_str().ok_or_else(fail)?;
        if id.is_empty() || !source_ids.insert(id) || !anonymous.starts_with("BlindSession_")
            || hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) { return Err(fail()); }
    }
    if let Some(old) = previous {
        if old["revision"].as_i64() != Some(expected) || old["status"] == "Complete" { return Err(fail()); }
        for field in ["schemaVersion", "id", "projectId", "createdAt", "language", "timeoutMs", "budgetPolicy", "judges", "sources"] {
            if old[field] != next[field] { return Err("Frozen Research evaluation design changed".into()); }
        }
        let old_events = old["events"].as_array().ok_or_else(fail)?;
        if !events.starts_with(old_events) { return Err("Research evaluation journal cannot be rewritten".into()); }
        for (id, old_scores) in old["scores"].as_object().ok_or_else(fail)? {
            let candidates = scores.get(id).and_then(Value::as_array).ok_or_else(fail)?;
            if old_scores.as_array().ok_or_else(fail)?.iter().any(|score| !candidates.contains(score)) {
                return Err("Frozen Research evaluation score cannot be replaced".into());
            }
        }
    } else if expected != 0 || status != "Ready" || !events.is_empty() || !scores.is_empty() { return Err(fail()); }
    let mut event_ids = HashSet::new();
    for event in events {
        if !source_ids.contains(event["sessionId"].as_str().ok_or_else(fail)?)
            || !event_ids.insert(event["id"].as_str().ok_or_else(fail)?) { return Err(fail()); }
    }
    for (id, values) in scores {
        if !source_ids.contains(id.as_str()) { return Err(fail()); }
        let mut indexes = HashSet::new();
        for score in values.as_array().ok_or_else(fail)? {
            let index = score["judgeIndex"].as_u64().ok_or_else(fail)? as usize;
            if index == 0 || index > judges.len() || !indexes.insert(index)
                || score["modelRoute"] != judges[index-1]["model"]["route"]
                || score["frozenAt"].as_str().is_none_or(str::is_empty) { return Err(fail()); }
            let mut total = 0.0;
            for (field, maximum) in [("gestalt",3.0),("verifiableFeatures",3.0),("activityFunctionEvent",2.0),("confabulationControl",2.0)] {
                let n = score[field].as_f64().ok_or_else(fail)?;
                if !n.is_finite() || n < 0.0 || n > maximum || (n*10.0).round() != n*10.0 { return Err(fail()); }
                total += n;
            }
            if score["total"].as_f64() != Some((total*10.0).round()/10.0) { return Err(fail()); }
        }
    }
    if status == "Complete" && source_ids.iter().any(|id| scores.get(*id).and_then(Value::as_array).is_none_or(|v|v.len()!=judges.len())) { return Err(fail()); }
    Ok(())
}

pub(crate) async fn save(tx: &mut Transaction<'_, Sqlite>, project_id: &str, next: Value, expected: i64) -> Result<Value, String> {
    if next["projectId"] != project_id { return Err("Research evaluation scope mismatch".into()); }
    let id = next["id"].as_str().ok_or("Missing Research evaluation id")?;
    if id.is_empty() || id.len() > 100 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b==b'_' || b==b'-') {return Err("Invalid Research evaluation id".into());}
    let key = format!("{PREFIX}{project_id}:{id}");
    let old: Option<String> = sqlx::query_scalar("SELECT value FROM app_settings WHERE key=$1").bind(&key).fetch_optional(&mut **tx).await.map_err(|e|e.to_string())?;
    let old_value = old.as_deref().map(serde_json::from_str::<Value>).transpose().map_err(|e|e.to_string())?;
    validate_update(old_value.as_ref(), &next, expected)?;
    if old.is_none() {
        for source in next["sources"].as_array().ok_or("Missing evaluation sources")? {
            let valid: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM rv_sessions s JOIN reveals r ON r.session_id=s.id WHERE s.id=$1 AND s.research_project_id=$2 AND s.pre_reveal_sealed_at IS NOT NULL AND s.pre_reveal_hash IS NOT NULL AND s.archived_at IS NULL")
                .bind(source["sessionId"].as_str().ok_or("Invalid source id")?).bind(project_id).fetch_one(&mut **tx).await.map_err(|e|e.to_string())?;
            if valid != 1 {return Err("Research evaluation requires preserved sealed sessions with Reveal".into());}
        }
    }
    sqlx::query("INSERT INTO app_settings(key,value,updated_at) VALUES($1,$2,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
        .bind(&key).bind(next.to_string()).execute(&mut **tx).await.map_err(|e|e.to_string())?;
    Ok(serde_json::json!(true))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn record() -> Value {
        json!({"schemaVersion":1,"id":"panel","projectId":"r","revision":1,"createdAt":"t","language":"en","budgetPolicy":"default","status":"Ready","judges":[{"providerConfig":{"id":"pc"},"model":{"route":"route"}}],"sources":[{"sessionId":"s","anonymousSessionId":"BlindSession_ABCDEF12","sourceSha256":"a".repeat(64)}],"scores":{},"events":[]})
    }
    #[test]
    fn rejects_revision_design_and_journal_rewrites() {
        let first=record();assert!(validate_update(None,&first,0).is_ok());
        let mut next=first.clone();next["revision"]=json!(2);next["status"]=json!("Running");assert!(validate_update(Some(&first),&next,1).is_ok());
        assert!(validate_update(Some(&first),&next,0).is_err());
        let mut changed=next.clone();changed["judges"][0]["model"]["route"]=json!("other");assert!(validate_update(Some(&first),&changed,1).is_err());
        let mut with_event=next.clone();with_event["events"]=json!([{"id":"e","sessionId":"s"}]);
        let mut erased=with_event.clone();erased["revision"]=json!(3);erased["events"]=json!([]);assert!(validate_update(Some(&with_event),&erased,2).is_err());
    }
    #[test]
    fn rejects_missing_duplicate_and_overwritten_scores() {
        let first=record();let mut next=first.clone();next["revision"]=json!(2);next["status"]=json!("Complete");assert!(validate_update(Some(&first),&next,1).is_err());
        let score=json!({"judgeIndex":1,"modelRoute":"route","frozenAt":"t","total":6.0,"gestalt":2.0,"verifiableFeatures":2.0,"activityFunctionEvent":1.0,"confabulationControl":1.0});
        next["scores"]=json!({"s":[score]});assert!(validate_update(Some(&first),&next,1).is_ok());
        let mut changed=next.clone();changed["revision"]=json!(3);assert!(validate_update(Some(&next),&changed,2).is_err());
        changed["status"]=json!("Incomplete");changed["scores"]["s"][0]["total"]=json!(7);let mut old=next.clone();old["status"]=json!("Incomplete");assert!(validate_update(Some(&old),&changed,2).is_err());
    }
}
