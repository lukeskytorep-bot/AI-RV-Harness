//! DIRECT-3C1: draft wire/response contract only. This module never dispatches HTTP.
use crate::native_connection_identity::Binding;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const MAX_SAFE_INTEGER:u64=9_007_199_254_740_991;
pub const MAX_BODY_BYTES:usize=16*1024*1024;
#[derive(Clone,Default,Debug,PartialEq,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Settings {
    #[serde(skip_serializing_if="Option::is_none")] pub num_ctx:Option<u64>,
    #[serde(skip_serializing_if="Option::is_none")] pub temperature:Option<f64>,
    #[serde(skip_serializing_if="Option::is_none")] pub top_p:Option<f64>,
    #[serde(skip_serializing_if="Option::is_none")] pub top_k:Option<u64>,
    #[serde(skip_serializing_if="Option::is_none")] pub seed:Option<u64>,
}
impl Settings {
    pub fn validate(&self)->Result<(),String>{
        if self.num_ctx.is_some_and(|n|n==0||n>MAX_SAFE_INTEGER) || self.top_k.is_some_and(|n|n>MAX_SAFE_INTEGER) || self.seed.is_some_and(|n|n>MAX_SAFE_INTEGER)
            || self.temperature.is_some_and(|n|!n.is_finite()||!(0.0..=2.0).contains(&n)) || self.top_p.is_some_and(|n|!n.is_finite()||!(0.0..=1.0).contains(&n)) {return Err("Invalid native generation settings".into());}
        Ok(())
    }
}
#[derive(Clone,Debug,PartialEq,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Provenance {pub server_version:String,pub model:String,pub digest:String,pub metadata_sha256:String}
impl Provenance {
    pub fn validate(&self)->Result<(),String>{
        if [&self.server_version,&self.model,&self.digest].iter().any(|s|s.trim().is_empty()||s.len()>512||s.chars().any(char::is_control))
            || self.model.chars().any(char::is_whitespace) || self.metadata_sha256.len()!=64 || !self.metadata_sha256.bytes().all(|c|c.is_ascii_hexdigit()) {return Err("Native model provenance is incomplete".into());}Ok(())
    }
}
#[derive(Clone,Debug,PartialEq,Serialize,Deserialize)]
#[serde(rename_all="snake_case")]
pub enum Role {Viewer,Monitor,Judge,Learning,PostReveal,Conversation,TelepathicParticipant,TelepathicFacilitator}
#[derive(Clone,Debug,PartialEq,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Snapshot {
    pub version:u8,pub connection:Binding,pub provenance:Provenance,pub settings:Settings,
    pub role:Role,pub max_output_tokens:u64,
}
impl Snapshot {
    pub fn validate(&self)->Result<(),String>{
        if self.version!=1 || self.connection.version!=1 || self.connection.provider!="ollama_native" || self.connection.provider_config_id.is_empty() || self.connection.connection_identity_id.is_empty() || self.connection.connection_revision==0 || self.connection.connection_revision>MAX_SAFE_INTEGER
            || !matches!(self.connection.auth_mode.as_str(),"none"|"bearer") || crate::native_connection_identity::normalize_endpoint(&self.connection.normalized_endpoint)?!=self.connection.normalized_endpoint
            || self.max_output_tokens==0 || self.max_output_tokens>MAX_SAFE_INTEGER {return Err("Invalid native generation snapshot".into());}
        self.settings.validate()?;self.provenance.validate()
    }
    pub fn assert_current(&self,binding:&Binding,provenance:&Provenance)->Result<(),String>{
        self.validate()?;provenance.validate()?;
        if &self.connection!=binding || &self.provenance!=provenance {return Err("Native connection or model provenance changed; frozen run is incompatible".into());}Ok(())
    }
}
#[derive(Clone,Debug,PartialEq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Message {pub role:String,pub content:String}
/// Preview/test builder. The result is not authorization to send it to a server.
pub fn draft_non_stream_request(snapshot:&Snapshot,messages:&[Message])->Result<Value,String>{
    snapshot.validate()?;
    if messages.is_empty() || messages.iter().any(|m|!matches!(m.role.as_str(),"system"|"user"|"assistant")) || messages.last().is_none_or(|m|m.role!="user") {return Err("Native history must contain ordered text messages ending with user".into());}
    let mut options=json!({"num_predict":snapshot.max_output_tokens});
    if let Some(v)=snapshot.settings.num_ctx{options["num_ctx"]=json!(v);}
    if let Some(v)=snapshot.settings.temperature{options["temperature"]=json!(v);}
    if let Some(v)=snapshot.settings.top_p{options["top_p"]=json!(v);}
    if let Some(v)=snapshot.settings.top_k{options["top_k"]=json!(v);}
    if let Some(v)=snapshot.settings.seed{options["seed"]=json!(v);}
    let request=json!({"model":snapshot.provenance.model,"messages":messages,"stream":false,"options":options});
    if serde_json::to_vec(&request).map_err(|_|"Cannot encode native request")?.len()>MAX_BODY_BYTES{return Err("Native request exceeds 16 MiB".into());}Ok(request)
}
#[derive(Debug,PartialEq,Serialize,Deserialize)]
#[serde(rename_all="snake_case")]
pub enum CandidateStatus {FinalCandidate,Incomplete,ReasoningOnly,Empty}
#[derive(Debug,PartialEq,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Usage {
    pub input_tokens:Option<u64>,pub output_tokens:Option<u64>,pub cached_input_tokens:Option<u64>,
    pub total_duration_ns:Option<u64>,pub load_duration_ns:Option<u64>,pub prompt_eval_duration_ns:Option<u64>,pub eval_duration_ns:Option<u64>,
}
#[derive(Debug,PartialEq,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Response {
    pub content:String,pub thinking:Option<String>,pub done:bool,pub raw_done_reason:Option<String>,
    pub finish_reason:Option<String>,pub status:CandidateStatus,pub usage:Usage,
}
fn count(payload:&Value,key:&str)->Result<Option<u64>,String>{
    match payload.get(key) {None|Some(Value::Null)=>Ok(None),Some(v)=>v.as_u64().filter(|n|*n<=MAX_SAFE_INTEGER).map(Some).ok_or_else(||"Invalid native response counter".into())}
}
/// A final candidate is not domain acceptance; controllers must apply their completion rules.
pub fn parse_non_stream_response(bytes:&[u8],expected_model:&str)->Result<Response,String>{
    if bytes.len()>MAX_BODY_BYTES{return Err("Native response exceeds 16 MiB".into());}
    let v:Value=serde_json::from_slice(bytes).map_err(|_|"Invalid native response JSON")?;
    if v.get("error").is_some(){return Err("Native server returned an error".into());}
    if v.get("model").and_then(Value::as_str)!=Some(expected_model) || v.pointer("/message/role").and_then(Value::as_str)!=Some("assistant") {return Err("Native response model or assistant role mismatch".into());}
    if v.pointer("/message/tool_calls").is_some_and(|t|!t.is_null()&&t.as_array().is_none_or(|a|!a.is_empty())) {return Err("Native tool responses are not supported".into());}
    let content=v.pointer("/message/content").and_then(Value::as_str).ok_or("Native final content is missing or invalid")?.to_owned();
    let thinking=match v.pointer("/message/thinking"){None|Some(Value::Null)=>None,Some(Value::String(s))=>Some(s.clone()),_=>return Err("Invalid native thinking field".into())};
    let done=v.get("done").and_then(Value::as_bool).ok_or("Native terminal marker is missing")?;
    let raw=match v.get("done_reason"){None|Some(Value::Null)=>None,Some(Value::String(s)) if s.len()<=512=>Some(s.clone()),_=>return Err("Invalid native done reason".into())};
    let known=raw.as_deref().filter(|r|matches!(*r,"stop"|"length")).map(str::to_owned);
    let status=if content.trim().is_empty(){if thinking.as_ref().is_some_and(|t|!t.trim().is_empty()){CandidateStatus::ReasoningOnly}else{CandidateStatus::Empty}}else if done && raw.as_deref()==Some("stop"){CandidateStatus::FinalCandidate}else{CandidateStatus::Incomplete};
    Ok(Response{content,thinking,done,raw_done_reason:raw,finish_reason:known,status,usage:Usage{input_tokens:count(&v,"prompt_eval_count")?,output_tokens:count(&v,"eval_count")?,cached_input_tokens:count(&v,"prompt_eval_cached_count")?,total_duration_ns:count(&v,"total_duration")?,load_duration_ns:count(&v,"load_duration")?,prompt_eval_duration_ns:count(&v,"prompt_eval_duration")?,eval_duration_ns:count(&v,"eval_duration")?}})
}
#[derive(Clone,Debug,PartialEq,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Readiness {pub generation_available:bool,pub reasons:Vec<String>,pub declared_context_tokens:Option<u64>,pub requested_context_tokens:Option<u64>,pub observed_running_context_tokens:Option<u64>}
/// No deployment conformance has been verified. Neither metadata nor a user checkbox grants trust.
pub fn readiness(settings:&Settings,declared:Option<u64>)->Readiness {
    Readiness{generation_available:false,reasons:vec!["context_unverified".into(),"multi_turn_unverified".into(),"transport_disabled".into()],declared_context_tokens:declared,requested_context_tokens:settings.num_ctx,observed_running_context_tokens:None}
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture()->Value{serde_json::from_str(include_str!("../../docs/development/ollama-native/3c1-contract.json")).unwrap()}
    fn snapshot()->Snapshot{serde_json::from_value(fixture()["snapshot"].clone()).unwrap()}
    #[test] fn exact_wire_preserves_order_and_explicit_zero_without_foreign_fields(){
        let f=fixture();let messages:Vec<Message>=serde_json::from_value(f["messages"].clone()).unwrap();assert_eq!(draft_non_stream_request(&snapshot(),&messages).unwrap(),f["wire"]);
        let mut s=snapshot();s.settings=Settings::default();let wire=draft_non_stream_request(&s,&messages).unwrap();assert_eq!(wire["options"],json!({"num_predict":32768}));assert!(wire.get("think").is_none());assert!(wire.get("truncate").is_none());assert!(wire.get("max_tokens").is_none());
    }
    #[test] fn every_role_preserves_stage_budget_independent_of_context_allocation(){
        let messages=vec![Message{role:"user".into(),content:"Fresh".into()}];
        for role in [Role::Viewer,Role::Monitor,Role::Judge,Role::Learning,Role::PostReveal,Role::Conversation,Role::TelepathicParticipant,Role::TelepathicFacilitator]{for budget in [16384,32768,49152]{let mut s=snapshot();s.role=role.clone();s.max_output_tokens=budget;s.settings.num_ctx=Some(4096);assert_eq!(draft_non_stream_request(&s,&messages).unwrap()["options"]["num_predict"],budget);assert!(!readiness(&s.settings,Some(4096)).generation_available);}}
    }
    #[test] fn auto_and_manual_limits_reject_invalid_or_unrecognized_settings(){
        for value in [json!({"numCtx":0}),json!({"topK":-1}),json!({"seed":MAX_SAFE_INTEGER+1}),json!({"temperature":2.1}),json!({"topP":1.1}),json!({"reasoningEffort":"high"}),json!({"maxOutputTokens":5}),json!({"seed":1.5}),json!({"seed":"1"})]{let parsed=serde_json::from_value::<Settings>(value);assert!(parsed.is_err()||parsed.unwrap().validate().is_err());}
        for budget in [0,MAX_SAFE_INTEGER+1]{let mut s=snapshot();s.max_output_tokens=budget;assert!(s.validate().is_err());}
    }
    #[test] fn snapshot_refuses_connection_auth_revision_or_model_provenance_drift(){
        let s=snapshot();s.assert_current(&s.connection,&s.provenance).unwrap();
        for key in ["serverVersion","model","digest","metadataSha256"]{let mut v=serde_json::to_value(&s.provenance).unwrap();v[key]=json!(if key=="metadataSha256"{"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}else{"changed"});let p:Provenance=serde_json::from_value(v).unwrap();assert!(s.assert_current(&s.connection,&p).is_err());}
        let mut b=s.connection.clone();b.connection_revision+=1;assert!(s.assert_current(&b,&s.provenance).is_err());b=s.connection.clone();b.auth_mode="bearer".into();assert!(s.assert_current(&b,&s.provenance).is_err());
    }
    #[test] fn parser_preserves_candidates_thinking_raw_reason_and_unknown_usage(){
        for case in fixture()["responses"].as_array().unwrap(){let r=parse_non_stream_response(&serde_json::to_vec(&case["body"]).unwrap(),"exact:tag").unwrap();assert_eq!(serde_json::to_value(&r.status).unwrap(),case["status"]);assert_eq!(r.content,case["body"]["message"]["content"]);assert_eq!(r.raw_done_reason.as_deref(),case["body"]["done_reason"].as_str());assert_eq!(r.usage.cached_input_tokens,Some(5));assert_eq!(r.usage.total_duration_ns,Some(123456789));}
        let r=parse_non_stream_response(br#"{"model":"exact:tag","message":{"role":"assistant","content":"Done"},"done":true,"done_reason":"stop"}"#,"exact:tag").unwrap();assert_eq!(r.usage.input_tokens,None);assert_eq!(r.thinking,None);
    }
    #[test] fn parser_rejects_errors_tools_bad_terminal_model_and_bounded_bodies(){
        for body in [json!({"error":"do not echo me"}),json!({"model":"other","message":{"role":"assistant","content":"x"},"done":true}),json!({"model":"exact:tag","message":{"role":"assistant","content":"x"}}),json!({"model":"exact:tag","message":{"role":"tool","content":"x"},"done":true}),json!({"model":"exact:tag","message":{"role":"assistant","content":"x","tool_calls":[{}]},"done":true}),json!({"model":"exact:tag","message":{"role":"assistant","content":"x"},"done":true,"eval_count":-1})]{let error=parse_non_stream_response(&serde_json::to_vec(&body).unwrap(),"exact:tag").unwrap_err();assert!(!error.contains("do not echo me"));}
        assert!(parse_non_stream_response(&vec![b' ';MAX_BODY_BYTES+1],"exact:tag").is_err());assert!(parse_non_stream_response(&[0xff],"exact:tag").is_err());
    }
    #[test] fn history_is_never_truncated_or_reused_and_preflight_cannot_be_unlocked_by_metadata(){
        let s=snapshot();let messages=vec![Message{role:"user".into(),content:"Fresh".into()}];assert_eq!(draft_non_stream_request(&s,&messages).unwrap()["messages"],json!([{"role":"user","content":"Fresh"}]));
        for declared in [None,Some(4096),Some(MAX_SAFE_INTEGER)] {let r=readiness(&s.settings,declared);assert!(!r.generation_available);assert_eq!(r.observed_running_context_tokens,None);assert!(r.reasons.iter().any(|s|s=="context_unverified"));}
        assert!(draft_non_stream_request(&s,&[]).is_err());assert!(draft_non_stream_request(&s,&[Message{role:"tool".into(),content:"unsupported".into()}]).is_err());
    }
}
