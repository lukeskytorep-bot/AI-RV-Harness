import { describe, expect, it, vi } from "vitest";
import { workflowTestRepository } from "../testing/workflowRepository";
import type { AppRepository } from "../storage/repository";
import type { JudgeProviderRequest } from "../judge/engine";
import { runBlindJudging } from "../judge/engine";
import { ProviderCallError } from "../providers/providerError";
import type { ProviderChatResponse, ProviderConfig, ProviderModel } from "../providers/types";
import type { JudgeScoreRecord } from "../judge/types";
import type { ResearchProjectRecord } from "./types";
import { judgeResearch } from "./engine";
import { createResearchJudgeRequestRecovery, RESEARCH_JUDGE_REQUEST, ResearchJudgeCheckpointError } from "./judgeRequestRecovery";
import { getUncertainResearchJudges } from "./judgeRecovery";

import { fixture, model, provider, request, output, lost } from "../testing/researchJudgeRecoveryFixture";
describe("Research automatic Judge recovery", () => {
  it("retries a lost transport exactly once without an operator decision", async () => {
    const f = fixture(); f.chat.mockRejectedValueOnce(lost()); await f.run();
    expect(f.chat).toHaveBeenCalledTimes(2); expect(f.chat.mock.calls[0]).toEqual(f.chat.mock.calls[1]);
    expect((await f.repo.listJudgeScores("s"))).toHaveLength(1); expect(f.project.state).toBe("ScoresFrozen");
  });
  it("persists exhaustion across restarts and never renews the transport allowance", async () => {
    const f = fixture(); f.chat.mockRejectedValue(lost()); await expect(f.run()).rejects.toThrow();
    expect(f.chat).toHaveBeenCalledTimes(2); await expect(f.run()).rejects.toThrow(/exhausted/); expect(f.chat).toHaveBeenCalledTimes(2);
    expect(await getUncertainResearchJudges(f.repo, "r")).toHaveLength(1);
  });
  it("retains an unsaved receipt under a stable owner across new workflow adapters", async () => {
    const f = fixture(), save = f.repo.appendSessionEvent.bind(f.repo); let broken = true;
    f.repo.appendSessionEvent = async (id, event) => { if (broken && event.eventType === RESEARCH_JUDGE_REQUEST && event.metadata?.status === "received") throw new Error("disk full"); return save(id, event); };
    await expect(f.run()).rejects.toBeInstanceOf(ResearchJudgeCheckpointError); expect(f.chat).toHaveBeenCalledTimes(1);
    broken = false; await f.run(); expect(f.chat).toHaveBeenCalledTimes(1); expect(await f.repo.listJudgeScores("s")).toHaveLength(1);
    expect((await f.repo.listSessionEvents("s")).some(e => e.metadata?.status === "uncertain")).toBe(false);
  });
  it("reprocesses a durable receipt after freeze failure using a fresh recovery owner", async () => {
    const f = fixture(), freeze = f.repo.recordFrozenJudgeResults!.bind(f.repo); let broken = true;
    f.repo.recordFrozenJudgeResults = async items => { if (broken) throw new Error("freeze write failed"); return freeze(items); };
    await expect(f.run()).rejects.toThrow("freeze write failed"); expect(f.chat).toHaveBeenCalledTimes(1); broken = false;
    await judgeResearch({ repository: f.repo, recoveryOwner: {}, projectId: "r", judgeRunner: i => runBlindJudging({ ...i, onAttemptStart: undefined, chat: f.chat }) });
    expect(f.chat).toHaveBeenCalledTimes(1); expect(await f.repo.listJudgeScores("s")).toHaveLength(1);
  });
  it("inspects an ambiguous committed receipt before replay and never duplicates it", async () => {
    const f = fixture(), save = f.repo.appendSessionEvent.bind(f.repo); let broken = true;
    f.repo.appendSessionEvent = async (id, event) => { const result = await save(id, event); if (broken && event.eventType === RESEARCH_JUDGE_REQUEST && event.metadata?.status === "received") throw new Error("commit acknowledgement lost"); return result; };
    await expect(f.run()).rejects.toBeInstanceOf(ResearchJudgeCheckpointError); broken = false; await f.run();
    expect(f.chat).toHaveBeenCalledTimes(1); expect((await f.repo.listSessionEvents("s")).filter(e => e.eventType === RESEARCH_JUDGE_REQUEST && e.metadata?.status === "received")).toHaveLength(1);
  });
  it("checkpoint failure before dispatch sends nothing", async () => {
    const f = fixture(); f.repo.appendSessionEvent = async () => { throw new Error("disk full"); };
    await expect(f.recover()(request, f.chat)).rejects.toBeInstanceOf(ResearchJudgeCheckpointError); expect(f.chat).not.toHaveBeenCalled();
  });
  it("replays historical RESEARCH_JUDGE_RESPONSE through validators without repurchasing the score", async () => {
    const f = fixture(); f.project.state = "Judging";
    await f.repo.appendSessionEvent("s", { eventType: "RESEARCH_JUDGE_RESPONSE", role: "controller", content: output, metadata: { modelRoute: model.route, finishReason: "stop" } });
    await f.run(); expect(f.chat).not.toHaveBeenCalled(); expect(await f.repo.listJudgeScores("s")).toHaveLength(1);
  });
  it("replays invalid JSON then the existing formatter exactly once across a freeze failure", async () => {
    const f = fixture(); f.chat.mockResolvedValueOnce({ content: "invalid JSON", finishReason: "stop", usage: {} });
    const freeze = f.repo.recordFrozenJudgeResults!.bind(f.repo); f.repo.recordFrozenJudgeResults = vi.fn().mockRejectedValueOnce(new Error("freeze failed")).mockImplementation(freeze);
    await expect(f.run()).rejects.toThrow("freeze failed"); expect(f.chat).toHaveBeenCalledTimes(2);
    await f.run(); expect(f.chat).toHaveBeenCalledTimes(2); expect(await f.repo.listJudgeScores("s")).toHaveLength(1);
  });
  it("rejects a changed frozen request after restart", async () => {
    const f = fixture(); await f.recover()(request, f.chat);
    await expect(f.recover()({ ...request, config: { ...provider, baseUrl: "https://changed.test" } }, f.chat)).rejects.toThrow(/changed/); expect(f.chat).toHaveBeenCalledTimes(1);
  });
  it("does not retry unknown/configuration failures", async () => {
    const f = fixture(); f.chat.mockRejectedValue(new ProviderCallError({ code: "configuration", phase: "before_dispatch", message: "invalid credentials" }));
    await expect(f.run()).rejects.toThrow(); expect(f.chat).toHaveBeenCalledTimes(1);
    await expect(f.run()).rejects.toThrow(/not retryable/); expect(f.chat).toHaveBeenCalledTimes(1);
  });
  it("STOP during transport failure never retries", async () => {
    const f = fixture(), stop = new AbortController(); f.chat.mockImplementation(async () => { stop.abort(); throw lost(); });
    await expect(f.run(stop.signal)).rejects.toThrow(); expect(f.chat).toHaveBeenCalledTimes(1);
  });
  it("rejects conflicting RAM and durable receipts without overwrite", async () => {
    const f = fixture(), save = f.repo.appendSessionEvent.bind(f.repo); let receipt: Record<string, unknown> | undefined;
    f.repo.appendSessionEvent = async (id, event) => { if (event.eventType === RESEARCH_JUDGE_REQUEST && event.metadata?.status === "received") { receipt = event.metadata; throw new Error("disk full"); } return save(id, event); };
    await expect(f.recover()(request, f.chat)).rejects.toThrow();
    f.repo.appendSessionEvent = save; await save("s", { eventType: RESEARCH_JUDGE_REQUEST, role: "controller", metadata: { ...receipt, response: { content: "conflicting receipt" } } });
    await expect(f.recover()(request, f.chat)).rejects.toThrow(/conflicts/); expect(f.chat).toHaveBeenCalledTimes(1);
  });
});

