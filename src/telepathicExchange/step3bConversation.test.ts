import { describe, expect, it } from "vitest";
import type { ProviderChatAttempt } from "../providers/requestExecutor";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import {
  advanceTelepathicConversationSeries,
  cancelCurrentTelepathicRoundBeforeReveal,
  confirmHumanTelepathicTransmission,
  createTelepathicSeriesState,
  saveHumanTelepathicFirstBlind,
  saveHumanTelepathicReflection,
  saveHumanTelepathicTarget,
  sealHumanTelepathicBlind,
  telepathicConversationHumanStep,
} from "./engine";
import type { ResolvedTelepathicAiRoute } from "./providerGateway";
import { InMemoryTelepathicExchangeStore } from "./store";
import type { TelepathicParticipant, TelepathicSeriesConfig } from "./types";

function human(id = "human"): TelepathicParticipant {
  return { id, kind: "human", displayName: "Edward" };
}

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
      capturedAt: "2026-10-07T08:00:00.000Z",
    },
    pricing: {},
    recommended: true,
    rawMetadata: {},
    refreshedAt: "2026-10-07T08:00:00.000Z",
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
    createdAt: "2026-10-07T08:00:00.000Z",
    updatedAt: "2026-10-07T08:00:00.000Z",
  };
}

function harness(store: InMemoryTelepathicExchangeStore) {
  let idCounter = 0;
  let nowCounter = 0;
  const captured: Array<{ modelId: string; content: string; hasContinuation: boolean }> = [];
  const attempt: ProviderChatAttempt = async (request) => {
    const content = request.messages.map((message) => message.content).join("\n");
    captured.push({ modelId: request.modelId, content, hasContinuation: request.messages.some((message) => Boolean(message.continuationState)) });
    let response = "Reflection saved.";
    if (content.includes("please prepare one specific target")) response = "AI_LOCKED_TARGET";
    else if (content.includes("confirm the transmission")) response = "READY";
    else if (content.includes("Please give your first description")) response = "cool vertical form";
    else if (content.includes("After this step we will close your description")) response = "hard surface and motion";
    else if (content.includes("Reply YES or NO")) response = "YES";
    else if (content.includes("Here are the available answers from others")) response = "Shared-answer comment.";
    return { content: response, usage: {}, providerRequestId: `req-${captured.length}` };
  };
  const deps = {
    store,
    providerAttempt: attempt,
    now: () => `2026-10-07T08:00:${String(nowCounter++).padStart(2, "0")}.000Z`,
    createId: (prefix: string) => `${prefix}-${++idCounter}`,
    resolveRoute: async (participant: TelepathicParticipant): Promise<ResolvedTelepathicAiRoute> => ({
      snapshot: structuredClone(participant.ai!),
      providerConfig: configFor(participant.id),
      model: model(participant.id),
      requestedSettings: { temperature: 0.9 },
      validatedIdentity: {
        profileId: participant.ai!.profileId,
        workspaceId: participant.ai!.workspaceId,
        aiIdentityId: participant.ai!.aiIdentityId,
        credentialFingerprint: participant.ai!.credentialFingerprint,
      },
    }),
  };
  return { deps, captured };
}

