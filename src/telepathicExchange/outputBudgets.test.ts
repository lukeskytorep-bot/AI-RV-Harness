import { describe, expect, it, vi } from "vitest";
import type { ProviderChatAttempt } from "../providers/requestExecutor";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import { executeTelepathicProviderPacket, telepathicRequestFingerprint, type ResolvedTelepathicAiRoute } from "./providerGateway";
import { TELEPATHIC_OUTPUT_BUDGETS, lengthRecoveryUnavailable, nextDurableTechnicalAttempt, scopeOutputBudget, outputAttemptBudget, telepathicOutputStage } from "./outputBudgets";
import { createTelepathicSeriesState, runNextTelepathicAiRound, advanceTelepathicConversationSeries, saveHumanTelepathicFirstBlind, saveHumanTelepathicReflection, saveHumanTelepathicSharing, telepathicConversationHumanStep } from "./engine";
import { InMemoryTelepathicExchangeStore } from "./store";
import type { TelepathicMode, TelepathicParticipant, TelepathicSeriesConfig, TelepathicProviderCallRecord } from "./types";
import type { TelepathicProviderPacket } from "./packets";
import { telepathicProviderScopeKey } from "./types";
import { serializeTelepathicPlan, restoreTelepathicRuntime } from "./persistence";

function ai(id: string): TelepathicParticipant { return { id, kind: "ai", displayName: id, ai: { profileId: `p-${id}`, profileName: id, workspaceId: `w-${id}`, aiIdentityId: `i-${id}`, providerConfigId: `c-${id}`, credentialId: `k-${id}`, credentialFingerprint: `f-${id}`, modelId: `m-${id}`, route: `custom_openai:m-${id}` } }; }
function route(participant: TelepathicParticipant, ceiling = 32768): ResolvedTelepathicAiRoute {
  const snapshot = participant.ai!;
  const providerConfig: ProviderConfig = { id: snapshot.providerConfigId, provider: "custom_openai", label: "Test", credentialId: snapshot.credentialId, baseUrl: "https://example.test/v1", enabled: true, createdAt: "now", updatedAt: "now" };
  const model: ProviderModel = { providerConfigId: providerConfig.id, provider: "custom_openai", modelId: snapshot.modelId, displayName: "M", route: snapshot.route, pricing: {}, recommended: false, rawMetadata: {}, refreshedAt: "now", capabilities: { contextTokens: 131072, maxOutputTokens: ceiling, inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: false, reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: true, min: 0, max: 2, confidence: "provider_metadata" }, supportedParameters: ["temperature", "max_tokens"], source: "provider", capturedAt: "now" } };
  return { snapshot, providerConfig, model, requestedSettings: { temperature: 0.4, maxOutputTokens: 1024 }, validatedIdentity: { profileId: snapshot.profileId, workspaceId: snapshot.workspaceId, aiIdentityId: snapshot.aiIdentityId, credentialFingerprint: snapshot.credentialFingerprint } };
}
function config(mode: TelepathicMode): TelepathicSeriesConfig { return { schemaVersion: 1, protocolVersion: "fixed_lead_v1", leadInstructionVersion: "fixed_lead_guidance_v1", maxGuidanceCycles: 3, seriesId: "budgets", seriesWorkspaceId: "w-lead", mode, language: "en", participants: [ai("lead"), ai("a")], senderPolicy: { kind: "fixed_ai", participantId: "lead" }, roundCount: 1, topic: "any", discloseTopicToReceivers: false }; }
function packet(callStage: string): TelepathicProviderPacket { const scope = { seriesId: "s", roundId: "r", participantId: "a", callStage }; return { scope, scopeKey: telepathicProviderScopeKey(scope), contextPolicy: "fresh_round_context", continuationPolicy: "none", messages: [{ role: "user", content: "Exact frozen instruction" }] }; }
function answer(stage: string): string {
  if (stage.startsWith("lead_guidance:cycle:")) return JSON.stringify({ cycle: Number(stage.split(":").at(-1)), finishRound: true, finishParticipantIds: [] });
  if (stage === "sender_target") return "SECRET_FROZEN_TARGET";
  if (stage === "sender_transmission_confirmation") return "READY";
  if (stage === "sharing_consent") return "YES";
  return "A complete blind response or reflection.";
}
const changedStages = ["sender_target", "sender_transmission_confirmation", "lead_guidance:cycle:1", "sharing_consent"];

