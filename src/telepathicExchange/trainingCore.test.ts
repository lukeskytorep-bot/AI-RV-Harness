import { describe, expect, it } from "vitest";
import { sha256Text } from "../application/sha256";
import type { ProviderChatAttempt } from "../providers/requestExecutor";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import { createTelepathicSeriesState, runNextTelepathicAiRound, runTelepathicFinalReflections } from "./engine";
import type { ResolvedTelepathicAiRoute } from "./providerGateway";
import { InMemoryTelepathicExchangeStore } from "./store";
import type { TelepathicParticipant, TelepathicSeriesConfig } from "./types";

async function ai(id: string): Promise<TelepathicParticipant> {
  const fg = `${id.toUpperCase()} FROZEN FIELD GUIDE`;
  const vn = `${id.toUpperCase()} FROZEN VIEWER NOTES`;
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
    fieldGuide: { id: `fg-${id}`, version: "1", versionNumber: 1, content: fg, contentSha256: await sha256Text(fg), capturedAt: "2026-10-07T12:00:00.000Z", modelRoute: `custom_openai:model-${id}` },
    viewerNotes: { id: `vn-${id}`, version: "1", versionNumber: 1, content: vn, contentSha256: await sha256Text(vn), capturedAt: "2026-10-07T12:00:00.000Z", modelRoute: `custom_openai:model-${id}` },
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
      capturedAt: "2026-10-07T12:00:00.000Z",
    },
    pricing: {},
    recommended: true,
    rawMetadata: {},
    refreshedAt: "2026-10-07T12:00:00.000Z",
  };
}

function provider(id: string): ProviderConfig {
  return {
    id: `provider-${id}`,
    provider: "custom_openai",
    label: id,
    credentialId: `credential-${id}`,
    credentialFingerprint: `fingerprint-${id}`,
    baseUrl: "https://example.test/v1",
    enabled: true,
    createdAt: "2026-10-07T12:00:00.000Z",
    updatedAt: "2026-10-07T12:00:00.000Z",
  };
}

describe("STEP 4A AI-AI telepathic training core", () => {
  it("rotates three AI Profiles, uses only each participant's frozen learning, and preserves fresh round contexts", async () => {
    const participants = await Promise.all([ai("leo"), ai("nemo"), ai("aura")]);
    const config: TelepathicSeriesConfig = {
      schemaVersion: 1,
      seriesId: "training-4a",
      seriesWorkspaceId: "workspace-leo",
      mode: "ai_ai_training",
      language: "en",
      participants,
      roundCount: 3,
      topic: "structure_or_object",
      discloseTopicToReceivers: false,
      senderPolicy: { kind: "rotate" },
    };
    const store = new InMemoryTelepathicExchangeStore();
    await store.saveTelepathicSeries(createTelepathicSeriesState(config, "2026-10-07T12:00:00.000Z"));
    let idCounter = 0;
    const captured: Array<{ modelId: string; text: string }> = [];
    const attempt: ProviderChatAttempt = async (request) => {
      const text = request.messages.map((message) => message.content).join("\n");
      captured.push({ modelId: request.modelId, text });
      let content = "reflection";
      if (text.includes("please prepare one specific target")) content = `TARGET-${request.modelId}`;
      else if (text.includes("confirm the transmission")) content = "READY";
      else if (text.includes("Please give your first description")) content = "first impression";
      else if (text.includes("After this step we will close your description")) content = "second impression";
      else if (text.includes("Reply YES or NO")) content = "NO";
      else if (text.includes("All rounds in this series are complete")) content = "final reflection";
      return { content, usage: {}, providerRequestId: `req-${captured.length}` };
    };
    const deps = {
      store,
      providerAttempt: attempt,
      createId: (prefix: string) => `${prefix}-${++idCounter}`,
      resolveRoute: async (item: TelepathicParticipant): Promise<ResolvedTelepathicAiRoute> => ({
        snapshot: structuredClone(item.ai!),
        providerConfig: provider(item.id),
        model: model(item.id),
        requestedSettings: { temperature: 0.9 },
        validatedIdentity: { profileId: item.ai!.profileId, workspaceId: item.ai!.workspaceId, aiIdentityId: item.ai!.aiIdentityId, credentialFingerprint: item.ai!.credentialFingerprint },
      }),
    };

    for (let round = 0; round < 3; round += 1) await runNextTelepathicAiRound(deps, config.seriesId);
    const completed = await store.getTelepathicSeries(config.seriesId);
    expect(completed?.status).toBe("completed");
    expect(completed?.rounds.map((round) => round.assignment.senderParticipantId)).toEqual(["leo", "nemo", "aura"]);

    for (const id of ["leo", "nemo", "aura"]) {
      const ownCalls = captured.filter((call) => call.modelId === `model-${id}`);
      expect(ownCalls.length).toBeGreaterThan(0);
      for (const call of ownCalls) {
        expect(call.text).toContain(`${id.toUpperCase()} FROZEN FIELD GUIDE`);
        expect(call.text).toContain(`${id.toUpperCase()} FROZEN VIEWER NOTES`);
        for (const other of ["leo", "nemo", "aura"].filter((candidate) => candidate !== id)) {
          expect(call.text).not.toContain(`${other.toUpperCase()} FROZEN FIELD GUIDE`);
          expect(call.text).not.toContain(`${other.toUpperCase()} FROZEN VIEWER NOTES`);
        }
      }
    }

    const roundTwoReceiverCall = captured.find((call) => call.text.includes("Please give your first description") && call.text.includes("round 2"));
    expect(roundTwoReceiverCall?.text).not.toContain("TARGET-model-leo");
    expect(roundTwoReceiverCall?.text).not.toContain("structure or object");

    const withFinal = await runTelepathicFinalReflections(deps, config.seriesId);
    expect(Object.keys(withFinal.finalReflections).sort()).toEqual(["aura", "leo", "nemo"]);
    const finalLeo = captured.findLast((call) => call.modelId === "model-leo" && call.text.includes("All rounds in this series are complete"));
    expect(finalLeo?.text).toContain("LEO FROZEN FIELD GUIDE");
  });
});
