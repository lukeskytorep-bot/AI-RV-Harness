import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { displayFixture, actualDisplayRun } from "./__fixtures__/readableRuns";
import { readableTelepathicText, withReadableInstruction, uniqueTelepathicEvents } from "./displayProjection";
import { visibleTranscript } from "./transcript";
import { telepathicExportDocument } from "./export";
import { buildTelepathicConversationView } from "./conversationView";
import type { TelepathicTranscriptEvent } from "./types";
import { BrowserTelepathicExchangeRepository } from "../storage/browser/telepathicExchangeRepository";


it("all PL/EN packets keep baseline concrete messages and request fingerprints with frozen learning",async()=>{
 const expected=JSON.parse(readFileSync("src/telepathicExchange/__fixtures__/readablePackets.v1.json","utf8"));
 for(const language of ["pl","en"] as const) expect((await displayFixture(language)).snapshot).toEqual(expected[language]);
});

for (const language of ["pl","en"] as const) {
 it(`${language}: actual full engine requests, settings, fingerprints and budgets remain baseline-identical`,async()=>{
  const expected=JSON.parse(readFileSync("src/telepathicExchange/__fixtures__/readableEngine.v1.json","utf8"));const run=await actualDisplayRun(language);
  expect(JSON.parse(JSON.stringify({requests:run.requests,calls:run.calls}))).toEqual(expected[language]);
  const materials=run.result.transcript!.filter(event=>event.kind === "materials");expect(materials.length).toBeGreaterThan(8);expect(materials.every(event=>event.display?.version === 1)).toBe(true);
  const readable=materials.map(event=>readableTelepathicText(event,language === "pl")).join("\n");expect(readable).not.toMatch(/READ-ONLY|FG PRIVATE|VN PRIVATE|CURRENT_ROUND_DATA|CONTRACT:|OWN_BLIND_DATA|OWN_FIRST_BLIND_RECORD|RECEIVER ANSWERS AND REFLECTIONS/);
  expect(run.result.transcript!.filter(e=>e.kind === "instruction" && e.authorId === "lead").some(e=>e.text === "Describe motion")).toBe(true);
 });
 it(`${language}: legacy recognizes known request shapes without rewriting or stripping participant words`,async()=>{
  const {result}=await actualDisplayRun(language);const original=structuredClone(result);for(const event of result.transcript!) delete event.display;
  const raw=JSON.stringify(result);const events=visibleTranscript(result);const materials=events.filter(event=>event.kind === "materials");expect(materials.every(event=>event.display?.version === 1)).toBe(true);
  const document=telepathicExportDocument(result);expect(document).not.toMatch(/FG PRIVATE|VN PRIVATE|READ-ONLY|OWN_BLIND_DATA|CONTRACT:|CURRENT_ROUND_DATA/);expect(document).toContain("ACTUAL MODEL ANSWER with notes and system words");expect(document).toContain("Describe motion");expect(JSON.stringify(result)).toBe(raw);
  for(const event of materials) expect(readableTelepathicText(event,language === "pl")).toBe(original.transcript!.find(old=>old.id === event.id)!.display!.instruction);
 });
 it(`${language}: unknown legacy, future versions and mismatched call identities fail conservatively`,async()=>{
  const {result}=await actualDisplayRun(language);const source=result.transcript!.find(e=>e.kind === "materials")!;const event={...source};delete event.display;
  const state=structuredClone(result);state.providerCalls.find(call=>call.id === event.providerCallId)!.requestMessages=[{role:"user",content:"Unknown USER notes with PRIVATE payload"}];
  const view=withReadableInstruction(state,event);expect(view.display).toBeUndefined();expect(readableTelepathicText(view,language === "pl")).not.toMatch(/PRIVATE|Unknown USER/);
  const corrupt=structuredClone(result);corrupt.config.participants.find(p=>p.id === event.recipientIds[0])!.displayName="";expect(withReadableInstruction(corrupt,event).display).toBeUndefined();
  expect(withReadableInstruction(result,{...event,recipientIds:["other"]}).display).toBeUndefined();expect(withReadableInstruction(result,{...event,roundId:"other"}).display).toBeUndefined();
  expect(readableTelepathicText({...source,display:{version:2,instruction:"PRIVATE"} as never},language === "pl")).not.toContain("PRIVATE");
 });
 it(`${language}: readable fields and export respect the same before/after Reveal filter`,async()=>{
  const {result}=await actualDisplayRun(language);result.config.mode="conversation_exchange";result.config.participants[1].kind="human";delete result.rounds[0].revealedAt;
  const before=buildTelepathicConversationView(result);const ids=before.transcript!.map(e=>e.id);const hidden=result.transcript!.filter(e=>!ids.includes(e.id));expect(hidden.length).toBeGreaterThan(0);
  for(const event of hidden) expect(before.transcript).not.toContainEqual(event);
  const doc=telepathicExportDocument(result);expect(doc).not.toContain("FG PRIVATE");expect(doc).not.toContain("VN PRIVATE");
  const secret:TelepathicTranscriptEvent={id:"hidden-new-display",seriesId:"display",roundId:result.rounds[0].assignment.roundId,sequence:999,stage:"sender_target",kind:"materials",authorId:"controller",recipientIds:["lead"],text:"SECRET TARGET",display:{version:1,instruction:"SECRET NEW DISPLAY"},createdAt:"t"};result.transcript!.push(secret);
  expect(JSON.stringify(buildTelepathicConversationView(result))).not.toContain("SECRET NEW DISPLAY");expect(telepathicExportDocument(result)).not.toContain("SECRET NEW DISPLAY");
  result.rounds[0].revealedAt="t";expect(telepathicExportDocument(result)).toContain("SECRET NEW DISPLAY");
 });
 it(`${language}: Browser and runtime-extension persistence keep raw evidence and display side by side`,async()=>{
  const {result}=await actualDisplayRun(language);const entries=new Map<string,string>();const storage={getItem:(key:string)=>entries.get(key)??null,setItem:(key:string,value:string)=>{entries.set(key,value);},get length(){return entries.size;},clear:()=>entries.clear(),key:(index:number)=>[...entries.keys()][index]??null,removeItem:(key:string)=>{entries.delete(key);}} as Storage;
  const repository=new BrowserTelepathicExchangeRepository({storage});await repository.saveTelepathicSeries(result);const reloaded=(await new BrowserTelepathicExchangeRepository({storage}).getTelepathicSeries("display"))!;expect(reloaded.transcript).toEqual(result.transcript);expect(reloaded.providerCalls).toEqual(result.providerCalls);
  const {serializeTelepathicPlan,restoreTelepathicRuntime}=await import("./persistence");const restored=restoreTelepathicRuntime(structuredClone(result),JSON.parse(serializeTelepathicPlan(result)));expect(restored.transcript).toEqual(result.transcript);
 });
}
it("deduplicates only identical event identity, preserves identical text for different recipients",()=>{
 const event:TelepathicTranscriptEvent={id:"one",seriesId:"s",roundId:"r",sequence:1,stage:"receiver_guidance",kind:"instruction",authorId:"lead",recipientIds:["a"],text:"Describe motion",createdAt:"t"};
 const another={...event,id:"two",recipientIds:["b"],sequence:2};expect(uniqueTelepathicEvents([event,event,another])).toEqual([event,another]);
});

it("projects accepted final-map answers missing an output event without duplicating an existing author event",async()=>{
 const {result}=await actualDisplayRun("en");result.transcript=[];result.finalReflections={lead:"MAP_ONLY_LEAD",a:"MAP_ONLY_RECEIVER"};
 const raw=JSON.stringify(result);expect(visibleTranscript(result).map(e=>e.text)).toEqual(["MAP_ONLY_LEAD","MAP_ONLY_RECEIVER"]);expect(telepathicExportDocument(result)).toContain("MAP_ONLY_RECEIVER");expect(JSON.stringify(result)).toBe(raw);
 result.transcript=[{id:"accepted",seriesId:"display",sequence:1,stage:"series_reflection",kind:"reflection",authorId:"lead",recipientIds:[],text:"EXACT_ACCEPTED_OUTPUT",createdAt:"t"}];expect(visibleTranscript(result).map(e=>e.text)).toEqual(["EXACT_ACCEPTED_OUTPUT","MAP_ONLY_RECEIVER"]);
});
