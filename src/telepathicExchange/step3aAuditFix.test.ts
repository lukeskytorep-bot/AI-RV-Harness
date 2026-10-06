import { describe, expect, it, vi } from "vitest";
import type { AiIdentity } from "../aiCenter/types";
import { ProviderCallError } from "../providers/providerError";
import type { ProviderChatAttempt } from "../providers/requestExecutor";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import type { AppRepository } from "../storage/repository";
import type { Profile, Workspace } from "../types";
import { recordFirstBlindResponse } from "./blind";
import { createTelepathicSeriesState, runNextTelepathicAiRound, runTelepathicFinalReflections } from "./engine";
import { buildReceiverFirstPacket } from "./packets";
import { executeTelepathicProviderPacket, resolveTelepathicAiRouteFromRepository, type ResolvedTelepathicAiRoute } from "./providerGateway";
import { InMemoryTelepathicExchangeStore } from "./store";
import { lockTelepathicTarget, markTelepathicTargetTransmissionReady } from "./target";
import type { TelepathicParticipant, TelepathicSeriesConfig } from "./types";

const capturedAt = "2026-10-06T22:00:00.000Z";

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

function model(id: string, contextTokens = 64_000): ProviderModel {
  return {
    providerConfigId: `provider-${id}`,
    provider: "custom_openai",
    modelId: `model-${id}`,
    displayName: `${id} model`,
    route: `custom_openai:model-${id}`,
    capabilities: {
      contextTokens,
      maxOutputTokens: 1024,
      inputModalities: ["text"],
      outputModalities: ["text"],
      supportsVision: false,
      supportsStreaming: false,
      reasoning: { supported: false, efforts: [], confidence: "unknown" },
      temperature: { supported: true, min: 0, max: 2, confidence: "provider_metadata" },
      supportedParameters: ["temperature"],
      source: "provider",
      capturedAt,
    },
    pricing: {},
    recommended: true,
    rawMetadata: {},
    refreshedAt: capturedAt,
  };
}

function provider(id: string, fingerprint = `fingerprint-${id}`): ProviderConfig {
  return {
    id: `provider-${id}`,
    provider: "custom_openai",
    label: id,
    credentialId: `credential-${id}`,
    credentialFingerprint: fingerprint,
    baseUrl: "https://example.test/v1",
    enabled: true,
    createdAt: capturedAt,
    updatedAt: capturedAt,
  };
}

function routeFor(participant: TelepathicParticipant, contextTokens = 64_000): ResolvedTelepathicAiRoute {
  const id = participant.id;
  return {
    snapshot: structuredClone(participant.ai!),
    providerConfig: provider(id),
    model: model(id, contextTokens),
    requestedSettings: { temperature: 0.9 },
    validatedIdentity: {
      profileId: participant.ai!.profileId,
      workspaceId: participant.ai!.workspaceId,
      aiIdentityId: participant.ai!.aiIdentityId,
      credentialFingerprint: participant.ai!.credentialFingerprint,
    },
  };
}

function series(roundCount = 1): TelepathicSeriesConfig {
  return {
    schemaVersion: 1,
    seriesId: "series-audit-fix",
    seriesWorkspaceId: "workspace-leo",
    mode: "conversation_exchange",
    language: "en",
    participants: [ai("leo"), ai("nemo")],
    roundCount,
    topic: "location",
    discloseTopicToReceivers: false,
    senderPolicy: { kind: "fixed_ai", participantId: "leo" },
  };
}

