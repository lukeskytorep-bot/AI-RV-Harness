import { telepathicExecutionStore } from "../components/useTelepathicExecution";
import type { TelepathicExchangeRepository } from "../storage/contracts/telepathicExchangeRepository";
import { describe, expect, it, vi } from "vitest";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import type { TelepathicParticipant, TelepathicSeriesState } from "./types";
import type { ProviderChatAttempt } from "../providers/requestExecutor";
import type { ResolvedTelepathicAiRoute } from "./providerGateway";
import { ProviderCallError } from "../providers/providerError";
import { createTelepathicSeriesState, runNextTelepathicAiRound, advanceTelepathicConversationSeries, runTelepathicFinalReflections, resumeBlockedTelepathicSeries, setTelepathicRecoveryPolicy, revalidateTelepathicConfiguration } from "./engine";
import type { TelepathicExchangeEngineDependencies } from "./engine";
import { InMemoryTelepathicExchangeStore } from "./store";
import { AUTOMATIC_TELEPATHIC_RECOVERY, telepathicRecoveryDecision, hasRecoverableTelepathicResponse } from "./recovery";
import { buildTelepathicConversationView } from "./conversationView";
import { serializeTelepathicPlan, restoreTelepathicRuntime } from "./persistence";
function ai(id: string): TelepathicParticipant {
  return {
    id,
    kind: "ai",
    displayName: id.toUpperCase(),
    ai: {
      profileId: `profile-${id}`,
      profileName: id.toUpperCase(),
      workspaceId: `workspace-${id}`,
      aiIdentityId: `identity-${id}`,
      providerConfigId: `provider-${id}`,
      credentialId: `credential-${id}`,
      credentialFingerprint: `fingerprint-${id}`,
      modelId: `model-${id}`,
      route: `custom_openai:model-${id}`,
    },
  };
}

function model(id: string): ProviderModel {
  return {
    providerConfigId: `provider-${id}`,
    provider: "custom_openai",
    modelId: `model-${id}`,
    displayName: `${id} model`,
    route: `custom_openai:model-${id}`,
    capabilities: {
      contextTokens: 64_000,
      maxOutputTokens: 4096,
      inputModalities: ["text"],
      outputModalities: ["text"],
      supportsVision: false,
      supportsStreaming: false,
      reasoning: { supported: false, efforts: [], confidence: "unknown" },
      temperature: { supported: true, min: 0, max: 2, confidence: "provider_metadata" },
      supportedParameters: ["temperature"],
      source: "provider",
      capturedAt: "2026-10-06T20:00:00.000Z",
    },
    pricing: {},
    recommended: true,
    rawMetadata: {},
    refreshedAt: "2026-10-06T20:00:00.000Z",
  };
}

function configFor(id: string): ProviderConfig {
  return {
    id: `provider-${id}`,
    provider: "custom_openai",
    label: id,
    credentialId: `credential-${id}`,
    credentialFingerprint: `fingerprint-${id}`,
    baseUrl: "https://example.test/v1",
    enabled: true,
    createdAt: "2026-10-06T20:00:00.000Z",
    updatedAt: "2026-10-06T20:00:00.000Z",
  };
}



