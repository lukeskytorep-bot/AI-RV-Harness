// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {it,expect} from "vitest";
import {TelepathicTranscript} from "./TelepathicTranscript";
import type {TelepathicTranscriptEvent} from "../telepathicExchange/types";
import {leadDecisionErrorMessage} from "../telepathicExchange/leadDecisionResponse";
for(const pl of [true,false])for(const legacy of [true,false])it(`${pl?"PL":"EN"}/${legacy?"legacy":"reason"}: short rejected notice, closed raw details, no executed instruction`,async()=>{
 (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
 const raw='```json\n{"cycle":2,"broadcast":{"instruction":"<script>DO_NOT_EXECUTE</script>"}}\n```';
 const event:TelepathicTranscriptEvent={id:"reject",seriesId:"s",roundId:"r",sequence:1,stage:"lead_guidance:cycle:2",kind:"notice",authorId:"lead",recipientIds:[],text:`[REJECTED DECISION · stop]\n${raw}`,createdAt:"t",providerCallStatus:"failed",...(!legacy?{decisionRejectionReason:"Invalid lead decision; no questions were invented or dispatched. [invalid_cycle] The cycle does not match the request."}:{})};
 const before=JSON.stringify(event);const el=document.createElement("div");document.body.append(el);const root=createRoot(el);
 try {
  await act(async()=>root.render(<TelepathicTranscript seriesId="s" roundId="r" leadId="lead" participants={[{id:"lead",displayName:"Leo"},{id:"a",displayName:"Receiver"}]} events={[event]} pl={pl}/>));
  expect(el.querySelector('[role="status"]')?.textContent).toContain(pl?"Decyzja prowadzącego nie spełnia kontraktu":"The lead's decision violates the contract");
  if(!legacy)expect(el.querySelector('[role="status"]')?.textContent).toContain(pl?"Cykl nie odpowiada":"cycle does not match");
  expect(el.querySelector(".telepathic-message-author")?.textContent).toBe(pl?"Odrzucona decyzja — Leo":"Rejected decision — Leo");
  const details=el.querySelector("details")!;expect(details.open).toBe(false);expect(details.querySelector("pre")?.textContent).toBe(event.text);
  expect(el.querySelector("script")).toBeNull();expect(el.querySelector(".markdown-content")).toBeNull();expect(el.querySelectorAll("article")).toHaveLength(1);
  await act(async()=>details.querySelector("summary")!.click());expect(details.open).toBe(true);expect(details.textContent).toContain(raw);expect(JSON.stringify(event)).toBe(before);
 }finally{await act(async()=>root.unmount());el.remove();}
});
it("error presentation leaves unrelated errors unchanged and never includes raw syntax fragments",()=>{
 expect(leadDecisionErrorMessage("Network unavailable",true)).toBe("Network unavailable");
 expect(leadDecisionErrorMessage("Invalid lead decision; no questions were invented or dispatched. [invalid_json] Invalid JSON or response wrapper.",true)).toBe("Nie udało się odczytać decyzji prowadzącego. Niepoprawny JSON lub opakowanie odpowiedzi.");
});
