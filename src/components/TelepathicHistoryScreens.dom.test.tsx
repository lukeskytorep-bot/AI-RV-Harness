// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TelepathicTrainingPanel } from "../features/training/TelepathicTrainingPanel";
import { TelepathicExchangePanel } from "../features/conversations/TelepathicExchangePanel";
import { BrowserTelepathicExchangeRepository } from "../storage/browser/telepathicExchangeRepository";
import { createTelepathicSeriesState } from "../telepathicExchange/engine";
import { setTelepathicArchived } from "../telepathicExchange/archive";
import * as gateway from "../telepathicExchange/providerGateway";
import { createDefaultSettings } from "../startupDefaults";
import { getCopy } from "../i18n";
import type { AppRepository } from "../storage/repository";
import type { Profile, Workspace } from "../types";
import type { TelepathicMode, TelepathicSeriesConfig } from "../telepathicExchange/types";

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

for (const pl of [false, true]) for (const mode of ["ai_ai_training", "conversation_exchange"] as const) {
  it(`${mode}/${pl ? "PL" : "EN"}: hides archive, archives current once, restores on remount without dispatch`, async () => {
    const repository = Object.assign(new BrowserTelepathicExchangeRepository({ storage: localStorage }), {
      listProviderConfigs: vi.fn(async () => []), listProviderModels: vi.fn(async () => []),
    }) as unknown as AppRepository;
    const participant = (id: string) => ({ id, kind: "ai" as const, displayName: `Participant ${id}`, ai: { profileId: id, profileName: id, workspaceId: "w", aiIdentityId: id, providerConfigId: id, credentialId: id, credentialFingerprint: id, modelId: id, route: id } });
    const config: TelepathicSeriesConfig = { schemaVersion: 1, protocolVersion: "fixed_lead_v1", leadInstructionVersion: "fixed_lead_guidance_v1", maxGuidanceCycles: 3, seriesId: "active", seriesWorkspaceId: "w", mode: mode as TelepathicMode,
      language: pl ? "pl" : "en", participants: [participant("lead"), participant("a")], senderPolicy: { kind: "fixed_ai", participantId: "lead" },
      roundCount: 2, topic: "any", discloseTopicToReceivers: false };
    const active = createTelepathicSeriesState(config); active.status = "paused";
    active.providerCalls = [{ id: "missing", seriesId: "active", roundId: "r", participantId: "a", callStage: "receiver_first", technicalAttempt: 1, status: "succeeded", scopeKey: "k", requestSha256: "h", createdAt: "t", updatedAt: "t" }];
    const archived = createTelepathicSeriesState({ ...config, seriesId: "archived" }); archived.archivedAt = "2026-10-12T12:00:00Z"; archived.archiveRevision = 1; archived.status = "blocked";
    archived.providerCalls = [{ id: "uncertain", seriesId: "archived", roundId: archived.rounds[0].assignment.roundId, participantId: "lead", callStage: "sender_target", technicalAttempt: 1, status: "uncertain", scopeKey: "unknown", requestSha256: "h", createdAt: "t", updatedAt: "t" }];
    await repository.saveTelepathicSeries(active); await repository.saveTelepathicSeries(archived);
    const dispatch = vi.spyOn(gateway, "executeTelepathicProviderPacket");
    const settings = { ...createDefaultSettings(), interfaceLanguage: pl ? "pl" as const : "en" as const, sessionLanguage: pl ? "pl" as const : "en" as const };
    const shared = { repository, settings, copy: getCopy(settings.interfaceLanguage), profiles: [] as Profile[], workspaces: [] as Workspace[] };
    await act(async () => root.render(mode === "ai_ai_training" ? <TelepathicTrainingPanel {...shared} /> : <TelepathicExchangePanel {...shared} profile={{ id: "human", name: "Human" } as Profile} workspace={{ id: "w" } as Workspace} />));
    const history = host.querySelector(".telepathic-history")!;
    expect(history.querySelectorAll("article")).toHaveLength(1); expect(history.querySelector('input[type="checkbox"]')).toBeNull();
    const missing = pl ? "brak danych" : "unavailable";
    expect(host.querySelector(".session-run-metrics > span:nth-child(2) strong")?.textContent).toBe(missing);
    expect(host.querySelector(".session-run-metrics > span:nth-child(3) strong")?.textContent).toBe(missing);
    const roundSelector = mode === "ai_ai_training" ? ".telepathic-round-tabs button.active" : ".telepathic-schedule button.active";
    const viewed = host.querySelector(roundSelector)?.textContent;
    const toggle = history.querySelector<HTMLButtonElement>(".training-history-toggle")!;
    await act(async () => toggle.click()); expect(history.querySelector("aside")?.hidden).toBe(true);
    await act(async () => toggle.click()); expect(host.querySelector(roundSelector)?.textContent).toBe(viewed);
    expect(history.querySelector(".telepathic-history-archived")).toBeNull();
    const summary=vi.spyOn(repository,"listTelepathicSeriesSummaries");
    await act(async()=>history.querySelector<HTMLButtonElement>(`button[aria-label="${pl?"Archiwizuj":"Archive"} ${mode==="ai_ai_training"?(pl?"trening":"training"):(pl?"wymianę":"exchange")}"]`)!.click());
    expect(history.querySelectorAll("article")).toHaveLength(0);expect(summary).toHaveBeenCalledTimes(1);
    expect(host.querySelector(".telepathic-runtime-metrics")).toBeNull();
    expect((await repository.getTelepathicSeries("active"))?.providerCalls).toEqual(active.providerCalls);
    await setTelepathicArchived(repository,"active",false);
    await act(async()=>root.unmount());root=createRoot(host);
    await act(async()=>root.render(mode === "ai_ai_training" ? <TelepathicTrainingPanel {...shared}/> : <TelepathicExchangePanel {...shared} profile={{id:"human",name:"Human"} as Profile} workspace={{id:"w"} as Workspace}/>));
    expect(host.querySelectorAll(".telepathic-history article")).toHaveLength(1);
    expect((await repository.getTelepathicSeries("archived"))?.providerCalls).toEqual(archived.providerCalls);
    expect(dispatch).not.toHaveBeenCalled();
  });
}

