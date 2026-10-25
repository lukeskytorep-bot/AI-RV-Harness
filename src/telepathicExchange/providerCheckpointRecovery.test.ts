import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import type { TelepathicParticipant, TelepathicProviderCallRecord } from "./types";
import { executeTelepathicProviderPacket, TelepathicCheckpointError, type ResolvedTelepathicAiRoute } from "./providerGateway";
import { buildSenderTargetPacket } from "./packets";
import { SqliteWriteCoordinator, SqliteWriteRetryExhaustedError } from "../storage/sqliteWriteCoordinator";
import { createTelepathicSeriesState, runNextTelepathicAiRound, advanceTelepathicConversationSeries, runTelepathicFinalReflections, TelepathicSeriesCheckpointError } from "./engine";
import { InMemoryTelepathicExchangeStore } from "./store";
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


function fixture(persist: (call: TelepathicProviderCallRecord) => Promise<void>, signal?: AbortSignal) {
  const participant = ai("a");
  const route: ResolvedTelepathicAiRoute = {
    snapshot: participant.ai!, providerConfig: configFor("a"), model: model("a"), requestedSettings: {},
    validatedIdentity: { profileId: participant.ai!.profileId, workspaceId: participant.ai!.workspaceId,
      aiIdentityId: participant.ai!.aiIdentityId, credentialFingerprint: participant.ai!.credentialFingerprint },
  };
  const attempt = vi.fn(async () => ({ content: "Complete target", finishReason: "stop", usage: { totalTokens: 17, costUsd: 0.01 }, providerRequestId: "generation-1" }));
  return { attempt, route, input: {
    packet: buildSenderTargetPacket({ language: "en", seriesId: "recovery", roundId: "round", participantId: "a", name: "A", roundNumber: 1, topicLabel: "any" }),
    route, technicalAttempt: 1, attempt, signal,
    hooks: { createCallId: () => "call-1", now: () => "2026-10-22T12:00:00.000Z", persist },
  } };
}
afterEach(() => vi.useRealTimers());
describe("local checkpoint recovery without another provider request", () => {
  it.each(["prepared", "dispatched", "succeeded"] as const)("retries a single BUSY at %s with the same record", async (status) => {
    const saved: TelepathicProviderCallRecord[] = []; let busy = true;
    const f = fixture(async call => {
      if (busy && call.status === status) { busy = false; expect(f.attempt).toHaveBeenCalledTimes(status === "succeeded" ? 1 : 0); throw new Error("SQLite code: 5 database is locked"); }
      saved.push(structuredClone(call));
    });
    const result = executeTelepathicProviderPacket(f.input);

    expect((await result).call.status).toBe("succeeded"); expect(f.attempt).toHaveBeenCalledTimes(1);
    expect(saved.map(call => call.status)).toEqual(["prepared", "dispatched", "succeeded"]);
    expect(new Set(saved.map(call => call.id)).size).toBe(1);
    expect(saved.at(-1)).toMatchObject({ responseText: "Complete target", finishReason: "stop", providerRequestId: "generation-1", usage: { totalTokens: 17, costUsd: 0.01 }, technicalAttempt: 1 });
  });
  it("keeps an invalid complete answer rejected while retrying only its save", async () => {
    let busy = true; const statuses: string[] = [];
    const f = fixture(async call => { if (call.status === "failed" && busy) { busy = false; throw new Error("SQLITE_BUSY"); } statuses.push(call.status); });
    const result = expect(executeTelepathicProviderPacket({ ...f.input, validateResponse: () => { throw new Error("Invalid lead decision"); } })).rejects.toMatchObject({ telepathicCall: { status: "failed", responseText: "Complete target" } });
 await result; expect(f.attempt).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual(["prepared", "dispatched", "failed"]);
  });
  it("stops on permanent storage failure without relabeling a received result uncertain", async () => {
    const f = fixture(async call => { if (call.status === "succeeded") throw new Error("disk full"); });
    await expect(executeTelepathicProviderPacket(f.input)).rejects.toMatchObject({ name: "TelepathicCheckpointError", telepathicCall: { status: "succeeded", responseText: "Complete target" } });
    expect(f.attempt).toHaveBeenCalledTimes(1);
  });
  it("does not multiply retry budgets when the repository has already exhausted BUSY retries", async () => {
    const inner = new SqliteWriteCoordinator([1, 2], async () => undefined); let saves = 0;
    const f = fixture(call => inner.run(async () => { if (call.status === "succeeded") { saves++; throw new Error("database is locked"); } }));
    const result = expect(executeTelepathicProviderPacket(f.input)).rejects.toBeInstanceOf(TelepathicCheckpointError);
 await result; expect(saves).toBe(3); expect(f.attempt).toHaveBeenCalledTimes(1);
  });
  it.each(["prepared", "dispatched"] as const)("does not dispatch after STOP during a %s checkpoint retry", async (status) => {
    const controller = new AbortController(); let first = true;
    const f = fixture(async call => { if (first && call.status === status) { first = false; controller.abort(); throw new Error("SQLITE_BUSY"); } }, controller.signal);
    const result = expect(executeTelepathicProviderPacket(f.input)).rejects.toMatchObject({ name: "AbortError" });
 await result; expect(f.attempt).not.toHaveBeenCalled();
  });
  it("does not retry an actual provider request when the series checkpoint fails", async () => {
    const f = fixture(async () => undefined);
    const store = new InMemoryTelepathicExchangeStore();
    await store.saveTelepathicSeries(createTelepathicSeriesState({ schemaVersion: 1, seriesId: "recovery", seriesWorkspaceId: "w", mode: "conversation_exchange", language: "en", participants: [ai("a"), ai("b")], roundCount: 1, topic: "any", discloseTopicToReceivers: false, senderPolicy: { kind: "rotate" } }));
    const save = store.saveTelepathicSeries.bind(store);
    store.saveTelepathicSeries = async state => { if (state.providerCalls.some(call => call.status === "succeeded")) throw new Error("disk full"); await save(state); };
    await expect(runNextTelepathicAiRound({ store, resolveRoute: async () => f.route, providerAttempt: f.attempt }, "recovery")).rejects.toThrow();
    expect(f.attempt).toHaveBeenCalledTimes(1);
    expect((await store.getTelepathicSeries("recovery"))!.providerCalls.map(call => call.status)).toEqual(["dispatched"]);
  });
});

