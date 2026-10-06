import { describe, expect, it } from "vitest";
import type { ProviderChatAttempt } from "../providers/requestExecutor";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import { createTelepathicSeriesState, runNextTelepathicAiRound, runTelepathicFinalReflections } from "./engine";
import type { ResolvedTelepathicAiRoute } from "./providerGateway";
import { InMemoryTelepathicExchangeStore } from "./store";
import type { TelepathicParticipant, TelepathicSeriesConfig } from "./types";

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

const config: TelepathicSeriesConfig = {
  schemaVersion: 1,
  seriesId: "series-step3a",
  seriesWorkspaceId: "workspace-leo",
  mode: "conversation_exchange",
  language: "en",
  participants: [ai("leo"), ai("nemo")],
  roundCount: 2,
  topic: "location",
  discloseTopicToReceivers: false,
  senderPolicy: { kind: "rotate" },
};

describe("TELEPATHIC-EXCHANGE-STEP3A executable round", () => {
  it("runs two persisted isolated rounds through the real provider gateway and resumes from the stable checkpoint", async () => {
    const store = new InMemoryTelepathicExchangeStore();
    let idCounter = 0;
    let nowCounter = 0;
    const captured: Array<{ modelId: string; content: string; hasContinuation: boolean }> = [];

    const attempt: ProviderChatAttempt = async (request) => {
      const content = request.messages.map((message) => message.content).join("\n");
      captured.push({ modelId: request.modelId, content, hasContinuation: request.messages.some((message) => Boolean(message.continuationState)) });
      let response = "Reflection saved.";
      if (content.includes("please prepare one specific target")) response = content.includes("round 1") ? "LOCKED_TARGET_ALPHA" : "LOCKED_TARGET_BETA";
      else if (content.includes("Please give your first description")) response = "cool vertical textured form with motion";
      else if (content.includes("After this step we will close your description")) response = "open surroundings and a hard surface";
      else if (content.includes("Reply YES or NO")) response = request.modelId === "model-leo" ? "YES" : "maybe";
      else if (content.includes("Here are the available answers from others")) response = "Post-Reveal comment.";
      else if (content.includes("All rounds in this series are complete")) response = "Final series reflection.";
      return { content: response, usage: {}, providerRequestId: `req-${captured.length}` };
    };

    const deps = {
      store,
      providerAttempt: attempt,
      now: () => `2026-10-06T20:00:${String(nowCounter++).padStart(2, "0")}.000Z`,
      createId: (prefix: string) => `${prefix}-${++idCounter}`,
      resolveRoute: async (participant: TelepathicParticipant): Promise<ResolvedTelepathicAiRoute> => {
        const id = participant.id;
        return {
          snapshot: structuredClone(participant.ai!),
          providerConfig: configFor(id),
          model: model(id),
          requestedSettings: { temperature: 0.9 },
          validatedIdentity: {
            profileId: participant.ai!.profileId,
            workspaceId: participant.ai!.workspaceId,
            aiIdentityId: participant.ai!.aiIdentityId,
            credentialFingerprint: participant.ai!.credentialFingerprint,
          },
        };
      },
    };

    await store.saveTelepathicSeries(createTelepathicSeriesState(config, "2026-10-06T20:00:00.000Z"));
    const afterFirst = await runNextTelepathicAiRound(deps, config.seriesId);
    expect(afterFirst.status).toBe("paused");
    expect(afterFirst.currentRoundIndex).toBe(1);
    expect(afterFirst.rounds[0].target?.content).toBe("LOCKED_TARGET_ALPHA");
    expect(afterFirst.rounds[0].status).toBe("completed");
    expect(afterFirst.rounds[0].reflectionsByParticipant.leo.shareOthersConsent).toBe("yes");
    expect(afterFirst.rounds[0].reflectionsByParticipant.nemo.shareOthersConsent).toBe("no");
    expect(afterFirst.rounds[0].reflectionsByParticipant.nemo.sharedAnswersComment).toBeUndefined();

    const persisted = await store.getTelepathicSeries(config.seriesId);
    expect(persisted?.currentRoundIndex).toBe(1);
    const beforeRoundTwoCalls = captured.length;
    const afterSecond = await runNextTelepathicAiRound(deps, config.seriesId);
    expect(afterSecond.status).toBe("completed");
    expect(afterSecond.rounds[1].target?.content).toBe("LOCKED_TARGET_BETA");

    const roundTwoPreReveal = captured.slice(beforeRoundTwoCalls).filter((entry) =>
      entry.content.includes("please prepare one specific target")
      || entry.content.includes("Please give your first description")
      || entry.content.includes("After this step we will close your description"),
    );
    for (const request of roundTwoPreReveal) {
      expect(request.content).not.toContain("LOCKED_TARGET_ALPHA");
      if (request.content.includes("Please give your first description") || request.content.includes("After this step we will close your description")) {
        expect(request.content).not.toContain("location");
      }
      expect(request.hasContinuation).toBe(false);
    }

    const finished = await runTelepathicFinalReflections(deps, config.seriesId);
    expect(finished.finalReflections.leo).toBe("Final series reflection.");
    expect(finished.finalReflections.nemo).toBe("Final series reflection.");
    expect(finished.providerCalls.every((call) => call.status === "succeeded")).toBe(true);
    expect(captured.every((entry) => !entry.hasContinuation)).toBe(true);

    const firstReceiverPreReveal = captured.find((entry) => entry.content.includes("Please give your first description"));
    expect(firstReceiverPreReveal?.content).not.toContain("LOCKED_TARGET_ALPHA");
    expect(firstReceiverPreReveal?.content).not.toContain("LOCKED_TARGET_BETA");
    expect(firstReceiverPreReveal?.content).not.toContain("location");
  });
});
