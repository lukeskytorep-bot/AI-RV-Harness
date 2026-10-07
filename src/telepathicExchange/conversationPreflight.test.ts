import { describe, expect, it } from "vitest";
import type { ProviderModel } from "../providers/types";
import { preflightTelepathicConversationConfig } from "./conversationPreflight";
import type { TelepathicSeriesConfig } from "./types";

function model(contextTokens = 131072): ProviderModel {
  return {
    providerConfigId: "pc",
    modelId: "model",
    displayName: "Model",
    route: "model",
    enabled: true,
    mode: "chat",
    capabilities: { contextTokens, maxOutputTokens: 4096, supportsImages: false, supportsReasoning: false },
    pricing: { promptPerToken: 0.000001, completionPerToken: 0.000002 },
  };
}

function config(): TelepathicSeriesConfig {
  return {
    schemaVersion: 1,
    seriesId: "preview",
    seriesWorkspaceId: "workspace",
    mode: "conversation_exchange",
    language: "en",
    roundCount: 3,
    topic: "any",
    discloseTopicToReceivers: false,
    senderPolicy: { kind: "rotate" },
    participants: [
      { id: "human", kind: "human", displayName: "Edward" },
      { id: "ai:p1", kind: "ai", displayName: "Leo", ai: { profileId: "p1", profileName: "Leo", workspaceId: "w1", aiIdentityId: "id1", providerConfigId: "pc", credentialId: "cred", credentialFingerprint: "fp", modelId: "model", route: "model" } },
    ],
  };
}

describe("STEP 6 Conversation telepathic pre-start budget", () => {
  it("shows a viable real-world-size route without replacing runtime dispatch guards", () => {
    const result = preflightTelepathicConversationConfig({ config: config(), modelByParticipantId: { "ai:p1": model(131072) } });
    expect(result.ok).toBe(true);
    expect(result.estimatedProviderCalls).toBe(16);
    expect(result.participants[0]?.contextLimit).toBe(131072);
    expect(result.estimatedBaselineCostUsd).toBeGreaterThan(0);
  });

  it("blocks Start preview when even a representative packet cannot fit the selected route", () => {
    const result = preflightTelepathicConversationConfig({ config: config(), modelByParticipantId: { "ai:p1": model(100) } });
    expect(result.ok).toBe(false);
    expect(result.participants[0]?.exceeded).toBe(true);
  });
});