const outage = () => new ProviderCallError({ code: "response_body_read", phase: "reading_body", message: "connection closed while reading response body" });
async function setup(mode: "ai_ai_training" | "conversation_exchange", fixed: boolean) {
 const store = new InMemoryTelepathicExchangeStore();
 const initial = createTelepathicSeriesState({ schemaVersion: 1, seriesId: "auto", seriesWorkspaceId: "w", mode, language: "en", participants: [ai("a"), ai("b")], roundCount: 1, topic: "any", discloseTopicToReceivers: false, senderPolicy: fixed ? { kind: "fixed_ai", participantId: "a" } : { kind: "rotate" }, recoveryPolicy: { ...AUTOMATIC_TELEPATHIC_RECOVERY }, ...(fixed ? { protocolVersion: "fixed_lead_v1" as const, maxGuidanceCycles: 3 as const } : {}) });
 await store.saveTelepathicSeries(initial);
 const route = async (p: TelepathicParticipant): Promise<ResolvedTelepathicAiRoute> => ({ snapshot: p.ai!, providerConfig: configFor(p.id), model: { ...model(p.id), capabilities: { ...model(p.id).capabilities, contextTokens: 262144, maxOutputTokens: 65536 } }, requestedSettings: {}, validatedIdentity: { profileId: p.ai!.profileId, workspaceId: p.ai!.workspaceId, aiIdentityId: p.ai!.aiIdentityId, credentialFingerprint: p.ai!.credentialFingerprint } });
 const snapshots = new Map<string, TelepathicSeriesState>();
 const save = store.saveTelepathicSeries.bind(store);
 store.saveTelepathicSeries = async state => { await save(state); for (const call of state.providerCalls) if (call.status === "succeeded" && !snapshots.has(call.callStage)) snapshots.set(call.callStage, structuredClone(state)); };
 let generation = 0;
 const attempt = vi.fn<ProviderChatAttempt>(async (r: Parameters<import("../providers/requestExecutor").ProviderChatAttempt>[0]) => {
  const text = r.messages.map(m => m.content).join("\n");
  const content = text.includes("CONTRACT:") ? JSON.stringify({ cycle: 1, finishRound: true, finishParticipantIds: [], individual: [] }) : text.includes("Reply YES or NO") ? "NO" : "Distinct complete target or response.";
  return { content, finishReason: "stop", usage: { totalTokens: 17, costUsd: 0.01 }, providerRequestId: `generation-${++generation}` };
 });
 const deps = { store, resolveRoute: route, providerAttempt: attempt };
 const runner = mode === "conversation_exchange" ? advanceTelepathicConversationSeries : runNextTelepathicAiRound;
 const run = async (overrides: Partial<TelepathicExchangeEngineDependencies> = {}) => { let result = await runner({ ...deps, ...overrides }, "auto"); if (!fixed && result.status === "completed") result = await runTelepathicFinalReflections({ ...deps, ...overrides }, "auto"); return result; };
 return { store, route, attempt, deps, run, snapshots, initial };
}
const targetRequest = (text: string) => text.includes("please prepare one specific target");
describe.each([{ mode: "ai_ai_training" as const, fixed: false }, { mode: "conversation_exchange" as const, fixed: false }, { mode: "ai_ai_training" as const, fixed: true }, { mode: "conversation_exchange" as const, fixed: true }])("automatic transport recovery $mode fixed=$fixed", ({ mode, fixed }) => {
 it("continues without operator interaction, preserving the request and output level", async () => {
  const f = await setup(mode, fixed); const live = f.attempt.getMockImplementation()!; let failed = false;
  f.attempt.mockImplementation(async request => { if (!failed) { failed = true; throw outage(); } return live(request); });
  const result = await f.run(); expect(result.status).toBe("completed");
  const target = result.providerCalls.filter(c => c.callStage === "sender_target"); expect(target).toHaveLength(2);
  expect(target.map(c => c.technicalAttempt)).toEqual([1, 1]); expect(target[0].recovery?.action).toBe("transport_retry");
  expect(target[1].retryOfCallId).toBe(target[0].id); expect(target[1].requestSha256).toBe(target[0].requestSha256);
  expect(f.attempt.mock.calls[0][0].messages).toEqual(f.attempt.mock.calls[1][0].messages);
  expect(f.attempt.mock.calls[0][0].settings).toEqual(f.attempt.mock.calls[1][0].settings);
  expect(result.providerCalls.filter(c => c.recovery?.action === "transport_retry")).toHaveLength(1);
 });
 it("persists exhaustion across restart and policy toggles without another request", async () => {
  const f = await setup(mode, fixed); f.attempt.mockImplementation(async () => { throw outage(); });
  await expect(f.run()).rejects.toThrow("transport recovery"); expect(f.attempt).toHaveBeenCalledTimes(2);
  const blocked = (await f.store.getTelepathicSeries("auto"))!; expect(telepathicRecoveryDecision(blocked).canResume).toBe(false);
  const plan = JSON.parse(serializeTelepathicPlan(blocked)); const reloaded = restoreTelepathicRuntime(structuredClone(blocked), plan); await f.store.saveTelepathicSeries(reloaded);
  await setTelepathicRecoveryPolicy(f.deps, "auto", false); await setTelepathicRecoveryPolicy(f.deps, "auto", true);
  await expect(f.run()).rejects.toThrow(); await expect(resumeBlockedTelepathicSeries(f.deps, "auto")).rejects.toThrow(); expect(f.attempt).toHaveBeenCalledTimes(2);
  expect((await f.store.getTelepathicSeries("auto"))!.providerCalls).toHaveLength(2);
 });
 it("STOP after granting recovery sends nothing further; explicit Resume consumes the saved grant", async () => {
  const f = await setup(mode, fixed); const live = f.attempt.getMockImplementation()!; let first = true;
  f.attempt.mockImplementation(async request => { if (first) { first = false; throw outage(); } return live(request); });
  const stop = new AbortController(), save = f.store.saveTelepathicSeries.bind(f.store);
  f.store.saveTelepathicSeries = async state => { await save(state); if (state.providerCalls.some(c => c.recovery?.action === "transport_retry")) stop.abort(new DOMException("Stopped", "AbortError")); };
  await expect(f.run({ signal: stop.signal })).rejects.toMatchObject({ name: "AbortError" }); expect(f.attempt).toHaveBeenCalledTimes(1);
  f.store.saveTelepathicSeries = save;
  const result = await f.run(); expect(result.status).toBe("completed");
  expect(result.providerCalls.filter(c => c.callStage === "sender_target")).toHaveLength(2);
  expect(result.providerCalls.filter(c => c.recovery?.action === "transport_retry")).toHaveLength(1);
 });
 it("recovers a saved complete answer without repurchasing the stage or duplicating its transcript", async () => {
  const f = await setup(mode, fixed); await f.run(); const snapshot = structuredClone(f.snapshots.get("sender_target")!);
  snapshot.status = "blocked"; snapshot.providerCalls[0].status = "uncertain"; snapshot.providerCalls[0].errorMessage = "database is locked";
  // Historical series have no automatic transport retry authorization.
  delete snapshot.config.recoveryPolicy; await f.store.saveTelepathicSeries(snapshot); f.attempt.mockClear();
  const result = await f.run(); const recovered = result.providerCalls[0];
  expect(recovered.status).toBe("succeeded"); expect(recovered.recovery?.action).toBe("recovered_response"); expect(recovered.usage).toEqual({ totalTokens: 17, costUsd: 0.01 });
  expect(f.attempt.mock.calls.some(([request]) => targetRequest(request.messages.map(m => m.content).join("\n")))).toBe(false);
  expect(result.transcript?.filter(event => event.id === `${recovered.id}:output`) ?? []).toHaveLength(fixed ? 1 : 0);
 });
 it("does not treat stop alone as proof of receipt", async () => {
  const f = await setup(mode, fixed); await f.run(); const snapshot = structuredClone(f.snapshots.get("sender_target")!);
  snapshot.status = "blocked"; snapshot.providerCalls[0].status = "uncertain"; delete snapshot.providerCalls[0].outputDiagnostics; delete snapshot.providerCalls[0].responseEvidence;
  expect(hasRecoverableTelepathicResponse(snapshot.providerCalls[0], "en")).toBe(false);
  await f.store.saveTelepathicSeries(snapshot); f.attempt.mockClear(); await expect(f.run()).rejects.toThrow(); expect(f.attempt).not.toHaveBeenCalled();
 });
 it("stops configuration errors instead of spending the semantic recovery attempt", async () => {
  const f = await setup(mode, fixed); f.attempt.mockImplementation(async () => { throw new ProviderCallError({ code: "configuration", phase: "before_dispatch", message: "invalid credentials" }); });
  await expect(f.run()).rejects.toThrow(); expect(f.attempt).toHaveBeenCalledTimes(1);
  expect(telepathicRecoveryDecision((await f.store.getTelepathicSeries("auto"))!).canResume).toBe(false);
 });
});
it("a transport failure on semantic attempt 2 preserves that budget and remains bounded", async () => {
 const f = await setup("ai_ai_training", true), live = f.attempt.getMockImplementation()!; let count = 0;
 f.attempt.mockImplementation(async request => { if (targetRequest(request.messages.map(m => m.content).join("\n"))) { count++; if (count === 1) return { content: "partial", finishReason: "length", usage: {} }; if (count === 2) throw outage(); } return live(request); });
 const result = await f.run(); const calls = result.providerCalls.filter(c => c.callStage === "sender_target");
 expect(calls.map(c => c.technicalAttempt)).toEqual([1, 2, 2]); expect(calls.map(c => c.requestSettings?.effective.maxOutputTokens)).toEqual([16384, 32768, 32768]);
});
it("a saved mixed/invalid lead decision is rejected before any new request", async () => {
 const f = await setup("conversation_exchange", true); await f.run();
 const snapshot = structuredClone(f.snapshots.get("lead_guidance:cycle:1")!); const call = snapshot.providerCalls.at(-1)!; call.status = "uncertain"; call.responseText = '{"cycle":1,"broadcast":{"instruction":"mixed"},"individual":[]}'; snapshot.status = "blocked";
 await f.store.saveTelepathicSeries(snapshot); f.attempt.mockClear(); await expect(f.run()).rejects.toThrow("Invalid lead decision"); expect(f.attempt).not.toHaveBeenCalled();
 const rejected = (await f.store.getTelepathicSeries("auto"))!.providerCalls.at(-1)!; expect(rejected.status).toBe("failed"); expect(rejected.recovery?.action).toBe("rejected_response");
});
it("Conversation exposes the shared decision without raw provider records", async () => {
 const f = await setup("conversation_exchange", true); const view = buildTelepathicConversationView(f.initial);
 expect(view.recoveryDecision).toEqual(telepathicRecoveryDecision(f.initial)); expect(view.config.recoveryPolicy).toEqual(AUTOMATIC_TELEPATHIC_RECOVERY); expect(view).not.toHaveProperty("providerCalls");
});

