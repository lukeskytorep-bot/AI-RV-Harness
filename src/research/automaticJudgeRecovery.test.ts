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

const output = JSON.stringify({ scores: { gestalt: 2, verifiableFeatures: 2, activityFunctionEvent: 1, confabulationControl: 1 }, strongestMatches: ["The target structure matches."], majorMissesContradictions: [], confabulationObservations: [], conciseRationale: "The evidence matches the target." });
const provider: ProviderConfig = { id: "pc", provider: "custom_openai", label: "P", credentialId: "c", credentialFingerprint: "f", baseUrl: "https://example.test/v1", enabled: true, createdAt: "t", updatedAt: "t" };
const model = { providerConfigId: "pc", provider: "custom_openai", modelId: "m", displayName: "M", recommended: true, rawMetadata: {}, refreshedAt: "t", route: "local:m", capabilities: { contextTokens: 262144, maxOutputTokens: 65536, inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: false, reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: false, confidence: "unknown" }, supportedParameters: ["max_tokens"], source: "provider", capturedAt: "t" }, pricing: {} } as ProviderModel;
const request: JudgeProviderRequest = { config: provider, modelId: "m", messages: [{ role: "user", content: "frozen packet" }], settings: { requested: {}, effective: {}, omitted: [] } };
const lost = () => new ProviderCallError({ code: "response_body_read", phase: "reading_body", message: "connection lost" });
function fixture() {
  let scores: JudgeScoreRecord[] = [];
  const project = { id: "r", state: "SessionsComplete", config: { sessionLanguage: "en", judges: [{ providerConfigId: "pc", modelId: "m" }] } } as ResearchProjectRecord;
  const repo = workflowTestRepository({
    getResearchProject: async () => project, setResearchProjectState: vi.fn(async (_id, state) => { project.state = state; }),
    listResearchAssignments: async () => [{ id: "a", sessionId: "s", status: scores.length ? "Judged" : "SessionComplete", judgeOrder: 1, anonymousSessionId: "BlindSession_ABCDEF12" }],
    listProviderConfigs: async () => [provider], listProviderModels: async () => [model],
    listJudgeScores: async () => structuredClone(scores),
    getReveal: async () => ({ text: "A stone bridge", artifactManifest: [] }), getViewerEvidence: async () => "A horizontal stone structure over water.", getSessionSnapshot: async () => ({ sessionLanguage: "en" }),
    recordFrozenJudgeResults: vi.fn(async (items) => {
      scores = [...scores, ...items.map(({ run, score }: { run: { id: string; modelRoute: string; judgeIndex: number }; score: JudgeScoreRecord }) => ({ ...score, judgeRunId: run.id, modelRoute: run.modelRoute, judgeIndex: run.judgeIndex, total: 6, frozenAt: "t", createdAt: "t" }))]; return structuredClone(scores);
    }), updateResearchAssignment: vi.fn(),
  } as unknown as AppRepository);
  const chat = vi.fn(async (): Promise<ProviderChatResponse> => ({ content: output, finishReason: "stop", usage: { totalTokens: 20 }, providerRequestId: "paid-1" }));
  const run = (signal?: AbortSignal) => judgeResearch({ repository: repo, projectId: "r", signal, judgeRunner: input => runBlindJudging({ ...input, onAttemptStart: undefined, chat }) });
  const recover = (owner: object = repo, signal?: AbortSignal) => createResearchJudgeRequestRecovery({ repository: repo, owner, sessionId: "s", modelRoute: model.route, signal });
  return { repo, chat, run, recover, project };
}
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
