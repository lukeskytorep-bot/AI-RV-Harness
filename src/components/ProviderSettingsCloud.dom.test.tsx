// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { getCopy } from "../i18n";
import { ProviderSettings } from "./ProviderSettings";
import type { AppRepository } from "../storage/repository";
import { listNativeConnections } from "../providers/nativeDiscovery";
vi.mock("../storage", () => ({isTauriRuntime:()=>true}));
vi.mock("../providers/nativeDiscovery",()=>({listNativeConnections:vi.fn(async()=>[])}));
vi.mock("./AppDialogProvider",()=>({useAppDialogs:()=>({})}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
it.each(["en","pl"] as const)("%s: active Cloud uses ordinary controls, no diagnostic and no legacy discovery on open",async language=>{
 const repository={listProviderConfigs:async()=>[{id:"cloud",provider:"ollama_cloud",label:"Cloud account",credentialId:"opaque",enabled:true,createdAt:"t",updatedAt:"t"}],listProviderModels:async()=>[]} as unknown as AppRepository;
 const host=document.createElement("div");document.body.append(host);const root=createRoot(host);const copy=getCopy(language);
 vi.mocked(listNativeConnections).mockClear();
 try {
  await act(async()=>root.render(<ProviderSettings language={language} copy={copy} repository={repository} section="providers"/>));
  expect(host.textContent).toContain("Cloud account");expect(host.textContent).not.toMatch(/Multi-turn test|Test wieloturowości/);
  expect(listNativeConnections).not.toHaveBeenCalled();
  expect(host.querySelector("details")?.open).toBe(false);
  await act(async()=>[...host.querySelectorAll("button")].find(b=>b.textContent===copy.addProvider)!.click());
  const select=host.querySelector<HTMLSelectElement>("[role=dialog] select")!;
  expect([...select.options].some(o=>o.value==="ollama_cloud" && o.textContent==="Ollama Cloud")).toBe(true);
  await act(async()=>{select.value="ollama_cloud";select.dispatchEvent(new Event("change",{bubbles:true}));});
  expect(host.querySelector("[role=dialog] input[type=password]")).toBeTruthy();
  expect(host.querySelector("[role=dialog] input[type=url]")).toBeNull();
  expect(listNativeConnections).not.toHaveBeenCalled();
 }finally{await act(async()=>root.unmount());host.remove();}
});