function repositoryFor(participant: TelepathicParticipant, fingerprint = participant.ai!.credentialFingerprint): AppRepository {
  const profile: Profile = { id: participant.ai!.profileId, name: participant.displayName, createdAt: capturedAt, updatedAt: capturedAt };
  const workspace: Workspace = { id: participant.ai!.workspaceId, profileId: profile.id, name: "Workspace", kind: "conversation", createdAt: capturedAt, updatedAt: capturedAt, lastOpenedAt: capturedAt };
  const identity: AiIdentity = {
    id: participant.ai!.aiIdentityId,
    profileId: profile.id,
    credentialFingerprint: fingerprint,
    credentialDisplay: "…TEST",
    providerConfigId: participant.ai!.providerConfigId,
    provider: "custom_openai",
    normalizedBaseUrl: "https://example.test/v1",
    modelId: participant.ai!.modelId,
    modelRoute: participant.ai!.route,
    modelDisplayName: "Model",
    role: "viewer",
    routeStatus: "available",
    firstUsedAt: capturedAt,
    lastUsedAt: capturedAt,
    createdAt: capturedAt,
    updatedAt: capturedAt,
  };
  return {
    listProfiles: async () => [profile],
    listWorkspaces: async () => [workspace],
    listProviderConfigs: async () => [provider(participant.id, fingerprint)],
    listProviderModels: async () => [model(participant.id)],
    listAiIdentities: async () => [identity],
  } as unknown as AppRepository;
}

