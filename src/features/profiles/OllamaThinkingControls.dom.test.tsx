// @vitest-environment jsdom
import {it,expect,vi} from "vitest";
import {act} from "react";
import {createRoot} from "react-dom/client";
import {ProfileViewerControls} from "./ProfileViewerControls";
import {normalizeModelDiscovery} from "../../providers/capabilities";
import {getCopy} from "../../i18n";
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
it.each(["en","pl"] as const)("%s: Cloud selector offers model-specific thinking and sampling, unknown model only Auto",async language=>{
 const host=document.createElement("div");document.body.append(host);const root=createRoot(host);const change=vi.fn();
 const config={id:"c",provider:"ollama_cloud" as const,label:"Cloud",credentialId:"opaque",enabled:true,createdAt:"t",updatedAt:"t"};
 const props={copy:getCopy(language),reasoning:"" as const,temperature:"",systemPrompt:"",providerKind:"ollama_cloud" as const,onReasoning:change,onTemperature:vi.fn(),sampling:{enabled:true,topP:"",topK:"",seed:""},onSamplingEnabled:vi.fn(),onSamplingTopP:vi.fn(),onSamplingTopK:vi.fn(),onSamplingSeed:vi.fn()};
 try{
  for(const [name,values] of [["gpt-oss:120b",["","low","medium","high"]],["qwen3:235b",["","none","high"]],["unknown",[""]]] as const){
   const model=normalizeModelDiscovery(config,{models:[{name}]})[0];await act(async()=>root.render(<ProfileViewerControls {...props} model={model}/>));
   const select=host.querySelector("select")!;expect([...select.options].map(o=>o.value)).toEqual(values);
   expect(host.querySelector('[aria-label="Top K value"]')).toBeTruthy();
   if(values.length>1){await act(async()=>{select.value=values.at(-1)!;select.dispatchEvent(new Event("change",{bubbles:true}));});expect(change).toHaveBeenLastCalledWith(values.at(-1));}
  }
 }finally{await act(async()=>root.unmount());host.remove();}
});