async function engineRun(mode: TelepathicMode, incomplete?: string, options: { ceiling?: number; stop?: boolean; human?: boolean; invalidJson?: boolean; failBoth?: boolean } = {}) {
  const store = new InMemoryTelepathicExchangeStore(), frozen = config(mode);
  if (options.human) frozen.participants.push({ id: "human", kind: "human", displayName: "Human" });
  await store.saveTelepathicSeries(createTelepathicSeriesState(frozen));
  const requests: Array<{ stage: string; budget: number; attempt: number }> = [], abort = new AbortController();
  const providerAttempt: ProviderChatAttempt = async request => {
    const state = (await store.getTelepathicSeries("budgets"))!, call = state.providerCalls.at(-1)!;
    requests.push({ stage: call.callStage, budget: request.settings.effective.maxOutputTokens!, attempt: call.technicalAttempt });
    if (call.callStage.startsWith("receiver_first") || call.callStage.startsWith("receiver_guidance")) expect(JSON.stringify(request.messages)).not.toContain("SECRET_FROZEN_TARGET");
    const partial = call.callStage === incomplete && (call.technicalAttempt === 1 || options.failBoth);
    if (partial && options.stop) abort.abort();
    return { content: options.invalidJson && call.callStage.startsWith("lead_guidance") ? "not JSON" : partial ? "Known partial response" : answer(call.callStage), finishReason: partial ? "length" : "stop", providerRequestId: `gen-${call.id}`, usage: { totalTokens: 12, reasoningTokens: 3, costUsd: 0.01 } };
  };
  const deps = { store, resolveRoute: async (participant: TelepathicParticipant) => route(participant, options.ceiling), providerAttempt, signal: abort.signal };
  const execute = () => mode === "ai_ai_training" ? runNextTelepathicAiRound(deps, "budgets") : advanceTelepathicConversationSeries(deps, "budgets");
  return { store, requests, deps, execute };
}

