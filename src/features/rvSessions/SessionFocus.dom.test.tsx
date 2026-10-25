// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionFocusControls } from "./SessionFocusControls";
import { RvSessionPanel } from "./RvSessionPanel";
import { getCopy } from "../../i18n";
import { createDefaultSettings } from "../../startupDefaults";
import type { SessionFocusPlan } from "../../sessions/sessionFocus";
let container:HTMLDivElement,root:Root;
beforeEach(()=>{(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;container=document.createElement("div");document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
async function select(index:number,value:string){await act(async()=>{const node=container.querySelectorAll<HTMLSelectElement>(".session-focus-disclosure select")[index];node.value=value;node.dispatchEvent(new Event("change",{bubbles:true}));});}
function Controls({busy=false}:{busy?:boolean}){const[value,setValue]=useState<SessionFocusPlan>();return <SessionFocusControls value={value} onChange={setValue} language="en" disabled={busy}/>;}
describe("mounted directed session settings",()=>{
 it("starts closed, accepts matching directions, keeps the collapsed plan and clears both through Session 1",async()=>{
  await act(async()=>root.render(<Controls/>));const details=container.querySelector("details")!;
  expect(details.open).toBe(false);expect(container.querySelectorAll("select")).toHaveLength(2);expect(container.querySelectorAll<HTMLSelectElement>("select")[1].disabled).toBe(true);
  await select(0,"location");await select(1,"location");expect(container.querySelector("summary")!.textContent).toContain("2 sessions: location → location");
  await act(async()=>{details.open=true;details.open=false;});expect(container.querySelectorAll<HTMLSelectElement>("select")[1].value).toBe("location");
  await select(0,"");expect(container.querySelectorAll<HTMLSelectElement>("select")[1].value).toBe("");expect(container.querySelectorAll<HTMLSelectElement>("select")[1].disabled).toBe(true);
  await act(async()=>root.render(<Controls busy/>));expect([...container.querySelectorAll<HTMLSelectElement>("select")].every(node=>node.disabled)).toBe(true);
 });
 it.each(["en","pl"] as const)("mounts the full %s panel, hides retained choices in Monitor/Telepathic, and places Custom focus correctly",async language=>{
  const now="2026-10-11",profile={id:"p",name:"P",createdAt:now,updatedAt:now};const workspace={id:"w",profileId:"p",name:"W",kind:"rv" as const,createdAt:now,updatedAt:now,lastOpenedAt:now};
  await act(async()=>root.render(<RvSessionPanel repository={null} profile={profile} workspace={workspace} settings={{...createDefaultSettings(),interfaceLanguage:language}} copy={getCopy(language)}/>));
  const click=async(text:string)=>{const button=[...container.querySelectorAll<HTMLButtonElement>("button")].find(node=>node.textContent?.includes(text));expect(button).toBeTruthy();await act(async()=>button!.click());};
  expect(container.querySelector(".session-focus-disclosure")!.nextElementSibling?.classList.contains("special-task-disclosure")).toBe(true);
  await select(0,"event");await select(1,"activity");
  const copy=getCopy(language);await click(copy.automaticMonitor);expect(container.querySelector(".session-focus-disclosure")).toBeNull();
  await click(copy.automatic);expect(container.querySelectorAll<HTMLSelectElement>(".session-focus-disclosure select")[1].value).toBe("activity");
  await click(language==="pl"?"Protokół Telepatyczny":"Telepathic Protocol");expect(container.querySelector(".session-focus-disclosure")).toBeNull();
  await click(copy.customProtocol);expect(container.querySelector(".session-focus-disclosure")).not.toBeNull();expect(container.querySelectorAll(".special-task-disclosure:not(.session-focus-disclosure)")).toHaveLength(0);
 });
});