describe("TELEPATHIC STEP 3A audit fixes", () => {
  it("resolves a participant through live Profile -> Workspace -> identity -> credential -> model and rejects credential drift", async () => {
    const leo = ai("leo");
    await expect(resolveTelepathicAiRouteFromRepository({ repository: repositoryFor(leo), participant: leo, requestedSettings: { temperature: 0.9 } }))
      .resolves.toMatchObject({ validatedIdentity: { profileId: "profile-leo", workspaceId: "workspace-leo", aiIdentityId: "identity-leo", credentialFingerprint: "fingerprint-leo" } });

    await expect(resolveTelepathicAiRouteFromRepository({ repository: repositoryFor(leo, "rotated-fingerprint"), participant: leo, requestedSettings: { temperature: 0.9 } }))
      .rejects.toThrow(/credential fingerprint changed/);

    const archivedRepo = repositoryFor(leo) as unknown as Record<string, unknown>;
    archivedRepo.listWorkspaces = async () => [];
    await expect(resolveTelepathicAiRouteFromRepository({ repository: archivedRepo as unknown as AppRepository, participant: leo, requestedSettings: {} }))
      .rejects.toThrow(/Workspace is no longer active/);
  });

  it("marks a timeout while awaiting headers as uncertain after durable dispatch", async () => {
    const nemo = ai("nemo");
    const records: Array<{ status: string }> = [];
    const packet = buildReceiverFirstPacket({ language: "en", seriesId: "s", roundId: "r", participantId: nemo.id, name: nemo.displayName, roundNumber: 1, topicLabel: "location", discloseTopic: false });
    const attempt: ProviderChatAttempt = async () => {
      throw new ProviderCallError({ code: "timeout", message: "header timeout", phase: "awaiting_headers" });
    };
    await expect(executeTelepathicProviderPacket({
      packet,
      route: routeFor(nemo),
      technicalAttempt: 1,
      attempt,
      hooks: {
        createCallId: () => "call-timeout",
        now: () => capturedAt,
        persist: async (record) => { records.push({ status: record.status }); },
      },
    })).rejects.toThrow(/header timeout/);
    expect(records.at(-1)?.status).toBe("uncertain");
  });

  it("resumes inside a blind round without repeating the target or completed first blind call", async () => {
    const cfg = series(1);
    const store = new InMemoryTelepathicExchangeStore();
    const state = createTelepathicSeriesState(cfg, capturedAt);
    const round = state.rounds[0];
    round.status = "blind";
    round.target = await markTelepathicTargetTransmissionReady(await lockTelepathicTarget(round.assignment.roundId, "leo", { content: "LOCKED_TARGET" }, capturedAt), capturedAt);
    round.blindByParticipant.nemo = recordFirstBlindResponse(round.blindByParticipant.nemo, "FIRST_ALREADY_SAVED");
    state.status = "running";
    await store.saveTelepathicSeries(state);

    const sent: string[] = [];
    const attempt: ProviderChatAttempt = async (request) => {
      const content = request.messages.map((message) => message.content).join("\n");
      sent.push(content);
      if (content.includes("After this step we will close your description")) return { content: "SECOND_ONLY", usage: {} };
      if (content.includes("Reply YES or NO")) return { content: "NO", usage: {} };
      return { content: "reflection", usage: {} };
    };
    const deps = { store, providerAttempt: attempt, resolveRoute: async (p: TelepathicParticipant) => routeFor(p) };
    const finished = await runNextTelepathicAiRound(deps, cfg.seriesId);
    expect(finished.rounds[0].status).toBe("completed");
    expect(sent.some((content) => content.includes("please prepare one specific target"))).toBe(false);
    expect(sent.some((content) => content.includes("Please give your first description"))).toBe(false);
    expect(sent.some((content) => content.includes("After this step we will close your description"))).toBe(true);
  });

  it("reuses a durably succeeded final-reflection response instead of billing it again after a crash window", async () => {
    const cfg = series(1);
    const store = new InMemoryTelepathicExchangeStore();
    const state = createTelepathicSeriesState(cfg, capturedAt);
    state.rounds[0].status = "completed";
    state.currentRoundIndex = 1;
    state.status = "completed";
    state.finalReflections.nemo = "already complete";
    state.providerCalls.push({
      id: "final-leo",
      seriesId: cfg.seriesId,
      roundId: "series-complete",
      participantId: "leo",
      callStage: "series_reflection",
      technicalAttempt: 1,
      status: "succeeded",
      scopeKey: `telepathic-series:${cfg.seriesId}:round:series-complete:participant:leo:stage:series_reflection`,
      requestSha256: "hash",
      responseText: "RECOVERED_FINAL",
      createdAt: capturedAt,
      updatedAt: capturedAt,
    });
    await store.saveTelepathicSeries(state);
    const attempt = vi.fn<ProviderChatAttempt>(async () => ({ content: "SHOULD_NOT_RUN", usage: {} }));
    const finished = await runTelepathicFinalReflections({ store, providerAttempt: attempt, resolveRoute: async (p) => routeFor(p) }, cfg.seriesId);
    expect(finished.finalReflections.leo).toBe("RECOVERED_FINAL");
    expect(attempt).not.toHaveBeenCalled();
  });

  it("rejects two concurrent starts or resumes for the same series before a duplicate provider dispatch can occur", async () => {
    const cfg = series(1);
    const store = new InMemoryTelepathicExchangeStore();
    await store.saveTelepathicSeries(createTelepathicSeriesState(cfg, capturedAt));

    let releaseFirst!: () => void;
    const firstDispatchStarted = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let unblockProvider!: () => void;
    const providerGate = new Promise<void>((resolve) => { unblockProvider = resolve; });
    const attempt = vi.fn<ProviderChatAttempt>(async () => {
      releaseFirst();
      await providerGate;
      return { content: "TARGET", usage: {} };
    });
    const deps = { store, providerAttempt: attempt, resolveRoute: async (p: TelepathicParticipant) => routeFor(p) };

    const firstRun = runNextTelepathicAiRound(deps, cfg.seriesId);
    await firstDispatchStarted;
    await expect(runNextTelepathicAiRound(deps, cfg.seriesId)).rejects.toThrow(/already running/);
    expect(attempt).toHaveBeenCalledTimes(1);

    unblockProvider();
    await firstRun.catch(() => undefined);
  });

  it("blocks an oversized final-series packet before provider dispatch and never truncates rounds", async () => {
    const cfg = series(1);
    const store = new InMemoryTelepathicExchangeStore();
    const state = createTelepathicSeriesState(cfg, capturedAt);
    state.rounds[0].status = "completed";
    state.rounds[0].target = await markTelepathicTargetTransmissionReady(await lockTelepathicTarget(state.rounds[0].assignment.roundId, "leo", { content: "X".repeat(5000) }, capturedAt), capturedAt);
    state.currentRoundIndex = 1;
    state.status = "completed";
    state.finalReflections.nemo = "already complete";
    await store.saveTelepathicSeries(state);
    const attempt = vi.fn<ProviderChatAttempt>(async () => ({ content: "SHOULD_NOT_RUN", usage: {} }));
    await expect(runTelepathicFinalReflections({ store, providerAttempt: attempt, resolveRoute: async (p) => routeFor(p, 128) }, cfg.seriesId))
      .rejects.toThrow(/exceeds the model context budget/);
    expect(attempt).not.toHaveBeenCalled();
  });
});