describe("shared Telepathic output policy", () => {
  it.each(Object.entries(TELEPATHIC_OUTPUT_BUDGETS))("sends explicit stage %s limits and persists ceiling/usage diagnostics", async (stage, limits) => {
    const concrete = stage === "lead_guidance" ? "lead_guidance:cycle:1" : stage === "receiver_guidance" ? "receiver_guidance:cycle:2:recipient:a" : stage;
    const saved: TelepathicProviderCallRecord[] = [];
    for (const technicalAttempt of [1, 2]) {
      const result = await executeTelepathicProviderPacket({ packet: packet(concrete), route: route(ai("a")), fixedLead: true, technicalAttempt, hooks: { createCallId: () => `call-${technicalAttempt}`, now: () => "2026-10-12T20:00:00Z", persist: async call => { saved.push(structuredClone(call)); } }, attempt: async request => {
        expect(request.settings.effective.maxOutputTokens).toBe(limits[technicalAttempt - 1]);
        return { content: "Complete", finishReason: "stop", providerRequestId: "generation-id", usage: { totalTokens: 12, reasoningTokens: 3 } };
      } });
      expect(saved.find(call => call.id === result.call.id && call.status === "prepared")?.outputBudgetSnapshot?.version).toBe(2);
      expect(result.call.outputDiagnostics).toMatchObject({ policyVersion: 2, requestedMaxOutputTokens: limits[technicalAttempt - 1], effectiveMaxOutputTokens: limits[technicalAttempt - 1], modelMaxOutputTokens: 32768, completion: "complete" });
      expect(result.call).toMatchObject({ providerRequestId: "generation-id", usage: { reasoningTokens: 3 } });
    }
  });
  for (const mode of ["ai_ai_training", "conversation_exchange"] as const) {
    it.each(changedStages)(`${mode} uses a second budget only after length in %s`, async stage => {
      const run = await engineRun(mode, stage);const state = await run.execute();expect(state.status).toBe("completed");
      const selected = run.requests.filter(request => request.stage === stage);
      expect(selected.map(request => request.budget)).toEqual(stage === "sharing_consent" ? [8192, 16384] : [16384, 32768]);
      expect(selected.map(request => request.attempt)).toEqual([1, 2]);
      expect(state.providerCalls.filter(call => call.callStage === stage)[0].outputDiagnostics?.completion).toBe("partial");
      expect(state.config.outputBudgetPolicyVersion).toBe(2);
    });
    it(`${mode} does not request recovery after a complete response`, async () => {
      const run = await engineRun(mode);const state = await run.execute();expect(state.status).toBe("completed");
      for (const stage of changedStages) expect(run.requests.filter(request => request.stage === stage)).toEqual([{ stage, budget: stage === "sharing_consent" ? 8192 : 16384, attempt: 1 }]);
      expect(state.providerCalls.every(call => call.technicalAttempt === 1)).toBe(true);
    });
  }
  it("covers the Conversation human-receiver path with unchanged READY, YES/NO and lead contracts", async () => {
    const run = await engineRun("conversation_exchange", undefined, { human: true });let state = await run.execute();
    for (let turn = 0; state.status !== "completed" && turn < 8; turn++) {
      const step = telepathicConversationHumanStep(state);
      if (step.kind === "blind_first") await saveHumanTelepathicFirstBlind(run.deps, "budgets", "Human blind response");
      else if (step.kind === "reflection") await saveHumanTelepathicReflection(run.deps, "budgets", "Human reflection");
      else if (step.kind === "sharing_consent") await saveHumanTelepathicSharing(run.deps, "budgets", "no");
      else throw new Error(`Unexpected human step: ${step.kind}`);
      state = await run.execute();
    }
    expect(state.status).toBe("completed");for (const stage of changedStages) expect(run.requests.find(request => request.stage === stage)?.budget).toBe(stage === "sharing_consent" ? 8192 : 16384);
    expect(state.rounds[0].reflectionsByParticipant.a.shareOthersConsent).toBe("yes");
  });
  it("resumes the second level after a durable partial and process restart without buying level one again", async () => {
    const run = await engineRun("ai_ai_training", "sender_target", { stop: true });await expect(run.execute()).rejects.toThrow();
    const state = (await run.store.getTelepathicSeries("budgets"))!, originalCall = state.providerCalls[0];
    expect(originalCall).toMatchObject({ status: "failed", technicalAttempt: 1, outputBudgetSnapshot: { version: 2 } });
    const restarted = new InMemoryTelepathicExchangeStore();await restarted.saveTelepathicSeries(state);const budgets: number[] = [];
    const result = await runNextTelepathicAiRound({ store: restarted, resolveRoute: async p => route(p), providerAttempt: async request => {
      const current = (await restarted.getTelepathicSeries("budgets"))!.providerCalls.at(-1)!;
      if (current.callStage === "sender_target") budgets.push(request.settings.effective.maxOutputTokens!);
      return { content: answer(current.callStage), finishReason: "stop", usage: {} };
    } }, "budgets");
    expect(result.status).toBe("completed");expect(budgets).toEqual([32768]);expect(result.providerCalls[0]).toEqual(originalCall);
  });
  it("preserves legacy scope fingerprint and count while new scopes receive version 2", async () => {
    const legacy = scopeOutputBudget("sender_target", 32768, [{ technicalAttempt: 1, status: "failed" } as TelepathicProviderCallRecord]);
    expect(legacy).toMatchObject({ version: 1, attemptLimits: [4096, 4096] });
    expect(await telepathicRequestFingerprint(packet("sender_target"), route(ai("a")), true, legacy)).toBe(await telepathicRequestFingerprint(packet("sender_target"), route(ai("a")), true));
    expect(nextDurableTechnicalAttempt([{ technicalAttempt: 1, status: "failed" } as TelepathicProviderCallRecord])).toBe(2);
    expect(scopeOutputBudget("sender_transmission_confirmation", 32768).version).toBe(2);
  });
  it("normalizes provider output-limit finish reasons before testing a clamped recovery", () => {
    const budget = scopeOutputBudget("sharing_consent", 8192);
    expect(lengthRecoveryUnavailable(budget, [{ status: "failed", technicalAttempt: 1, finishReason: "MAX-OUTPUT-TOKENS" } as TelepathicProviderCallRecord])).toBe(true);
  });
  it("retains a prepared second level and rejects a third dispatch", async () => {
    expect(nextDurableTechnicalAttempt([{ technicalAttempt: 2, status: "prepared" } as TelepathicProviderCallRecord])).toBe(2);
    const attempt = vi.fn();await expect(executeTelepathicProviderPacket({ packet: packet("sharing_consent"), route: route(ai("a")), fixedLead: true, technicalAttempt: 3, attempt, hooks: { createCallId: () => "x", now: () => "now", persist: async () => {} } })).rejects.toThrow(/two attempts/);expect(attempt).not.toHaveBeenCalled();
  });
  it.each(changedStages)("respects a small model ceiling and blocks useless length recovery for %s", async stage => {
    const run = await engineRun("ai_ai_training", stage, { ceiling: 4096 });await expect(run.execute()).rejects.toThrow(/No larger output recovery budget/);
    expect(run.requests.filter(request => request.stage === stage).map(request => request.budget)).toEqual([4096]);
    const state = (await run.store.getTelepathicSeries("budgets"))!;const diagnostic = state.providerCalls.find(call => call.callStage === stage)?.outputDiagnostics;
    expect(diagnostic).toMatchObject({ modelMaxOutputTokens: 4096, effectiveMaxOutputTokens: 4096, requestedMaxOutputTokens: stage === "sharing_consent" ? 8192 : 16384 });
  });
  it("blocks frozen ceiling/policy drift before dispatch and rejects an unknown stage", () => {
    const snapshot = scopeOutputBudget("sharing_consent", 32768);
    expect(() => scopeOutputBudget("sharing_consent", 16384, [{ outputBudgetSnapshot: snapshot } as TelepathicProviderCallRecord])).toThrow(/ceiling changed/);
    expect(() => scopeOutputBudget("sharing_consent", 32768, [{ outputBudgetSnapshot: { ...snapshot, attemptLimits: [4096, 4096] } } as TelepathicProviderCallRecord])).toThrow(/changed/);
    expect(() => telepathicOutputStage("lead_guidance:cycle:4")).toThrow(/Unknown/);
  });
  it("rejects invalid lead JSON at 16K without inventing a guidance cycle", async () => {
    const run = await engineRun("ai_ai_training", undefined, { invalidJson: true });await expect(run.execute()).rejects.toThrow(/Invalid lead decision/);
    expect(run.requests.find(request => request.stage.startsWith("lead_guidance"))?.budget).toBe(16384);expect(run.requests.some(request => request.stage.startsWith("receiver_guidance"))).toBe(false);
  });
  it("exhausts two length attempts and cannot buy a third after restart", async () => {
    const run = await engineRun("ai_ai_training", "sender_target", { failBoth: true });
    await expect(run.execute()).rejects.toThrow();expect(run.requests.map(request => request.budget)).toEqual([16384, 32768]);
    const checkpoint = (await run.store.getTelepathicSeries("budgets"))!;expect(nextDurableTechnicalAttempt(checkpoint.providerCalls)).toBe(3);
    await expect(run.execute()).rejects.toThrow();expect(run.requests).toHaveLength(2);
  });
  it("blocks requested settings, endpoint and model ceiling drift after a persisted first attempt", async () => {
    const run = await engineRun("ai_ai_training", "sender_target", { stop: true });await expect(run.execute()).rejects.toThrow();
    const checkpoint = (await run.store.getTelepathicSeries("budgets"))!;
    for (const drift of ["settings", "endpoint", "ceiling"]) {
      const store = new InMemoryTelepathicExchangeStore();await store.saveTelepathicSeries(checkpoint);const paid = vi.fn();
      await expect(runNextTelepathicAiRound({ store, resolveRoute: async participant => {
        const resolved = route(participant);
        if (drift === "settings") resolved.requestedSettings.temperature = 0.9;
        if (drift === "endpoint") resolved.providerConfig.baseUrl = "https://changed.example/v1";
        if (drift === "ceiling") resolved.model.capabilities.maxOutputTokens = 16384;
        return resolved;
      }, providerAttempt: paid }, "budgets")).rejects.toThrow(/changed/);
      expect(paid).not.toHaveBeenCalled();
    }
  });
  it("round-trips budgets and diagnostics through the existing runtime JSON extension", async () => {
    const run = await engineRun("ai_ai_training");const state = await run.execute(), stored = JSON.parse(serializeTelepathicPlan(state));
    const relational = structuredClone(state);for (const call of relational.providerCalls) { delete call.outputBudgetSnapshot;delete call.outputDiagnostics; }
    const restored = restoreTelepathicRuntime(relational, stored);expect(restored.providerCalls).toEqual(state.providerCalls);
    expect(outputAttemptBudget(restored.providerCalls[0].outputBudgetSnapshot!, 2).effective).toBe(32768);
  });
});