it("Research transport grant saved before STOP is consumed once by a later explicit run", async () => {
 const f = fixture(), stop = new AbortController(), save = f.repo.appendSessionEvent.bind(f.repo); f.chat.mockRejectedValueOnce(lost());
 f.repo.appendSessionEvent = async (id, event) => { const result = await save(id, event); if (event.eventType === RESEARCH_JUDGE_REQUEST && event.metadata?.status === "retry_granted") stop.abort(); return result; };
 await expect(f.run(stop.signal)).rejects.toThrow(); expect(f.chat).toHaveBeenCalledTimes(1);
 f.repo.appendSessionEvent = save; await f.run(); expect(f.chat).toHaveBeenCalledTimes(2); expect(await f.repo.listJudgeScores("s")).toHaveLength(1);
 expect((await f.repo.listSessionEvents("s")).filter(e => e.eventType === RESEARCH_JUDGE_REQUEST && e.metadata?.status === "retry_granted")).toHaveLength(1);
});
it("Research never dispatches the child if saving its grant fails", async () => {
 const f = fixture(), save = f.repo.appendSessionEvent.bind(f.repo); f.chat.mockRejectedValueOnce(lost());
 f.repo.appendSessionEvent = async (id, event) => { if (event.eventType === RESEARCH_JUDGE_REQUEST && event.metadata?.status === "retry_granted") throw new Error("disk full"); return save(id,event); };
 await expect(f.run()).rejects.toBeInstanceOf(ResearchJudgeCheckpointError); expect(f.chat).toHaveBeenCalledTimes(1);
 f.repo.appendSessionEvent = save; await f.run(); expect(f.chat).toHaveBeenCalledTimes(2);
});
it("Research an ambiguous frozen-score commit never duplicates a score or calls the Judge again", async () => {
 const f = fixture(), freeze = f.repo.recordFrozenJudgeResults!.bind(f.repo);
 f.repo.recordFrozenJudgeResults = async items => { await freeze(items); throw new Error("freeze commit acknowledgement lost"); };
 await expect(f.run()).rejects.toThrow(); expect(await f.repo.listJudgeScores("s")).toHaveLength(1);
 await f.run(); expect(f.chat).toHaveBeenCalledTimes(1); expect(await f.repo.listJudgeScores("s")).toHaveLength(1);
});
it("Research malformed saved requests fail closed before dispatch", async () => {
 const f = fixture(); await f.repo.appendSessionEvent("s", { eventType: RESEARCH_JUDGE_REQUEST, role: "controller", metadata: { modelRoute: model.route, judgeIndex: 1, ordinal: 0, hash: "bad", status: "received", retryUsed: false } });
 await expect(f.recover()(request, f.chat)).rejects.toThrow(/Invalid/); expect(f.chat).not.toHaveBeenCalled();
});
it("Research output exhaustion remains a validation block across Resume", async () => {
 const f = fixture(); f.chat.mockResolvedValue({ content: "partial candidate", finishReason: "length", usage: {} });
 await expect(f.run()).rejects.toThrow(); expect(f.chat).toHaveBeenCalledTimes(2);
 expect(await getUncertainResearchJudges(f.repo,"r")).toHaveLength(1);
 await expect(f.run()).rejects.toThrow(/validation exhausted/); expect(f.chat).toHaveBeenCalledTimes(2); expect(await f.repo.listJudgeScores("s")).toHaveLength(0);
});
it("Research buffers use the stable root across distinct workflow adapters", async () => {
 const f = fixture(), root = f.repo, save = f.repo.appendSessionEvent.bind(f.repo);let broken = true;
 root.withWorkflowOwnership = async (scope, task) => task(new Proxy(root, { get(target,key) { if (key === "recoveryOwner") return root; const value=Reflect.get(target,key);return typeof value === "function" ? value.bind(target) : value; } }), scope.signal ?? new AbortController().signal);
 root.appendSessionEvent = async (id, event) => { if (broken && event.eventType === RESEARCH_JUDGE_REQUEST && event.metadata?.status === "received") throw new Error("disk full"); return save(id,event); };
 await expect(f.run()).rejects.toBeInstanceOf(ResearchJudgeCheckpointError);broken=false;await f.run();expect(f.chat).toHaveBeenCalledTimes(1);
});

