//! Hosted native JSON transport. HTTP execution stays in the shared owned/cancellable path.
use serde_json::{json,Value};
use super::{ProviderChatRequest,ProviderChatResponse,ProviderUsage};
pub(super) fn build(request:&ProviderChatRequest,base:&str)->Result<(String,Value),String>{
    if base!="https://ollama.com" {return Err("Ollama Cloud endpoint mismatch".into());}
    if request.reasoning_max_tokens.is_some() || request.provider_routing.is_some() || request.messages.iter().any(|m|!m.images.is_empty()) {return Err("Ollama Cloud currently supports text and native thinking only".into());}
    let settings=crate::native_generation_contract::Settings{num_ctx:None,temperature:request.temperature,top_p:request.top_p,top_k:request.top_k,seed:request.seed};settings.validate()?;
    let budget=request.max_output_tokens.filter(|n|*n>0).ok_or("Ollama Cloud requires a positive stage response budget")?;
    if request.messages.is_empty() || request.messages.iter().any(|m|!matches!(m.role.as_str(),"system"|"user"|"assistant")) || request.messages.last().is_none_or(|m|m.role!="user") {return Err("Invalid Ollama Cloud text history".into());}
    let mut options=json!({"num_predict":budget});
    if let Some(v)=settings.temperature{options["temperature"]=json!(v);}
    if let Some(v)=settings.top_p{options["top_p"]=json!(v);}
    if let Some(v)=settings.top_k{options["top_k"]=json!(v);}
    if let Some(v)=settings.seed{options["seed"]=json!(v);}
    let mut body=json!({"model":request.model_id,"messages":request.messages.iter().map(|m|{let mut v=json!({"role":m.role,"content":m.content}); if let Some(super::ProviderContinuationState::Ollama(state))=&m.continuation_state {let thinking=state.content.iter().filter(|c|c["type"]=="thinking").flat_map(|c|c["thinking"].as_array().into_iter().flatten()).filter_map(|c|c["text"].as_str()).collect::<String>();v["thinking"]=json!(thinking);}v}).collect::<Vec<_>>(),"stream":false,"options":options});
    if let Some(value)=request.reasoning_transport_value.as_deref() {
        body["think"]=match request.reasoning_transport_kind.as_deref() {
            Some("enabled_boolean") if value=="true" || value=="false"=>json!(value=="true"),
            Some("thinking_level") if ["none","minimal","low","medium","high","xhigh","max"].contains(&value)=>json!(value),
            _=>return Err("Unsupported Ollama think setting".into()),
        };
    } else if request.reasoning_effort.is_some() || request.reasoning_transport_kind.is_some() {return Err("Ollama thinking requires an explicit native transport value".into());}
    if serde_json::to_vec(&body).map_err(|_|"Cannot encode cloud request")?.len()>crate::native_generation_contract::MAX_BODY_BYTES{return Err("Ollama Cloud request exceeds 16 MiB".into());}
    Ok((format!("{base}/api/chat"),body))
}
pub(super) fn parse(payload:Value,request_id:Option<String>)->Result<ProviderChatResponse,String>{
    let model=payload.get("model").and_then(Value::as_str).ok_or("Ollama Cloud response model missing")?;
    let r=crate::native_generation_contract::parse_non_stream_response(&serde_json::to_vec(&payload).map_err(|_|"Invalid cloud JSON")?,model)?;
    if !r.done || !matches!(r.raw_done_reason.as_deref(),Some("stop"|"length")){return Err("Ollama Cloud response did not provide a supported terminal boundary".into());}
    if r.content.trim().is_empty(){return Err(if r.thinking.as_ref().is_some_and(|v|!v.trim().is_empty()){"provider returned reasoning without a final assistant response"}else{"provider returned an empty assistant response"}.into());}
    Ok(ProviderChatResponse{final_candidate:None,response_evidence:None,content:r.content.clone(),reasoning_content:r.thinking.clone(),reasoning_details:r.thinking.as_ref().filter(|t|!t.is_empty()).map(|t|vec![json!({"type":"thinking","thinking":[{"type":"text","text":t}]}),json!({"type":"text","text":r.content})]),reasoning_source:Some("ollama_thinking".into()),finish_reason:r.finish_reason,actual_model:Some(model.into()),usage:ProviderUsage{input_tokens:r.usage.input_tokens,output_tokens:r.usage.output_tokens,native_metrics:Some(json!({"cachedInputTokens":r.usage.cached_input_tokens,"totalDurationNs":r.usage.total_duration_ns,"loadDurationNs":r.usage.load_duration_ns,"promptEvalDurationNs":r.usage.prompt_eval_duration_ns,"evalDurationNs":r.usage.eval_duration_ns})),..ProviderUsage::default()},provider_request_id:request_id,actual_provider:Some("Ollama Cloud".into()),continuation_diagnostics:None,debug_payload:None})
}