it("an exhausted receiver step is not silently sealed as no_submission or followed by Reveal", async () => {
 const f = await setup("ai_ai_training", true), live = f.attempt.getMockImplementation()!;
 f.attempt.mockImplementation(async request => { if (request.messages.some(m => m.content.includes("Please give your first description"))) throw outage(); return live(request); });
 await expect(f.run()).rejects.toThrow("transport recovery");
 const state = (await f.store.getTelepathicSeries("auto"))!;
 expect(state.rounds[0].revealedAt).toBeUndefined(); expect(state.rounds[0].blindByParticipant.b.status).not.toBe("no_submission");
 expect(state.providerCalls.filter(call => call.callStage === "receiver_first")).toHaveLength(2);
 expect(state.providerCalls.filter(call => call.callStage === "sender_target")).toHaveLength(1);
});
it("lease loss after a failed request prevents a recovery grant and another dispatch", async () => {
 const f = await setup("ai_ai_training", true); let lost = false;
 const original = f.store.assertTelepathicSeriesLease.bind(f.store);
 f.store.assertTelepathicSeriesLease = async id => { if (lost) throw new Error("lease lost"); return original(id); };
 f.attempt.mockImplementation(async () => { lost = true; throw outage(); });
 await expect(f.run()).rejects.toThrow("lease lost"); expect(f.attempt).toHaveBeenCalledTimes(1);
 expect((await f.store.getTelepathicSeries("auto"))!.providerCalls.some(call => call.recovery?.action === "transport_retry")).toBe(false);
});
it("a failed checkpoint inspection stops without writing an error checkpoint or sending another request", async () => {
 const f = await setup("conversation_exchange", true); const read = f.store.getTelepathicSeries.bind(f.store), save = f.store.saveTelepathicSeries.bind(f.store);
 let readingBroken = false, writesAfterFailedRead = 0; const cause = new Error("database is locked during checkpoint inspection");
 f.store.getTelepathicSeries = async id => { const state = await read(id); if (state?.providerCalls.some(call => call.status === "uncertain")) { readingBroken = true; throw cause; } return state; };
 f.store.saveTelepathicSeries = async state => { if (readingBroken) writesAfterFailedRead++; return save(state); };
 f.attempt.mockImplementation(async () => { throw outage(); });
 await expect(f.run()).rejects.toMatchObject({ name: "TelepathicSeriesCheckpointError", cause });
 expect(f.attempt).toHaveBeenCalledTimes(1); expect(writesAfterFailedRead).toBe(0);
});
it("an ambiguous commit of the recovery grant is not replayed by the generic handlers", async () => {
 const f = await setup("ai_ai_training", true), save = f.store.saveTelepathicSeries.bind(f.store); let grants = 0;
 f.store.saveTelepathicSeries = async state => { if (state.providerCalls.some(call => call.recovery?.action === "transport_retry")) { grants++; throw new Error("[sqlite-no-retry] ambiguous commit: SQLITE_BUSY"); } return save(state); };
 f.attempt.mockImplementation(async () => { throw outage(); });
 await expect(f.run()).rejects.toMatchObject({ name: "TelepathicSeriesCheckpointError" }); expect(grants).toBe(1); expect(f.attempt).toHaveBeenCalledTimes(1);
});
it("a stale dispatched request resumes under its saved policy with one durable retry grant", async () => {
 const f = await setup("ai_ai_training", true); await f.run(); const snapshot = structuredClone(f.snapshots.get("sender_target")!);
 snapshot.status = "running"; const call = snapshot.providerCalls[0]; call.status = "dispatched";
 delete call.responseText; delete call.finishReason; delete call.outputDiagnostics; delete call.responseEvidence;
 await f.store.saveTelepathicSeries(snapshot); f.attempt.mockClear(); const result = await f.run();
 expect(result.providerCalls.filter(c => c.callStage === "sender_target").map(c => c.technicalAttempt)).toEqual([1, 1]);
 expect(result.providerCalls[0].recovery?.action).toBe("transport_retry");
});
it("a changed frozen request prevents recovery and dispatch", async () => {
 const f = await setup("conversation_exchange", true); await f.run(); const snapshot = structuredClone(f.snapshots.get("sender_target")!);
 snapshot.status = "blocked"; snapshot.providerCalls[0].status = "uncertain"; snapshot.providerCalls[0].requestSha256 = "changed";
 await f.store.saveTelepathicSeries(snapshot); f.attempt.mockClear(); await expect(f.run()).rejects.toThrow("fingerprint"); expect(f.attempt).not.toHaveBeenCalled();
});
it("invalid persisted policy cannot authorize the first request", async () => {
 const f = await setup("ai_ai_training", true); const state = (await f.store.getTelepathicSeries("auto"))!;
 state.config.recoveryPolicy = { ...AUTOMATIC_TELEPATHIC_RECOVERY, maxTransportRetriesPerScope: 99 } as never;
 await f.store.saveTelepathicSeries(state); await expect(f.run()).rejects.toThrow("recovery policy"); expect(f.attempt).not.toHaveBeenCalled();
});
it("a later success cannot erase an earlier unresolved physical request", async () => {
 const f = await setup("conversation_exchange", true); await f.run(); const snapshot = structuredClone(f.snapshots.get("sender_target")!);
 snapshot.status = "blocked"; const call = snapshot.providerCalls[0]; snapshot.providerCalls.unshift({ ...call, id: "earlier", status: "uncertain", responseText: undefined, outputDiagnostics: undefined });
 await f.store.saveTelepathicSeries(snapshot); f.attempt.mockClear(); expect(telepathicRecoveryDecision(snapshot).canResume).toBe(false);
 await expect(f.run()).rejects.toThrow(); expect(f.attempt).not.toHaveBeenCalled();
});
it("automatic legacy series do not accept output-limit responses or skip a required target", async () => {
 const f = await setup("ai_ai_training", false);
 f.attempt.mockImplementation(async () => ({ content: "partial", finishReason: "length", usage: {} }));
 await expect(f.run()).rejects.toThrow("Incomplete"); expect(f.attempt).toHaveBeenCalledTimes(2);
 const state = (await f.store.getTelepathicSeries("auto"))!;
 expect(state.rounds[0].target).toBeUndefined(); expect(state.rounds[0].revealedAt).toBeUndefined(); expect(state.providerCalls.every(call => call.status === "failed")).toBe(true);
});
it("keeps an unsaved received answer in memory and restores it after an explicit retry without repurchasing it", async () => {
 const f = await setup("conversation_exchange", true), save = f.store.saveTelepathicSeries.bind(f.store); let broken = true, terminalWrites = 0;
 f.store.saveTelepathicSeries = async state => { if (broken && state.providerCalls.some(call => call.status === "succeeded")) { terminalWrites++; throw new Error("disk full"); } return save(state); };
 await expect(f.run()).rejects.toMatchObject({ name: "TelepathicCheckpointError" }); expect(f.attempt).toHaveBeenCalledTimes(1); expect(terminalWrites).toBe(1);
 expect((await f.store.getTelepathicSeries("auto"))!.providerCalls[0].status).toBe("dispatched");
 broken = false; f.attempt.mockClear(); const result = await f.run();
 expect(result.providerCalls[0].recovery?.action).toBe("recovered_response");
 expect(result.providerCalls[0].usage).toEqual({ totalTokens: 17, costUsd: 0.01 });
 expect(f.attempt.mock.calls.some(([request]) => targetRequest(request.messages.map(m => m.content).join("\n")))).toBe(false);
 expect(result.providerCalls.filter(call => call.callStage === "sender_target")).toHaveLength(1);
});
it("a permanent preflight/configuration failure is saved as non-resumable without dispatch", async () => {
 const f = await setup("conversation_exchange", true);
 await expect(f.run({ resolveRoute: async participant => { const route = await f.route(participant); return { ...route, model: { ...route.model, capabilities: { ...route.model.capabilities, contextTokens: 128 } } }; } })).rejects.toThrow("context budget");
 expect(f.attempt).not.toHaveBeenCalled(); const state = (await f.store.getTelepathicSeries("auto"))!;
 expect(state.recoveryBlock?.kind).toBe("configuration"); expect(telepathicRecoveryDecision(state).canResume).toBe(false);
 await expect(f.run()).rejects.toThrow(); expect(f.attempt).not.toHaveBeenCalled();
});
it.each(["sender_target", "series_reflection"])("%s: reads an ambiguously committed buffered receipt before another local write", async stage => {
 const f = await setup("conversation_exchange", true), save = f.store.saveTelepathicSeries.bind(f.store);
 let phase: "disk_full" | "ambiguous_restore" | "healthy" = "disk_full", restoreWrites = 0;
 f.store.saveTelepathicSeries = async state => {
  if (phase === "disk_full" && state.providerCalls.some(call => call.callStage === stage && call.status === "succeeded")) throw new Error("disk full");
  if (state.providerCalls.some(call => call.callStage === stage && call.status === "uncertain" && call.responseText)) {
   restoreWrites++; await save(state);
   if (phase === "ambiguous_restore") throw new Error("[sqlite-no-retry] ambiguous commit: SQLITE_BUSY");
   return;
  }
  return save(state);
 };
 await expect(f.run()).rejects.toMatchObject({ name: "TelepathicCheckpointError" });
 const requestsAtFailure = f.attempt.mock.calls.length;
 phase = "ambiguous_restore";
 await expect(f.run()).rejects.toMatchObject({ name: "TelepathicSeriesCheckpointError" }); expect(restoreWrites).toBe(1); expect(f.attempt).toHaveBeenCalledTimes(requestsAtFailure);
 phase = "healthy"; f.attempt.mockClear(); const result = await f.run();
 expect(restoreWrites).toBe(1); expect(result.providerCalls.find(call => call.callStage === stage)!.status).toBe("succeeded");
 expect(f.attempt.mock.calls.some(([request]) => stage === "sender_target" ? targetRequest(request.messages.map(m => m.content).join("\n")) : request.modelId === "model-a")).toBe(false);
});
it("never overwrites a different durable response with an in-memory receipt", async () => {
 const f = await setup("conversation_exchange", true), save = f.store.saveTelepathicSeries.bind(f.store);
 f.store.saveTelepathicSeries = async state => { if (state.providerCalls.some(call => call.status === "succeeded")) throw new Error("disk full"); return save(state); };
 await expect(f.run()).rejects.toMatchObject({ name: "TelepathicCheckpointError" });
 const changed = (await f.store.getTelepathicSeries("auto"))!; changed.providerCalls[0].responseText = "different durable response";
 await save(changed); f.store.saveTelepathicSeries = save; f.attempt.mockClear();
 await expect(f.run()).rejects.toMatchObject({ name: "TelepathicSeriesCheckpointError" }); expect(f.attempt).not.toHaveBeenCalled();
 expect((await f.store.getTelepathicSeries("auto"))!.providerCalls[0].responseText).toBe("different durable response");
});
it("an old completely missing outcome can use one retry after opting into the saved policy", async () => {
 const f = await setup("conversation_exchange", true); await f.run(); const state = structuredClone(f.snapshots.get("sender_target")!);
 const call = state.providerCalls[0]; state.status = "blocked"; call.status = "uncertain";
 delete call.responseText; delete call.finishReason; delete call.outputDiagnostics; delete call.responseEvidence; delete call.transportFailure;
 await f.store.saveTelepathicSeries(state); f.attempt.mockClear(); expect(telepathicRecoveryDecision(state).canResume).toBe(true);
 const result = await f.run(); expect(result.providerCalls[0].recovery?.action).toBe("transport_retry"); expect(result.providerCalls.filter(item => item.callStage === "sender_target")).toHaveLength(2);
});

