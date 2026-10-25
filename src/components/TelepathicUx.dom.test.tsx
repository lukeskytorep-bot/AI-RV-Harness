// @vitest-environment jsdom
import { act } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterEach,beforeEach,describe,it,expect,vi } from "vitest";
import { TelepathicHistory } from "./TelepathicHistory";
import { TelepathicTranscript } from "./TelepathicTranscript";
let container:HTMLDivElement,root:Root;
beforeEach(()=>{(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;container=document.createElement("div");document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();});
describe("mounted shared telepathy UX",()=>{
 for(const pl of [false,true])it(`keeps right history open, three working icons, keyboard tooltip and reversible toggle ${pl?"PL":"EN"}`,async()=>{
  const onOpen=vi.fn(),onSave=vi.fn(),onArchive=vi.fn();
  await act(async()=>root.render(<TelepathicHistory pl={pl} busy={false} items={[{id:"s",name:"Long participant name",updatedAt:"2026-10-11T08:00:00Z",status:"paused"}]} onOpen={onOpen} onSave={onSave} onArchive={onArchive}/>));
  expect(container.querySelector("aside")?.classList.contains("collapsed")).toBe(false);
  const icons=container.querySelectorAll<HTMLButtonElement>(".telepathic-history-icons button");expect(icons).toHaveLength(3);
  await act(async()=>icons[0].focus());expect(document.body.querySelector('[role="tooltip"]')?.textContent).toBe(pl?"Otwórz trening":"Open training");
  await act(async()=>icons[0].click());await act(async()=>icons[1].click());await act(async()=>icons[2].click());
  expect(onOpen).toHaveBeenCalledWith("s");expect(onSave).toHaveBeenCalledWith("s");expect(onArchive).toHaveBeenCalledWith("s",true);
  const toggle=container.querySelector<HTMLButtonElement>(".telepathic-history-toggle")!;await act(async()=>toggle.click());expect(container.querySelector("aside")?.hidden).toBe(true);expect(toggle.getAttribute("aria-expanded")).toBe("false");await act(async()=>toggle.click());expect(container.querySelector(".telepathic-history-card")).not.toBeNull();
 });
 it("orders lead first, isolates malformed Markdown and moves focus to section and back",async()=>{
  const scroll=vi.fn();HTMLElement.prototype.scrollTo=scroll;
  const participants=[{id:"a",displayName:"Duplicate name"},{id:"lead",displayName:"Duplicate name"},{id:"b",displayName:"B"}];
  await act(async()=>root.render(<TelepathicTranscript seriesId="s" roundId="r" leadId="lead" participants={participants} pl={false} events={[
   {id:"a-msg",seriesId:"s",roundId:"r",sequence:1,stage:"receiver_first",kind:"response",authorId:"a",recipientIds:[],text:"```\nopen fence",createdAt:"t"},
   {id:"b-msg",seriesId:"s",roundId:"r",sequence:2,stage:"receiver_first",kind:"response",authorId:"b",recipientIds:[],text:"B remains visible",createdAt:"t"}]}/>));
  expect(container.querySelector("h3")?.textContent).toContain("Lead — Duplicate name");
  expect(container.querySelectorAll(".telepathic-transcript-message")).toHaveLength(2);expect(container.textContent).toContain("B remains visible");
  const nav=container.querySelector("nav")!,navButtons=nav.querySelectorAll<HTMLButtonElement>("button");await act(async()=>navButtons[1].click());expect(document.activeElement?.id).toContain("-a");
  const back=container.querySelectorAll<HTMLButtonElement>(".telepathic-back")[1];await act(async()=>back.click());expect(document.activeElement).toBe(nav);expect(scroll).toHaveBeenCalled();
 });
 it("disables actions during execution and offers restore without starting a model",async()=>{
  const onArchive=vi.fn();await act(async()=>root.render(<TelepathicHistory pl={false} busy={false} items={[{id:"s",name:"Archived",updatedAt:"2026-10-11",status:"paused",archivedAt:"t"}]} onOpen={()=>{}} onSave={()=>{}} onArchive={onArchive}/>));
  expect(container.querySelector(".telepathic-history-card")).not.toBeNull();expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  await act(async()=>container.querySelector<HTMLButtonElement>('button[aria-label="Restore training"]')!.click());expect(onArchive).toHaveBeenCalledWith("s",false);
 });
});