pub(super) async fn validate_binding(pool:&sqlx::SqlitePool,request:&ProviderChatRequest)->Result<(),String>{
    let id=&request.provider_config_id;
    if id.trim().is_empty(){return Err("Ollama Cloud requires a saved connection".into());}
    let valid:i64=sqlx::query_scalar("SELECT COUNT(*) FROM provider_configs c JOIN model_registry m ON m.provider_config_id=c.id WHERE c.id=$1 AND c.provider='ollama_cloud' AND c.enabled=1 AND c.credential_id=$2 AND COALESCE(c.base_url,'https://ollama.com')='https://ollama.com' AND m.provider='ollama_cloud' AND m.model_id=$3")
        .bind(id).bind(&request.credential_id).bind(&request.model_id).fetch_one(pool).await.map_err(|_|"Cannot validate saved Cloud route")?;
    if valid!=1{return Err("Ollama Cloud connection or model changed; refresh models before starting".into());}Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request()->ProviderChatRequest{serde_json::from_value(json!({"provider":"ollama_cloud","providerConfigId":"p","credentialId":"c","modelId":"qwen3:235b","messages":[{"role":"system","content":"System"},{"role":"user","content":"Question"}],"maxOutputTokens":32768})).unwrap()}
    fn final_response()->Value{json!({"model":"qwen3:235b","message":{"role":"assistant","content":"Final <think>literal</think>","thinking":"Separate reasoning"},"done":true,"done_reason":"stop","prompt_eval_count":12,"eval_count":30,"total_duration":1234567})}
    #[test] fn native_wire_preserves_stage_budget_and_history_without_local_or_compatibility_fields(){
        let mut r=request();r.top_p=Some(0.8);r.top_k=Some(40);r.seed=Some(7);
        let (url,body)=build(&r,"https://ollama.com").unwrap();assert_eq!(url,"https://ollama.com/api/chat");assert_eq!(body["stream"],false);assert_eq!(body["messages"][0]["role"],"system");assert_eq!(body["options"],json!({"num_predict":32768,"top_p":0.8,"top_k":40,"seed":7}));assert!(body.get("think").is_none());assert!(body["options"].get("num_ctx").is_none());assert!(body.get("max_tokens").is_none());assert!(build(&r,"https://other.invalid").is_err());
        r.max_output_tokens=Some(49152);assert_eq!(build(&r,"https://ollama.com").unwrap().1["options"]["num_predict"],49152);
        r.reasoning_effort=Some("high".into());assert!(build(&r,"https://ollama.com").is_err());
    }
    #[test] fn native_response_keeps_thinking_separate_and_native_units(){
        let r=parse(final_response(),Some("id".into())).unwrap();assert_eq!(r.content,"Final <think>literal</think>");assert_eq!(r.reasoning_content.as_deref(),Some("Separate reasoning"));assert_eq!(r.usage.input_tokens,Some(12));assert_eq!(r.usage.output_tokens,Some(30));assert_eq!(r.usage.native_metrics.unwrap()["totalDurationNs"],1234567);
    }
    #[test] fn incomplete_reasoning_only_and_unknown_terminal_reason_are_not_success(){
        for variant in 0..4 {let mut p=final_response();match variant{0=>p["done"]=json!(false),1=>p["done_reason"]=json!("unknown"),2=>p["message"]["content"]=json!(""),_=>{p.as_object_mut().unwrap().remove("done");}}assert!(parse(p,None).is_err());}
        let mut p=final_response();p["done_reason"]=json!("length");assert_eq!(parse(p,None).unwrap().finish_reason.as_deref(),Some("length"));
    }
    #[tokio::test] async fn saved_cloud_binding_rejects_missing_model_or_replaced_credential_before_dispatch(){
        let pool=sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        for m in crate::migrations::MIGRATION_SPECS{sqlx::raw_sql(m.sql).execute(&pool).await.unwrap();}
        sqlx::raw_sql("INSERT INTO credentials_metadata(id,provider,label,created_at,updated_at) VALUES('c','ollama_cloud','Cloud','t','t'); INSERT INTO provider_configs(id,provider,label,credential_id,created_at,updated_at) VALUES('p','ollama_cloud','Cloud','c','t','t');").execute(&pool).await.unwrap();
        let r=request();assert!(validate_binding(&pool,&r).await.is_err());
        sqlx::raw_sql("INSERT INTO model_registry(provider_config_id,provider,model_id,display_name,route,capability_json,refreshed_at) VALUES('p','ollama_cloud','qwen3:235b','Qwen','ollama_cloud:qwen3:235b','{}','t');").execute(&pool).await.unwrap();assert!(validate_binding(&pool,&r).await.is_ok());
        sqlx::query("UPDATE provider_configs SET enabled=0 WHERE id='p'").execute(&pool).await.unwrap();assert!(validate_binding(&pool,&r).await.is_err());
    }

    #[test] fn native_think_controls_and_bound_replay_do_not_change_sampler_or_stage_budget(){
        let mut r=request();
        for (kind,value,expected) in [("enabled_boolean","true",json!(true)),("enabled_boolean","false",json!(false)),("thinking_level","low",json!("low")),("thinking_level","high",json!("high"))] {
            r.reasoning_transport_kind=Some(kind.into());r.reasoning_transport_value=Some(value.into());
            assert_eq!(build(&r,"https://ollama.com").unwrap().1["think"],expected);
        }
        r.reasoning_transport_kind=None;r.reasoning_transport_value=None;
        let fingerprint=super::super::ProviderReplayFingerprint{transport:"ollama-cloud".into(),normalized_endpoint:"https://ollama.com".into(),provider_config_id:"p".into(),credential_id:"c".into(),requested_model_id:r.model_id.clone(),actual_model_id:None,state_format:"ollama-thinking-content".into(),state_format_version:1};
        r.messages.insert(1,super::super::ProviderMessage{role:"assistant".into(),content:"Final".into(),images:vec![],continuation_state:Some(super::super::ProviderContinuationState::Ollama(super::super::OllamaContinuationState{schema_version:1,transport:"ollama-cloud".into(),format:"ollama-thinking-content".into(),replay_fingerprint:fingerprint,content:vec![json!({"type":"thinking","thinking":[{"type":"text","text":"private trace"}]}),json!({"type":"text","text":"Final"})]}))});
        let decoded: super::super::ProviderMessage=serde_json::from_value(serde_json::to_value(&r.messages[1]).unwrap()).unwrap();
        assert!(matches!(decoded.continuation_state,Some(super::super::ProviderContinuationState::Ollama(_))));
        super::super::validation::validate_continuation_bindings(&r,"https://ollama.com").unwrap();
        let body=build(&r,"https://ollama.com").unwrap().1;
        assert_eq!(body["messages"][1]["thinking"],"private trace");assert_eq!(body["messages"][1]["content"],"Final");assert!(body.get("think").is_none());assert_eq!(body["options"]["num_predict"],32768);
        r.credential_id="rotated".into();assert!(super::super::validation::validate_continuation_bindings(&r,"https://ollama.com").is_err());
        r.credential_id="c".into();r.messages[1].content="mutated".into();assert!(super::super::validation::validate_continuation_bindings(&r,"https://ollama.com").is_err());
    }

}