for(const mode of ["ai_ai_training","conversation_exchange"] as const)for(const operation of ["other","write-failure","other-owner","read-failure"] as const)it(`${mode}: ${operation} preserves the current view and archive safety`,async()=>{
 const repository=Object.assign(new BrowserTelepathicExchangeRepository({storage:localStorage}),{listProviderConfigs:async()=>[],listProviderModels:async()=>[]}) as unknown as AppRepository;
 const ai=(id:string)=>({id,kind:"ai" as const,displayName:id,ai:{profileId:id,profileName:id,workspaceId:"w",aiIdentityId:id,providerConfigId:"c",credentialId:"k",credentialFingerprint:"f",modelId:"m",route:"m"}});
 const make=(id:string,t:string)=>createTelepathicSeriesState({schemaVersion:1,seriesId:id,seriesWorkspaceId:"w",mode,language:"en",protocolVersion:"fixed_lead_v1",leadInstructionVersion:"v1",maxGuidanceCycles:3,participants:[ai(id),ai("receiver")],senderPolicy:{kind:"fixed_ai",participantId:id},roundCount:1,topic:"any",discloseTopicToReceivers:false},t);
 const newest=make("newest","2026-10-13T02:00:00Z"),older=make("older","2026-10-12T02:00:00Z");newest.status=older.status="paused";
 await repository.saveTelepathicSeries(newest);await repository.saveTelepathicSeries(older);
 const dispatch=vi.spyOn(gateway,"executeTelepathicProviderPacket");
 const props={repository,settings:createDefaultSettings(),copy:getCopy("en"),profiles:[] as Profile[],workspaces:[] as Workspace[]};
 await act(async()=>root.render(mode==="ai_ai_training"?<TelepathicTrainingPanel {...props}/>:<TelepathicExchangePanel {...props} profile={{id:"human",name:"Human"} as Profile} workspace={{id:"w"} as Workspace}/>));
 const summaries=vi.spyOn(repository,"listTelepathicSeriesSummaries"),save=vi.spyOn(repository,"saveTelepathicSeries");
 let release!:()=>void;let held:Promise<void>|undefined;
 if(operation==="read-failure")summaries.mockRejectedValueOnce(new Error("ARCHIVE_LIST_FAILED"));
 if(operation==="write-failure")save.mockRejectedValueOnce(new Error("ARCHIVE_WRITE_FAILED"));
 if(operation==="other-owner")held=repository.withTelepathicSeriesLease("older",()=>new Promise<void>(r=>{release=r;}));
 try{
  if(held)await new Promise(r=>setTimeout(r,0));
  const card=host.querySelectorAll(".telepathic-history article")[1];
  await act(async()=>card.querySelector<HTMLButtonElement>(`button[aria-label="Archive ${mode==="ai_ai_training"?"training":"exchange"}"]`)!.click());
  expect(host.querySelector(".telepathic-runtime-metrics")).not.toBeNull();expect(host.textContent).toContain("newest");
  expect(host.querySelectorAll(".telepathic-history article")).toHaveLength(operation==="other"||operation==="read-failure"?1:2);
  expect((await repository.getTelepathicSeries("newest"))!.archivedAt).toBeUndefined();
  const stored=(await repository.getTelepathicSeries("older"))!;
  expect(Boolean(stored.archivedAt)).toBe(operation==="other"||operation==="read-failure");expect(stored.providerCalls).toEqual(older.providerCalls);expect(stored.plan).toEqual(older.plan);
  if(operation==="other")expect(summaries).toHaveBeenCalledTimes(1);
  if(operation==="read-failure")expect(host.textContent).toContain("ARCHIVE_LIST_FAILED");
  if(operation==="write-failure")expect(host.textContent).toContain("ARCHIVE_WRITE_FAILED");
  if(operation==="other-owner")expect(save).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
 }finally{if(held){release();await held;}}
});