// Audit regressions: use the same adapters as the mounted panels, not f.store.
it.each(["ai_ai_training", "conversation_exchange"] as const)("audit P1 %s: a new execution adapter recovers the same repository receipt", async mode => {
 const f = await setup(mode, true), save = f.store.saveTelepathicSeries.bind(f.store); let broken = true;
 f.store.saveTelepathicSeries = async state => { if (broken && state.providerCalls.some(call => call.status === "succeeded")) throw new Error("disk full"); await save(state); };
 const adapter = () => telepathicExecutionStore(f.store as unknown as TelepathicExchangeRepository, () => undefined);
 const first = adapter(); await expect(f.run({ store: first })).rejects.toMatchObject({ name: "TelepathicCheckpointError" });
 broken = false; const second = adapter(); expect(second).not.toBe(first);
 const result = await f.run({ store: second }); expect(result.status).toBe("completed");
 expect(f.attempt.mock.calls.filter(([request]) => targetRequest(request.messages.map(m => m.content).join("\n")))).toHaveLength(1);
 expect(result.providerCalls.filter(call => call.callStage === "sender_target")).toHaveLength(1);
});
it("audit P2: explicit validation of the restored frozen route enables a separate Resume without dispatch", async () => {
 const f = await setup("ai_ai_training", true), unavailable = vi.fn(async () => { throw new Error("model unavailable"); });
 await expect(f.run({ resolveRoute: unavailable })).rejects.toThrow("model unavailable");
 const blocked = (await f.store.getTelepathicSeries("auto"))!;
 const stillBlocked = await revalidateTelepathicConfiguration({ ...f.deps, resolveRoute: unavailable }, "auto");
 expect(stillBlocked.recoveryBlock?.message).toBe("model unavailable"); expect(f.attempt).not.toHaveBeenCalled();
 const resolver = vi.fn(f.route); const checked = await revalidateTelepathicConfiguration({ ...f.deps, resolveRoute: resolver }, "auto");
 expect(resolver).toHaveBeenCalledTimes(2); expect(checked.recoveryBlock).toBeUndefined(); expect(telepathicRecoveryDecision(checked).canResume).toBe(true);
 expect(checked.providerCalls).toEqual(blocked.providerCalls); expect(checked.config).toEqual(blocked.config); expect(f.attempt).not.toHaveBeenCalled();
 expect((await f.run()).status).toBe("completed");
});
it("audit P2: changed frozen identity stays blocked without dispatch", async () => {
 const f = await setup("ai_ai_training", true);
 await expect(f.run({ resolveRoute: async () => { throw new Error("unavailable"); } })).rejects.toThrow();
 const result = await revalidateTelepathicConfiguration({ ...f.deps, resolveRoute: async p => { const route = await f.route(p); return { ...route, snapshot: { ...route.snapshot, modelId: "other" } }; } }, "auto");
 expect(result.recoveryBlock?.message).toContain("frozen route snapshot"); expect(f.attempt).not.toHaveBeenCalled();
});
it("audit P2: live binding differs despite a matching snapshot", async () => {
 const f = await setup("ai_ai_training", true);
 await expect(f.run({ resolveRoute: async () => { throw new Error("unavailable"); } })).rejects.toThrow();
 const result = await revalidateTelepathicConfiguration({ ...f.deps, resolveRoute: async p => { const route = await f.route(p); return { ...route, validatedIdentity: { ...route.validatedIdentity, aiIdentityId: "other" } }; } }, "auto");
 expect(result.recoveryBlock?.message).toContain("identity binding"); expect(f.attempt).not.toHaveBeenCalled();
});
it("audit P2: revalidation preserves exhausted semantic and transport ledgers and rejects changed settings", async () => {
 const f = await setup("ai_ai_training", true); f.attempt.mockImplementation(async () => { throw outage(); });
 await expect(f.run()).rejects.toThrow();
 const blocked = (await f.store.getTelepathicSeries("auto"))!; blocked.recoveryBlock = { kind: "configuration", message: "route temporarily unavailable" }; await f.store.saveTelepathicSeries(blocked);
 const changed = await revalidateTelepathicConfiguration({ ...f.deps, resolveRoute: async p => ({ ...await f.route(p), requestedSettings: { temperature: 1 } }) }, "auto");
 expect(changed.recoveryBlock?.message).toContain("fingerprint/settings changed");
 const checked = await revalidateTelepathicConfiguration(f.deps, "auto");
 expect(checked.recoveryBlock).toBeUndefined(); expect(checked.providerCalls).toEqual(blocked.providerCalls); expect(telepathicRecoveryDecision(checked).canResume).toBe(false); expect(f.attempt).toHaveBeenCalledTimes(2);
});
it("audit P2: a still-invalid context preflight remains blocked without dispatch", async () => {
 const f = await setup("conversation_exchange", true);
 const small = async (p: TelepathicParticipant) => { const route = await f.route(p); return { ...route, model: { ...route.model, capabilities: { ...route.model.capabilities, contextTokens: 128 } } }; };
 await expect(f.run({ resolveRoute: small })).rejects.toThrow("context budget");
 const blocked = (await f.store.getTelepathicSeries("auto"))!; expect(blocked.recoveryBlock?.validation?.messages.length).toBeGreaterThan(0);
 const restored = restoreTelepathicRuntime(structuredClone(blocked), JSON.parse(serializeTelepathicPlan(blocked))); expect(restored.recoveryBlock).toEqual(blocked.recoveryBlock);
 const view = buildTelepathicConversationView(blocked); expect(view.recoveryDecision?.configurationBlocked).toBe(true); expect(view).not.toHaveProperty("recoveryBlock"); expect(view.recoveryDecision).not.toHaveProperty("validation");
 const stillBlocked = await revalidateTelepathicConfiguration({ ...f.deps, resolveRoute: small }, "auto");
 expect(stillBlocked.recoveryBlock?.message).toContain("context budget"); expect(f.attempt).not.toHaveBeenCalled();
 const checked = await revalidateTelepathicConfiguration(f.deps, "auto"); expect(checked.recoveryBlock).toBeUndefined(); expect(f.attempt).not.toHaveBeenCalled();
 expect(checked.providerCalls).toEqual(blocked.providerCalls);
});
it("audit P2: successful configuration validation cannot renew exhausted output attempts", async () => {
 const f = await setup("ai_ai_training", true); f.attempt.mockImplementation(async () => ({ content: "", finishReason: "length", usage: {} }));
 await expect(f.run()).rejects.toThrow(); const blocked = (await f.store.getTelepathicSeries("auto"))!;
 expect(blocked.providerCalls.map(call => call.technicalAttempt)).toEqual([1, 2]);
 blocked.recoveryBlock = { kind: "configuration", message: "check settings" }; await f.store.saveTelepathicSeries(blocked);
 const checked = await revalidateTelepathicConfiguration(f.deps, "auto"); expect(checked.recoveryBlock).toBeUndefined();
 expect(checked.providerCalls).toEqual(blocked.providerCalls); expect(telepathicRecoveryDecision(checked).canResume).toBe(false); expect(f.attempt).toHaveBeenCalledTimes(2);
});
it("automatic inspection does not repeatedly save the same unavailable configuration", async () => {
 const f = await setup("ai_ai_training", true), resolver = async () => { throw new Error("route unavailable"); };
 await expect(f.run({ resolveRoute: resolver })).rejects.toThrow();
 const save = vi.spyOn(f.store, "saveTelepathicSeries");
 await revalidateTelepathicConfiguration({ ...f.deps, resolveRoute: resolver }, "auto");
 await revalidateTelepathicConfiguration({ ...f.deps, resolveRoute: resolver }, "auto");
 expect(save).not.toHaveBeenCalled(); expect(f.attempt).not.toHaveBeenCalled();
});
it("STOP during automatic configuration inspection persists paused and never dispatches", async () => {
 const f = await setup("ai_ai_training", true);
 await expect(f.run({ resolveRoute: async () => { throw new Error("route unavailable"); } })).rejects.toThrow();
 const controller = new AbortController(), save = vi.spyOn(f.store, "saveTelepathicSeries");
 await expect(revalidateTelepathicConfiguration({ ...f.deps, signal: controller.signal, resolveRoute: async p => { controller.abort(new DOMException("Stopped by user", "AbortError")); return f.route(p); } }, "auto")).rejects.toMatchObject({ name: "AbortError" });
 expect(save).toHaveBeenCalledTimes(1);
 const paused = (await f.store.getTelepathicSeries("auto"))!; expect(paused.status).toBe("paused"); expect(paused.recoveryBlock).toBeDefined(); expect(f.attempt).not.toHaveBeenCalled();
 const checked = await revalidateTelepathicConfiguration(f.deps, "auto"); expect(checked.status).toBe("paused"); expect(checked.recoveryBlock).toBeUndefined(); expect(f.attempt).not.toHaveBeenCalled();
});
