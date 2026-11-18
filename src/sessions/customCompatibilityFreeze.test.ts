import { expect, it } from "vitest";
import { newRunGenerationSettings } from "../providers/customCompatibility";
import { runAutomaticRvLiteSession } from "./rvLiteController";
import { getRvLite } from "../resources/protocolRegistry";
import { evaluateMonitor } from "../monitor/engine";
import { workflowTestRepository } from "../testing/workflowRepository";
import type { AppRepository } from "../storage/repository";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import type { SessionSnapshot } from "./types";

const config: ProviderConfig = { id: "p", provider: "custom_openai", credentialId: "k", baseUrl: "https://example.test/v1", customCompatibilityProfile: "llama_cpp", enabled: true, label: "Pod", createdAt: "t", updatedAt: "t" };
const model: ProviderModel = { providerConfigId: "p", provider: "custom_openai", modelId: "m", displayName: "Model", route: "custom_openai:m", pricing: {}, recommended: false, rawMetadata: {}, refreshedAt: "t", capabilities: { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, contextTokens: 131072, maxOutputTokens: 65536, reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: false, confidence: "unknown" }, supportedParameters: [], source: "provider", capturedAt: "t" } };

it.each([undefined, "generic", "llama_cpp"] as const)("real RV Lite controller retains frozen %s after a connection change and preserves all four blind steps", async profile => {
  const requested = profile ? newRunGenerationSettings({ ...config, customCompatibilityProfile: profile }, { maxOutputTokens: 32768 }) : { maxOutputTokens: 32768 };
  let snapshot: SessionSnapshot | undefined;
  let calls = 0;
  const repository = workflowTestRepository({
    createRvSession: async () => ({}), updateRvSessionState: async () => undefined, updatePreRevealTranscript: async () => undefined,
    saveSessionSnapshot: async (_id: string, saved: SessionSnapshot) => { snapshot = structuredClone(saved); }, sealPreReveal: async () => undefined,
    acceptReveal: async () => undefined, recordTargetUsage: async () => undefined,
  }) as unknown as AppRepository;
  const result = await runAutomaticRvLiteSession({ repository, workspaceId: "w", profileId: "person", providerConfig: { ...config, customCompatibilityProfile: profile === "llama_cpp" ? "generic" : "llama_cpp" }, model, protocol: getRvLite("en"), sessionLanguage: "en", requestedSettings: JSON.parse(JSON.stringify(requested)),
    chat: async request => {
      calls++;
      expect(request.settings.requested.customCompatibilityProfile).toBe(profile);
      expect(request.settings.effective.customCompatibilityProfile).toBe(profile);
      return { content: `Blind sensory observations ${calls}`, finishReason: "stop", usage: {} };
    },
  });
  expect(calls).toBe(4);
  expect(result.state).toBe("AwaitingReveal");
  expect(snapshot?.generationSettings.requested.customCompatibilityProfile).toBe(profile);
  expect(snapshot?.generationSettings.effective.maxOutputTokens).toBe(32768);
});

it("Monitor captures a new dialect once and retains it across output recovery, while explicit legacy settings stay generic", async () => {
  let calls = 0;
  const live = { ...config };
  await evaluateMonitor({ providerConfig: live, model, language: "en", phase: 1, blindTranscript: "sensory evidence", exchangeNumber: 1,
    chat: async request => {
      expect(request.settings.effective.customCompatibilityProfile).toBe("llama_cpp");
      live.customCompatibilityProfile = "generic";
      return ++calls === 1 ? { content: "Partial", finishReason: "length", usage: {} } : { content: "CONTINUE_PROTOCOL", finishReason: "stop", usage: {} };
    },
  });
  expect(calls).toBe(2);
  await evaluateMonitor({ providerConfig: config, model, requestedSettings: {}, language: "en", phase: 1, blindTranscript: "evidence", exchangeNumber: 1,
    chat: async request => { expect(request.settings.effective.customCompatibilityProfile).toBeUndefined(); return { content: "CONTINUE_PROTOCOL", finishReason: "stop", usage: {} }; },
  });
});