it("Research keeps two selected Judges on the same model route independent", async () => {
 const f = fixture(); f.project.config.judges.push({ providerConfigId: "pc", modelId: "m" });
 await f.run();expect(f.chat).toHaveBeenCalledTimes(2);
 const scores = await f.repo.listJudgeScores("s");expect(scores).toHaveLength(2);expect(scores[0].judgeRunId).not.toBe(scores[1].judgeRunId);
 const receipts = (await f.repo.listSessionEvents("s")).filter(e=>e.eventType===RESEARCH_JUDGE_REQUEST && e.metadata?.status==="received");
 expect(receipts.map(e=>e.metadata?.judgeIndex)).toEqual([1,2]);
});

for (const sameRoute of [true, false]) it(`Research completed first slot cannot mask second exhaustion; same route=${sameRoute}`, async () => {
 const f=fixture();
 f.project.config.judges.push({providerConfigId:"pc",modelId:sameRoute?"m":"other"});
 if(!sameRoute)f.repo.listProviderModels=async()=>[model,{...model,modelId:"other",route:"local:other"}];
 f.chat.mockResolvedValueOnce({content:output,finishReason:"stop",usage:{}}).mockRejectedValue(lost());
 await expect(f.run()).rejects.toThrow();expect(f.chat).toHaveBeenCalledTimes(3);
 expect(await f.repo.listJudgeScores("s")).toHaveLength(1);
 expect(await getUncertainResearchJudges(f.repo,"r")).toEqual([{sessionId:"s",modelRoute:sameRoute?model.route:"local:other"}]);
 // A fresh root has no RAM: the durable allowance remains exhausted.
 const restarted={...f.repo,recoveryOwner:{}};
 expect(await getUncertainResearchJudges(restarted,"r")).toHaveLength(1);
 await expect(judgeResearch({repository:restarted,projectId:"r",judgeRunner:i=>runBlindJudging({...i,onAttemptStart:undefined,chat:f.chat})})).rejects.toThrow(/exhausted/);
 expect(f.chat).toHaveBeenCalledTimes(3);
});

