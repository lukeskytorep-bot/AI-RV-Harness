// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { TelepathicTranscript } from "./TelepathicTranscript";
import type { TelepathicTranscriptEvent } from "../telepathicExchange/types";

const participants=[{id:"lead",displayName:"Same long name — DevStral"},{id:"receiver",displayName:"Same long name — DevStral"}];
const events: TelepathicTranscriptEvent[]=[{id:"e",seriesId:"s",roundId:"r",sequence:1,stage:"receiver_first",kind:"response",authorId:"receiver",recipientIds:[],text:"Reply",createdAt:"t"}];
for(const pl of [true,false])for(const reduced of [true,false])it(`scoped scroll, sticky offset, top=0 and hover/focus tooltips ${pl}/${reduced}`,async()=>{
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  vi.stubGlobal("matchMedia",vi.fn(()=>({matches:reduced})));
  const render=(ev=events)=>act(async()=>root.render(<><TelepathicTranscript seriesId="s" roundId="r" leadId="lead" participants={participants} events={ev} pl={pl}/><TelepathicTranscript seriesId="s" roundId="r" leadId="lead" participants={participants} events={ev} pl={pl}/></>));
  try{
    await render();
    const containers=host.querySelectorAll<HTMLDivElement>(".telepathic-transcript");
    const firstScroll=vi.fn(),secondScroll=vi.fn();containers[0].scrollTo=firstScroll;containers[1].scrollTo=secondScroll;
    containers[1].scrollTop=200;
    const nav=containers[1].querySelector<HTMLElement>("nav")!;
    const heading=containers[1].querySelectorAll<HTMLHeadingElement>("h3")[1];
    vi.spyOn(containers[1],"getBoundingClientRect").mockReturnValue({top:100} as DOMRect);
    vi.spyOn(nav,"getBoundingClientRect").mockReturnValue({height:70} as DOMRect);
    vi.spyOn(heading,"getBoundingClientRect").mockReturnValue({top:700} as DOMRect);
    const buttons=nav.querySelectorAll<HTMLButtonElement>("button");
    await act(async()=>buttons[1].focus());
    expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain(participants[1].displayName);
    expect(buttons[1].getAttribute("aria-controls")).toBe(heading.id);
    const ids=[...host.querySelectorAll("[id]")].map(e=>e.id);expect(new Set(ids).size).toBe(ids.length);
    await act(async()=>buttons[1].click());
    expect(firstScroll).not.toHaveBeenCalled();expect(secondScroll).toHaveBeenLastCalledWith({top:722,behavior:reduced?"auto":"smooth"});expect(document.activeElement).toBe(heading);
    const oldId=heading.id;await render([...events,{...events[0],id:"new",sequence:2,text:"Checkpoint refresh"}]);
    expect(document.activeElement).toBe(heading);expect(heading.id).toBe(oldId);expect(secondScroll).toHaveBeenCalledTimes(1);
    expect(containers[1].scrollTop).toBe(200);
    nav.scrollTop=40;
    const back=containers[1].querySelectorAll<HTMLButtonElement>(".telepathic-back")[1];
    await act(async()=>back.dispatchEvent(new MouseEvent("mouseover",{bubbles:true})));
    expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain(pl?"Wróć do listy uczestników":"Back to participants");
    await act(async()=>back.click());
    expect(secondScroll).toHaveBeenLastCalledWith({top:0,behavior:reduced?"auto":"smooth"});expect(document.activeElement).toBe(nav);
    expect(nav.scrollTop).toBe(0);
    expect(firstScroll).not.toHaveBeenCalled();
  }finally{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();}
});

it("changing the selected round resets local scroll without invoking a provider or scrolling the page",async()=>{
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try{
    const render=(roundId:string)=>act(async()=>root.render(<TelepathicTranscript seriesId="s" roundId={roundId} leadId="lead" participants={participants} pl={false} events={events}/>));
    await render("r");const container=host.querySelector<HTMLDivElement>(".telepathic-transcript")!,nav=container.querySelector<HTMLElement>("nav")!;
    container.scrollTop=500;nav.scrollTop=90;const oldId=container.querySelector("h3")!.id;
    await render("r");expect(container.scrollTop).toBe(500);
    await render("new-round");expect(container.scrollTop).toBe(0);expect(nav.scrollTop).toBe(0);expect(container.querySelector("h3")!.id).not.toBe(oldId);
  }finally{await act(async()=>root.unmount());host.remove();}
});

it("round changes and final reflections keep unique local destinations and controller/lead/participant cards",async()=>{
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try{
    const e=events[0];await act(async()=>root.render(<><TelepathicTranscript seriesId="s" roundId="r" leadId="lead" participants={participants} pl={false} events={[{...e,id:"c",authorId:"controller",recipientIds:["receiver"]},{...e,id:"l",authorId:"lead",recipientIds:["receiver"]},e]}/><TelepathicTranscript seriesId="s" leadId="lead" participants={participants} pl={false} events={[{...e,roundId:undefined,stage:"series_reflection"}]}/></>));
    const ids=[...host.querySelectorAll("[id]")].map(e=>e.id);expect(new Set(ids).size).toBe(ids.length);
    expect(host.querySelector(".telepathic-message-controller")).not.toBeNull();expect(host.querySelector(".telepathic-message-lead")).not.toBeNull();expect(host.querySelector(".telepathic-message-participant")).not.toBeNull();
    for(const button of host.querySelectorAll<HTMLButtonElement>("button[aria-controls]"))expect(button.closest(".telepathic-transcript")!.querySelector(`[id="${button.getAttribute("aria-controls")}"]`)).not.toBeNull();
  }finally{await act(async()=>root.unmount());host.remove();}
});
