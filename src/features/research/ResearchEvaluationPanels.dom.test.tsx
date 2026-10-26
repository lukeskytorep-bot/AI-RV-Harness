// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { evaluationFixture } from "../../testing/researchEvaluationFixture";
import { model, output } from "../../testing/researchJudgeRecoveryFixture";
import { modelRouteKeyFor } from "../../modelRoutes";
const mocks=vi.hoisted(()=>({chat:vi.fn()}));
vi.mock("../../storage",async original=>({...await original<object>(),isTauriRuntime:()=>true}));
vi.mock("../../research/evaluationEngine",async original=>{const actual=await original<typeof import("../../research/evaluationEngine")>();return{...actual,runResearchEvaluation:(input:Parameters<typeof actual.runResearchEvaluation>[0])=>actual.runResearchEvaluation({...input,chat:mocks.chat})};});
import { ResearchEvaluationPanels } from "./ResearchEvaluationPanels";

for(const pl of [false,true])it(`mounted evaluation panels create same/new-Judge panels after End (${pl?"pl":"en"})`,async()=>{
 (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
 const f=evaluationFixture();f.state.ended=true;f.repo.listProviderModels=async()=>[model,{...model,modelId:"other",route:"other:m",displayName:"Other Judge"}];
 mocks.chat.mockImplementation(f.chat);
 const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
 const start=()=>[...host.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent?.includes(pl?"Rozpocznij nowy panel":"Start a new evaluation"))!;
 try{
  await act(async()=>root.render(<ResearchEvaluationPanels repository={f.repo} project={f.project} pl={pl}/>));
  await vi.waitFor(()=>expect(start().disabled).toBe(false));
  await act(async()=>start().click());await vi.waitFor(()=>expect([...f.panels.values()].filter(p=>p.status==="Complete")).toHaveLength(1));
  await vi.waitFor(()=>expect(start().disabled).toBe(false));await act(async()=>start().click());await vi.waitFor(()=>expect([...f.panels.values()].filter(p=>p.status==="Complete")).toHaveLength(2));
  const selector=host.querySelector<HTMLSelectElement>("select")!;
  await act(async()=>{selector.value="custom";selector.dispatchEvent(new Event("change",{bubbles:true}));});
  const route=host.querySelector<HTMLSelectElement>('select[data-model-route-role="judge"]')!;
  await act(async()=>{route.value=modelRouteKeyFor({...model,modelId:"other"});route.dispatchEvent(new Event("change",{bubbles:true}));});
  await vi.waitFor(()=>expect(start().disabled).toBe(false));await act(async()=>start().click());await vi.waitFor(()=>expect([...f.panels.values()].filter(p=>p.status==="Complete")).toHaveLength(3));
  expect(f.chat).toHaveBeenCalledTimes(3);expect([...f.panels.values()].map(p=>p.judges[0].model.modelId)).toEqual(["m","m","other"]);
  expect(f.repo.setResearchProjectState).not.toHaveBeenCalled();expect(await f.repo.getResearchExecutionTermination("r")).toBe(f.marker);
  expect(host.textContent).toContain("Other Judge");expect(host.textContent).not.toContain("Condition");
 }finally{await act(async()=>root.unmount());host.remove();mocks.chat.mockReset();}
});
it("mounted evaluation STOP preserves the current score and its own completion action only requests the missing Judge",async()=>{
 (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
 const f=evaluationFixture();f.project.config.judges.push({providerConfigId:"pc",modelId:"m"});let resolve!:(v:{content:string;finishReason:"stop";usage:object})=>void;
 f.chat.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));mocks.chat.mockImplementation(f.chat);
 const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
 const find=(label:string)=>[...host.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent?.includes(label));
 try{
  await act(async()=>root.render(<ResearchEvaluationPanels repository={f.repo} project={f.project} pl={false}/>));
  await vi.waitFor(()=>expect(find("Start a new evaluation")?.disabled).toBe(false));await act(async()=>find("Start a new evaluation")!.click());
  await vi.waitFor(()=>expect(f.chat).toHaveBeenCalledTimes(1));await act(async()=>find("STOP")!.click());await act(async()=>resolve({content:output,finishReason:"stop",usage:{}}));
  await vi.waitFor(()=>expect(find("Complete missing scores in this panel")?.disabled).toBe(false));
  expect(f.chat).toHaveBeenCalledTimes(1);expect([...f.panels.values()][0].scores.s).toHaveLength(1);
  await act(async()=>find("Complete missing scores in this panel")!.click());await vi.waitFor(()=>expect([...f.panels.values()][0].status).toBe("Complete"));expect(f.chat).toHaveBeenCalledTimes(2);
 }finally{await act(async()=>root.unmount());host.remove();mocks.chat.mockReset();}
});
