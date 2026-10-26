import { describe, expect, it } from "vitest";
import { sha256Text } from "../application/sha256";
import type { ProviderChatAttempt } from "../providers/requestExecutor";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import { createTelepathicSeriesState, runNextTelepathicAiRound, runTelepathicFinalReflections } from "./engine";
import { createTelepathicAiTrainingSeries } from "./training";
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
    fieldGuide: { id: `fg-${id}`, version: "1", versionNumber: 1, content: fg, contentSha256: await sha256Text(fg), capturedAt: "2026-10-07T12:00:00.000Z", profileId: `profile-${id}`, aiIdentityId: `identity-${id}`, modelRoute: `custom_openai:model-${id}`, language: "en" },
    viewerNotes: { id: `vn-${id}`, version: "1", versionNumber: 1, content: vn, contentSha256: await sha256Text(vn), capturedAt: "2026-10-07T12:00:00.000Z", profileId: `profile-${id}`, aiIdentityId: `identity-${id}`, modelRoute: `custom_openai:model-${id}` },
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
    const finalLeo = [...captured].reverse().find((call) => call.modelId === "model-leo" && call.text.includes("All rounds in this series are complete"));
    expect(finalLeo?.text).toContain("LEO FROZEN FIELD GUIDE");
  });

  it("freezes learning through create -> save -> get and Resume keeps the frozen content after active learning changes", async () => {
    const participants = [await ai("leo"), await ai("nemo")].map((item) => ({ ...item, fieldGuide: undefined, viewerNotes: undefined }));
    const config: TelepathicSeriesConfig = {
      schemaVersion: 1,
      seriesId: "training-4a-freeze-resume",
      seriesWorkspaceId: "workspace-leo",
      mode: "ai_ai_training",
      language: "en",
      participants,
      roundCount: 1,
      topic: "any",
      discloseTopicToReceivers: false,
      senderPolicy: { kind: "rotate" },
    };
    const store = new InMemoryTelepathicExchangeStore();
    const activeLearning: Record<string, { fg: string; vn: string }> = {
      leo: { fg: "LEO ORIGINAL FIELD GUIDE", vn: "LEO ORIGINAL VIEWER NOTES" },
      nemo: { fg: "NEMO ORIGINAL FIELD GUIDE", vn: "NEMO ORIGINAL VIEWER NOTES" },
    };
    const repository = {
      getExistingFieldGuideBundle: async (identityId: string, language: "pl" | "en") => {
        const id = identityId.replace("identity-", "");
        const content = activeLearning[id].fg;
        return {
          identityId,
          language,
          activeVersion: {
            id: `fg-${id}-active`, aiIdentityId: identityId, language, versionNumber: 1, content,
            contentSha256: await sha256Text(content), estimatedTokens: 10,
          },
        };
      },
      getExistingViewerNoteBundle: async (identityId: string) => {
        const id = identityId.replace("identity-", "");
        const content = activeLearning[id].vn;
        return {
          activeVersion: {
            id: `vn-${id}-active`, aiIdentityId: identityId, versionNumber: 1, content,
            contentSha256: await sha256Text(content), estimatedTokens: 10,
          },
        };
      },
      getTelepathicSeries: (seriesId: string) => store.getTelepathicSeries(seriesId),
      saveTelepathicSeries: (state: any) => store.saveTelepathicSeries(state),
      withTelepathicSeriesLease: <T>(seriesId: string, task: () => Promise<T>) => store.withTelepathicSeriesLease(seriesId, task),
      assertTelepathicSeriesLease: (seriesId: string) => store.assertTelepathicSeriesLease(seriesId),
      telepathicSeriesLeaseSignal: (seriesId: string) => store.telepathicSeriesLeaseSignal(seriesId),
    } as unknown as import("../storage/repository").AppRepository;

    await createTelepathicAiTrainingSeries({ repository, config, now: () => "2026-10-07T12:00:00.000Z" });
    const persisted = await repository.getTelepathicSeries(config.seriesId);
    expect(persisted?.config.participants.find((item) => item.id === "leo")?.fieldGuide?.content).toBe("LEO ORIGINAL FIELD GUIDE");

    activeLearning.leo = { fg: "LEO NEW ACTIVE FIELD GUIDE", vn: "LEO NEW ACTIVE VIEWER NOTES" };
    activeLearning.nemo = { fg: "NEMO NEW ACTIVE FIELD GUIDE", vn: "NEMO NEW ACTIVE VIEWER NOTES" };

    const captured: string[] = [];
    let idCounter = 0;
    const attempt: ProviderChatAttempt = async (request) => {
      const body = request.messages.map((message) => message.content).join("\n");
      captured.push(body);
      let content = "reflection";
      if (body.includes("please prepare one specific target")) content = "TARGET-FROZEN-LEARNING";
      else if (body.includes("confirm the transmission")) content = "READY";
      else if (body.includes("Please give your first description")) content = "first impression";
      else if (body.includes("After this step we will close your description")) content = "second impression";
      else if (body.includes("Reply YES or NO")) content = "NO";
      return { content, usage: {}, providerRequestId: `resume-${captured.length}` };
    };
    const deps = {
      store: repository,
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

    await runNextTelepathicAiRound(deps, config.seriesId);
    const all = captured.join("\n");
    expect(all).toContain("LEO ORIGINAL FIELD GUIDE");
    expect(all).toContain("NEMO ORIGINAL FIELD GUIDE");
    expect(all).not.toContain("LEO NEW ACTIVE FIELD GUIDE");
    expect(all).not.toContain("NEMO NEW ACTIVE FIELD GUIDE");
  });

});