describe("TELEPATHIC-EXCHANGE-STEP3B Conversation human participation", () => {
  it("runs a human-sender round without leaking the locked target before Reveal", async () => {
    const store = new InMemoryTelepathicExchangeStore();
    const { deps, captured } = harness(store);
    const config: TelepathicSeriesConfig = {
      schemaVersion: 1,
      seriesId: "series-human-sender",
      seriesWorkspaceId: "conversation-owner",
      mode: "conversation_exchange",
      language: "en",
      participants: [human(), ai("leo"), ai("nemo")],
      roundCount: 1,
      topic: "location",
      discloseTopicToReceivers: false,
      senderPolicy: { kind: "human_only", humanParticipantId: "human" },
    };
    await store.saveTelepathicSeries(createTelepathicSeriesState(config));

    const awaitingTarget = await advanceTelepathicConversationSeries(deps, config.seriesId);
    expect(telepathicConversationHumanStep(awaitingTarget)).toMatchObject({ kind: "prepare_target" });
    expect(captured).toHaveLength(0);

    const locked = await saveHumanTelepathicTarget(deps, config.seriesId, { content: "HUMAN_SECRET_TARGET" });
    expect(telepathicConversationHumanStep(locked)).toMatchObject({ kind: "confirm_transmission" });
    await confirmHumanTelepathicTransmission(deps, config.seriesId);
    const afterAiWork = await advanceTelepathicConversationSeries(deps, config.seriesId);

    expect(afterAiWork.rounds[0].revealedAt).toBeTruthy();
    expect(telepathicConversationHumanStep(afterAiWork)).toMatchObject({ kind: "reflection", role: "sender" });
    const preReveal = captured.filter((entry) => entry.content.includes("Please give your first description") || entry.content.includes("After this step we will close your description"));
    expect(preReveal.length).toBeGreaterThan(0);
    for (const request of preReveal) {
      expect(request.content).not.toContain("HUMAN_SECRET_TARGET");
      expect(request.content).not.toContain("location");
      expect(request.hasContinuation).toBe(false);
    }

    await saveHumanTelepathicReflection(deps, config.seriesId, "I prepared a clear target.");
    const finished = await advanceTelepathicConversationSeries(deps, config.seriesId);
    expect(finished.status).toBe("completed");
    expect(finished.rounds[0].reflectionsByParticipant.human.reflection).toBe("I prepared a clear target.");
  });

  it("pauses an AI-sender round for the human receiver and supports cancel-before-Reveal", async () => {
    const store = new InMemoryTelepathicExchangeStore();
    const { deps } = harness(store);
    const config: TelepathicSeriesConfig = {
      schemaVersion: 1,
      seriesId: "series-human-receiver-cancel",
      seriesWorkspaceId: "conversation-owner",
      mode: "conversation_exchange",
      language: "en",
      participants: [human(), ai("leo"), ai("nemo")],
      roundCount: 1,
      topic: "person",
      discloseTopicToReceivers: false,
      senderPolicy: { kind: "fixed_ai", participantId: "leo" },
    };
    await store.saveTelepathicSeries(createTelepathicSeriesState(config));

    const paused = await advanceTelepathicConversationSeries(deps, config.seriesId);
    expect(paused.rounds[0].target?.content).toBe("AI_LOCKED_TARGET");
    expect(paused.rounds[0].revealedAt).toBeUndefined();
    expect(telepathicConversationHumanStep(paused)).toMatchObject({ kind: "blind_first" });

    const afterFirst = await saveHumanTelepathicFirstBlind(deps, config.seriesId, "warm moving shape");
    expect(telepathicConversationHumanStep(afterFirst)).toMatchObject({ kind: "blind_second" });
    const cancelled = await cancelCurrentTelepathicRoundBeforeReveal(deps, config.seriesId);
    expect(cancelled.status).toBe("completed");
    expect(cancelled.rounds[0].status).toBe("cancelled");
    expect(cancelled.rounds[0].revealedAt).toBeUndefined();
  });

  it("completes an AI-sender round only after the human seals blind and writes a post-Reveal reflection", async () => {
    const store = new InMemoryTelepathicExchangeStore();
    const { deps, captured } = harness(store);
    const config: TelepathicSeriesConfig = {
      schemaVersion: 1,
      seriesId: "series-human-receiver-complete",
      seriesWorkspaceId: "conversation-owner",
      mode: "conversation_exchange",
      language: "en",
      participants: [human(), ai("leo"), ai("nemo")],
      roundCount: 1,
      topic: "person",
      discloseTopicToReceivers: false,
      senderPolicy: { kind: "fixed_ai", participantId: "leo" },
    };
    await store.saveTelepathicSeries(createTelepathicSeriesState(config));

    await advanceTelepathicConversationSeries(deps, config.seriesId);
    await saveHumanTelepathicFirstBlind(deps, config.seriesId, "warm moving shape");
    await sealHumanTelepathicBlind(deps, config.seriesId, "human silhouette nearby");
    const revealed = await advanceTelepathicConversationSeries(deps, config.seriesId);
    expect(revealed.rounds[0].revealedAt).toBeTruthy();
    expect(telepathicConversationHumanStep(revealed)).toMatchObject({ kind: "reflection", role: "receiver" });

    await saveHumanTelepathicReflection(deps, config.seriesId, "Some movement was consistent with the target.");
    const finished = await advanceTelepathicConversationSeries(deps, config.seriesId);
    expect(finished.status).toBe("completed");
    expect(finished.rounds[0].blindByParticipant.human.status).toBe("sealed");
    expect(finished.rounds[0].reflectionsByParticipant.human.reflection).toContain("movement");
    expect(captured.every((entry) => !entry.hasContinuation)).toBe(true);
  });
});
