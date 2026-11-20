import type {ReasoningCapability,ReasoningEffort,ReasoningOption} from "./types";
/** Native think values, never another provider's reasoning_effort dialect. */
export function ollamaThinkingCapability(modelId:string, metadata?:unknown):ReasoningCapability {
 const data=metadata && typeof metadata==="object"?metadata as Record<string,unknown>:{};
 const published=Array.isArray(data.values)?data.values:undefined;
 // Exact documented model contracts; unknown models retain Auto unless metadata supplies controls.
 const documented=/^gpt-oss:(20b|120b)$/.test(modelId)?["low","medium","high"]
  : /^(qwen3|qwen3:235b|qwen3:32b|deepseek-r1|deepseek-r1:671b)$/.test(modelId)?[false,true]:undefined;
 const values=published??documented;
 if(!values || values.length===0 || values.every(v=>v===false))return {supported:false,efforts:[],options:[],confidence:"unknown"};
 const allowed=["none","minimal","low","medium","high","xhigh","max"];
 const options:ReasoningOption[]=values.flatMap(v=>{
  if(typeof v!=="boolean" && (typeof v!=="string"||!allowed.includes(v)))return [];
  const effort=(v===false?"none":v===true?"high":v) as ReasoningEffort;
  return [{value:effort,label:v===false?"OFF":v===true?"ON":v.toUpperCase(),verification:published?"provider_metadata" as const:"registry" as const,transport:{kind:typeof v==="boolean"?"enabled_boolean" as const:"thinking_level" as const,value:String(v)}}];
 });
 // Mixed on/high contracts cannot be represented unambiguously by the common selector.
 if(new Set(options.map(o=>o.value)).size!==options.length)return {supported:false,efforts:[],options:[],confidence:"unknown"};
 return {supported:options.length>0,efforts:options.map(o=>o.value),options,mandatory:!values.includes(false),confidence:published?"provider_metadata":"verified",registryStatus:published?"unknown":"known",registryVersion:"ollama-thinking-2026-11-20",registryModelId:published?undefined:modelId,verificationSource:"https://docs.ollama.com/capabilities/thinking"};
}
