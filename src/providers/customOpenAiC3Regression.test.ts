import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { profileGenerationDefaults } from "../profileViewerDefaults";
import { buildRvSessionRequestedSettings } from "../features/rvSessions/RvSessionPanel";
import type { Profile } from "../types";
import type { ProviderConfig, ProviderModel } from "./types";
import { executeProviderChat } from "./requestExecutor";
import { resolveEffectiveRequestEnvelope } from "./effectiveRequestEnvelope";

const customConfig = (streaming: boolean): ProviderConfig => ({
  id: "pc-custom",
  provider: "custom_openai",
  label: "Custom",
  credentialId: "cred-custom",
  baseUrl: "https://example.test/v1",
  customStreamingEnabled: streaming,
  enabled: true,
  createdAt: "now",
  updatedAt: "now",
});

const customModel: ProviderModel = {
  providerConfigId: "pc-custom",
  provider: "custom_openai",
  modelId: "custom-model",
  displayName: "Custom model",
  route: "custom_openai:custom-model",
  capabilities: {
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportsVision: false,
    supportsStreaming: true,
    contextTokens: 131072,
    maxOutputTokens: 65536,
    reasoning: { supported: true, efforts: ["low", "medium", "high"], confidence: "provider_metadata" },
    temperature: { supported: true, min: 0, max: 2, confidence: "provider_metadata" },
    supportedParameters: ["reasoning", "temperature", "top_p", "top_k", "seed", "max_tokens"],
    source: "provider",
    capturedAt: "now",
  },
  pricing: {},
  recommended: true,
  rawMetadata: {},
  refreshedAt: "now",
};

const profile: Profile = {
  id: "profile-custom",
  name: "Custom Viewer",
  defaultViewerModelId: "custom-model",
  defaultViewerReasoningEffort: "high",
  defaultViewerTemperature: 0.9,
  defaultViewerOpenRouterSampling: { enabled: true, topP: 0.04, topK: 0, seed: 42 },
  createdAt: "before",
  updatedAt: "now",
};

const frozen = {
  requested: { reasoningEffort: "high" as const, temperature: 0.9, topP: 0.04, topK: 0, seed: 42, maxOutputTokens: 49152 },
  effective: { reasoningEffort: "high" as const, temperature: 0.9, topP: 0.04, topK: 0, seed: 42, maxOutputTokens: 49152 },
  omitted: [] as [],
};

describe("C3 Custom OpenAI-compatible regression", () => {
  it("keeps the same three manual samplers in shared Profile defaults and automatic RV snapshot construction", () => {
    expect(profileGenerationDefaults(profile, customModel)).toEqual({
      reasoningEffort: "high",
      temperature: 0.9,
      topP: 0.04,
      topK: 0,
      seed: 42,
    });
    expect(buildRvSessionRequestedSettings({
      profile,
      model: customModel,
      reasoning: "high",
      temperature: "0.9",
      rvSessionMaxOutputTokens: 49152,
    })).toEqual({
      reasoningEffort: "high",
      temperature: 0.9,
      topP: 0.04,
      topK: 0,
      seed: 42,
      maxOutputTokens: 49152,
    });
  });

  it("changes only the Custom transport mode when SSE is toggled and leaves sampler settings untouched", async () => {
    for (const [enabled, expected] of [[false, "non_streaming"], [true, "streaming"]] as const) {
      const result = await resolveEffectiveRequestEnvelope({
        config: customConfig(enabled),
        modelId: "custom-model",
        messages: [{ role: "user", content: "test" }],
        settings: frozen,
        operationKind: "conversation",
        streamWorkflowContext: "conversation",
      });
      expect(result.envelope.streamingMode).toBe(expected);
      expect(result.providerRouting).toBeUndefined();
    }
  });

  it("dispatches Custom sampling unchanged with SSE on and off, without OpenRouter routing metadata", async () => {
    for (const enabled of [false, true]) {
      const attempt = vi.fn(async (request) => {
        expect(request.transportEnvelope?.streamingMode).toBe(enabled ? "streaming" : "non_streaming");
        expect(request.providerRouting).toBeUndefined();
        expect(request.settings.requested).toMatchObject({ topP: 0.04, topK: 0, seed: 42, maxOutputTokens: 49152 });
        expect(request.settings.effective).toMatchObject({ topP: 0.04, topK: 0, seed: 42, maxOutputTokens: 49152 });
        return { content: "ok", finishReason: "stop", usage: {} };
      });
      await executeProviderChat({
        config: customConfig(enabled),
        modelId: "custom-model",
        messages: [{ role: "user", content: "test" }],
        settings: frozen,
        operationKind: "conversation",
        streamWorkflowContext: "conversation",
        configuredRetries: 0,
        attempt,
      });
      expect(attempt).toHaveBeenCalledTimes(1);
    }
  });

  it("keeps all Viewer workflow entry points on the shared Profile-defaults path", () => {
    const files = [
      "src/features/conversations/ChatPanel.tsx",
      "src/features/rvSessions/RvSessionPanel.tsx",
      "src/features/training/TrainingScreen.tsx",
      "src/features/training/trainingExecution.ts",
      "src/features/conversations/TelepathicExchangePanel.tsx",
      "src/features/training/TelepathicTrainingPanel.tsx",
      "src/features/research/ResearchBuilder.tsx",
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toContain("profileGenerationDefaults");
    }
  });
});
