import { describe, expect, it } from "vitest";
import type { ProviderChatAttempt } from "../providers/requestExecutor";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import {
  advanceTelepathicConversationSeries,
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

const human: TelepathicParticipant = { id: "human", kind: "human", displayName: "Edward" };
const ai: TelepathicParticipant = {
  id: "ai:leo",
  kind: "ai",
  displayName: "Leo",
  ai: {
    profileId: "profile-leo",
    profileName: "Leo",
    workspaceId: "workspace-leo",
    aiIdentityId: "identity-leo",
    providerConfigId: "provider-leo",
    credentialId: "credential-leo",
    credentialFingerprint: "fingerprint-leo",
    modelId: "model-leo",
    route: "custom_openai:model-leo",
  },
};

function providerConfig(): ProviderConfig {
  return { id: "provider-leo", provider: "custom_openai", label: "Leo", credentialId: "credential-leo", credentialFingerprint: "fingerprint-leo", baseUrl: "https://example.test/v1", enabled: true, createdAt: "now", updatedAt: "now" };
}
function model(): ProviderModel {
  return {
    providerConfigId: "provider-leo", provider: "custom_openai", modelId: "model-leo", displayName: "Leo model", route: "custom_openai:model-leo",
    capabilities: { contextTokens: 64_000, maxOutputTokens: 4096, inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: false, reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: true, min: 0, max: 2, confidence: "provider_metadata" }, supportedParameters: ["temperature"], source: "provider", capturedAt: "now" },
    pricing: {}, recommended: true, rawMetadata: {}, refreshedAt: "now",
  };
}

const config: TelepathicSeriesConfig = {
  schemaVersion: 1,
  seriesId: "series-human",
  seriesWorkspaceId: "workspace-human",
  mode: "conversation_exchange",
  language: "en",
  participants: [human, ai],
  roundCount: 2,
  topic: "location",
  discloseTopicToReceivers: false,
  senderPolicy: { kind: "rotate" },
};

describe("Conversation telepathic exchange human interaction", () => {
  it("runs human-sender and human-receiver rounds without revealing target or prior-round data early", async () => {
    const store = new InMemoryTelepathicExchangeStore();
    const captured: string[] = [];
    let call = 0;
    const attempt: ProviderChatAttempt = async (request) => {
      const content = request.messages.map((message) => message.content).join("\n");
      captured.push(content);
      if (content.includes("please prepare one specific target")) return { content: "AI_TARGET_BETA", usage: {}, providerRequestId: `r${++call}` };
      if (content.includes("Please give your first description")) return { content: "vertical cool motion", usage: {}, providerRequestId: `r${++call}` };
      if (content.includes("After this step we will close your description")) return { content: "hard surface", usage: {}, providerRequestId: `r${++call}` };
      if (content.includes("Reply YES or NO")) return { content: "NO", usage: {}, providerRequestId: `r${++call}` };
      return { content: "AI reflection", usage: {}, providerRequestId: `r${++call}` };
    };
    const deps = {
      store,
      providerAttempt: attempt,
      resolveRoute: async (participant: TelepathicParticipant): Promise<ResolvedTelepathicAiRoute> => ({
        snapshot: structuredClone(participant.ai!), providerConfig: providerConfig(), model: model(), requestedSettings: { temperature: 0.9 },
        validatedIdentity: { profileId: participant.ai!.profileId, workspaceId: participant.ai!.workspaceId, aiIdentityId: participant.ai!.aiIdentityId, credentialFingerprint: participant.ai!.credentialFingerprint },
      }),
    };

    await store.saveTelepathicSeries(createTelepathicSeriesState(config, "2026-10-07T08:00:00.000Z"));
    let state = await advanceTelepathicConversationSeries(deps, config.seriesId);
    expect(telepathicConversationHumanStep(state).kind).toBe("prepare_target");

    state = await saveHumanTelepathicTarget(deps, config.seriesId, { content: "HUMAN_TARGET_ALPHA" });
    expect(telepathicConversationHumanStep(state).kind).toBe("confirm_transmission");
    await confirmHumanTelepathicTransmission(deps, config.seriesId);
    state = await advanceTelepathicConversationSeries(deps, config.seriesId);
    expect(state.rounds[0].revealedAt).toBeTruthy();
    expect(telepathicConversationHumanStep(state)).toMatchObject({ kind: "reflection", role: "sender" });
    expect(captured.find((item) => item.includes("Please give your first description"))).not.toContain("HUMAN_TARGET_ALPHA");

    await saveHumanTelepathicReflection(deps, config.seriesId, "Human sender reflection");
    state = await advanceTelepathicConversationSeries(deps, config.seriesId);
    expect(state.currentRoundIndex).toBe(1);

    const beforeSecond = captured.length;
    state = await advanceTelepathicConversationSeries(deps, config.seriesId);
    expect(telepathicConversationHumanStep(state).kind).toBe("blind_first");
    const secondRoundPreReveal = captured.slice(beforeSecond).join("\n");
    expect(secondRoundPreReveal).not.toContain("HUMAN_TARGET_ALPHA");
    expect(secondRoundPreReveal).not.toContain("Human sender reflection");

    await saveHumanTelepathicFirstBlind(deps, config.seriesId, "warm open curved");
    await sealHumanTelepathicBlind(deps, config.seriesId, "movement outside");
    state = await advanceTelepathicConversationSeries(deps, config.seriesId);
    expect(state.rounds[1].target?.content).toBe("AI_TARGET_BETA");
    expect(state.rounds[1].revealedAt).toBeTruthy();
    expect(telepathicConversationHumanStep(state)).toMatchObject({ kind: "reflection", role: "receiver" });

    await saveHumanTelepathicReflection(deps, config.seriesId, "Human receiver reflection");
    state = await advanceTelepathicConversationSeries(deps, config.seriesId);
    expect(state.status).toBe("completed");
    expect(state.rounds.every((round) => round.status === "completed")).toBe(true);
  });
});