it("Research RAM availability is owner scoped and a restart cannot invent a saved response",async()=>{
 const f=fixture(),save=f.repo.appendSessionEvent.bind(f.repo);f.chat.mockRejectedValueOnce(lost());
 f.repo.appendSessionEvent=async(id,event)=>{if(event.eventType===RESEARCH_JUDGE_REQUEST && event.metadata?.status==="received")throw new Error("disk full");return save(id,event);};
 await expect(f.run()).rejects.toBeInstanceOf(ResearchJudgeCheckpointError);
 expect(await getUncertainResearchJudges(f.repo,"r")).toHaveLength(0);
 expect(await getUncertainResearchJudges({...f.repo,recoveryOwner:{}},"r")).toHaveLength(1);
 f.repo.appendSessionEvent=save;await f.run();expect(f.chat).toHaveBeenCalledTimes(2);
});

it("Research validation blocks are slot scoped; historical unindexed blocks remain conservative",async()=>{
 const f=fixture();f.project.state="Judging";
 await f.repo.appendSessionEvent("s",{eventType:"RESEARCH_JUDGE_VALIDATION_BLOCK",role:"controller",metadata:{modelRoute:model.route,judgeIndex:2}});
 expect(await getUncertainResearchJudges(f.repo,"r")).toHaveLength(0);
 await f.run();expect(f.chat).toHaveBeenCalledTimes(1);
 const legacy=fixture();legacy.project.state="Judging";
 await legacy.repo.appendSessionEvent("s",{eventType:"RESEARCH_JUDGE_VALIDATION_BLOCK",role:"controller",metadata:{modelRoute:model.route}});
 expect(await getUncertainResearchJudges(legacy.repo,"r")).toHaveLength(1);
 await expect(legacy.run()).rejects.toThrow(/validation exhausted/);expect(legacy.chat).not.toHaveBeenCalled();
});

it("Research scopes a second Judge validation failure and does not assign a legacy score twice",async()=>{
 const f=fixture();f.project.config.judges.push({providerConfigId:"pc",modelId:"m"});
 f.chat.mockResolvedValueOnce({content:output,finishReason:"stop",usage:{}}).mockResolvedValue({content:"invalid",finishReason:"stop",usage:{}});
 await expect(f.run()).rejects.toThrow();expect(f.chat).toHaveBeenCalledTimes(3);
 const events=await f.repo.listSessionEvents("s");
 expect(events.find(e=>e.eventType==="RESEARCH_JUDGE_VALIDATION_BLOCK")?.metadata?.judgeIndex).toBe(2);
 const read=f.repo.listJudgeScores.bind(f.repo);
 f.repo.listJudgeScores=async id=>(await read(id)).map(s=>({...s,judgeIndex:undefined})) as unknown as JudgeScoreRecord[];
 expect(await getUncertainResearchJudges(f.repo,"r")).toHaveLength(1);
 await expect(f.run()).rejects.toThrow(/validation exhausted/);expect(f.chat).toHaveBeenCalledTimes(3);
});

it("Research legacy request records without slot identity cannot unlock a missing second Judge",async()=>{
 const f=fixture();f.project.config.judges.push({providerConfigId:"pc",modelId:"m"});
 f.chat.mockResolvedValueOnce({content:output,finishReason:"stop",usage:{}}).mockRejectedValue(lost());
 await expect(f.run()).rejects.toThrow();
 await f.repo.appendSessionEvent("s",{eventType:RESEARCH_JUDGE_REQUEST,role:"controller",metadata:{modelRoute:model.route,ordinal:0,status:"dispatched",retryUsed:true}});
 expect(await getUncertainResearchJudges(f.repo,"r")).toHaveLength(1);
 await expect(f.run()).rejects.toThrow(/slot identity/);expect(f.chat).toHaveBeenCalledTimes(3);
});