describe.each([
  { mode: "ai_ai_training" as const, fixed: false },
  { mode: "conversation_exchange" as const, fixed: false },
  { mode: "ai_ai_training" as const, fixed: true },
  { mode: "conversation_exchange" as const, fixed: true },
])("checkpoint failure propagation: $mode, fixed=$fixed", ({ mode, fixed }) => {
  for (const finalization of [false, true]) {
    it.each(["uncertain_commit", "exhausted", "direct_commit", "direct_exhausted"] as const)(
      `${finalization ? "finalization" : "round"}: %s is not replayed by an outer handler`,
      async failure => {
        const f = fixture(async () => undefined);
        const store = new InMemoryTelepathicExchangeStore();
        const initial = createTelepathicSeriesState({
          schemaVersion: 1, seriesId: "recovery", seriesWorkspaceId: "w", mode,
          language: "en", participants: [ai("a"), ai("b")], roundCount: 1,
          topic: "any", discloseTopicToReceivers: false,
          senderPolicy: fixed ? { kind: "fixed_ai", participantId: "a" } : { kind: "rotate" },
          ...(fixed ? { protocolVersion: "fixed_lead_v1" as const, maxGuidanceCycles: 3 as const } : {}),
        });
        if (finalization) {
          initial.rounds[0].status = "completed";
          initial.currentRoundIndex = initial.rounds.length;
          initial.status = fixed ? "paused" : "completed";
        }
        await store.saveTelepathicSeries(initial);
        const save = store.saveTelepathicSeries.bind(store);
        const inner = new SqliteWriteCoordinator([1, 2], async () => undefined);
        const direct = failure.startsWith("direct_");
        const exhausted = failure.endsWith("exhausted");
        const nativeError = new Error(exhausted ? "SQLITE_BUSY" : "[sqlite-no-retry] telepathic commit outcome requires checkpoint inspection: SQLITE_BUSY");
        const writes: string[] = [];
        let unsaved: import("./types").TelepathicSeriesState | undefined;
        let beforeFailure: import("./types").TelepathicSeriesState | undefined;
        store.saveTelepathicSeries = async state => {
          const call = state.providerCalls.find(item => item.status === "succeeded");
          const directCheckpointReady = finalization ? Boolean(state.finalReflections.a) : Boolean(state.rounds[0].target);
          if (!call || direct && !directCheckpointReady) return save(state);
          unsaved = state;
          beforeFailure ??= structuredClone(state);
          if (exhausted) return inner.run(async () => { writes.push(call.id); throw nativeError; });
          writes.push(call.id);
          // The result is durable, but the acknowledgement is ambiguous.
          await save(state);
          throw nativeError;
        };
        const deps = { store, resolveRoute: async () => f.route, providerAttempt: f.attempt };
        const run = finalization ? runTelepathicFinalReflections
          : mode === "conversation_exchange" ? advanceTelepathicConversationSeries : runNextTelepathicAiRound;
        const error = await run(deps, "recovery").catch(cause => cause);
        expect(error).toBeInstanceOf(direct ? TelepathicSeriesCheckpointError : TelepathicCheckpointError);
        if (exhausted) {
          expect(error.cause).toBeInstanceOf(SqliteWriteRetryExhaustedError);
          expect(error.cause.cause).toBe(nativeError);
        } else expect(error.cause).toBe(nativeError);
        expect(writes).toHaveLength(exhausted ? 3 : 1);
        expect(new Set(writes).size).toBe(1);
        expect(f.attempt).toHaveBeenCalledTimes(1);
        expect(unsaved).toEqual(beforeFailure);
        if (direct) {
          expect(error.state.providerCalls[0]).toMatchObject({ status: "succeeded", responseText: "Complete target", providerRequestId: "generation-1" });
          expect(error.state).toEqual(beforeFailure);
          expect(error.state).not.toBe(unsaved);
        } else expect(error.telepathicCall).toMatchObject({ status: "succeeded", responseText: "Complete target", providerRequestId: "generation-1" });
        const durable = (await store.getTelepathicSeries("recovery"))!;
        expect(durable.status).not.toBe("blocked");
        expect(durable.rounds[0].blockedReason).toBeUndefined();
        if (!exhausted || direct) expect(durable.providerCalls[0].status).toBe("succeeded");
        else expect(durable.providerCalls[0].status).toBe("dispatched");
      },
    );
  }
});
