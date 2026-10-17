import { describe, expect, it } from "vitest";

import { getCopy } from "../../i18n";
import type { ProviderConfig, ProviderModel } from "../../providers/types";
import { buildProfileAiConfiguration } from "./ProfileDialogs";
import { parseOpenRouterAdditionalSamplingInputs } from "./profileAiConfiguration";

const now = "2026-09-02T10:00:00.000Z";
const provider: ProviderConfig = {
  id: "provider-1",
  provider: "openrouter",
  label: "OpenRouter",
  credentialId: "credential-1",
  enabled: true,
  createdAt: now,
  updatedAt: now,
};
const model: ProviderModel = {
  providerConfigId: provider.id,
  provider: provider.provider,
  modelId: "model-1",
  displayName: "Model 1",
  route: "model-1",
  capabilities: {
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportsVision: false,
    supportsStreaming: false,
    reasoning: { supported: true, efforts: ["low", "high"], confidence: "provider_metadata", registryStatus: "unknown" },
    temperature: { supported: true, min: 0, max: 2, default: 0.7, confidence: "provider_metadata" },
    supportedParameters: ["temperature"],
    source: "provider",
    capturedAt: now,
  },
  pricing: {},
  recommended: false,
  rawMetadata: {},
  refreshedAt: now,
};

describe("profile AI configuration", () => {
  it("normalizes the selected Viewer defaults", () => {
    const result = buildProfileAiConfiguration(getCopy("en"), provider, model, "low", "0.8", "  prompt  ", "", "");

    expect(result).toMatchObject({
      credentialId: "credential-1",
      credentialProvider: "openrouter",
      defaultViewerModelId: "model-1",
      defaultViewerReasoningEffort: "low",
      defaultViewerTemperature: 0.8,
      defaultViewerSystemPrompt: "prompt",
    });
  });

  it("rejects a Viewer temperature outside provider capabilities", () => {
    expect(() => buildProfileAiConfiguration(getCopy("en"), provider, model, "", "3", "", "", ""))
      .toThrow(getCopy("en").temperatureOutOfRange);
  });
  it("rejects Monitor/Judge routes that belong to another credential", () => {
    const foreignProvider: ProviderConfig = { ...provider, id: "provider-2", credentialId: "credential-2", label: "Foreign" };
    const foreignModel: ProviderModel = { ...model, providerConfigId: foreignProvider.id, modelId: "foreign-model", displayName: "Foreign model" };
    expect(() => buildProfileAiConfiguration(
      getCopy("en"), provider, model, "", "", "", "provider-2::foreign-model", "", [provider, foreignProvider], [model, foreignModel],
    )).toThrow(getCopy("en").selectModel);
  });


  it("keeps temperature independent while accepting OpenRouter sampling as a separate contract", () => {
    const result = buildProfileAiConfiguration(
      getCopy("en"), provider, model, "low", "0.8", "", "", "", [provider], [model],
      { enabled: false, topP: 0.4, topK: 0, seed: 42 },
    );
    expect(result.defaultViewerTemperature).toBe(0.8);
    expect(result.defaultViewerOpenRouterSampling).toEqual({ enabled: false, topP: 0.4, topK: 0, seed: 42 });
  });

  it("does not attach OpenRouter sampling to a non-OpenRouter profile", () => {
    const mistralProvider: ProviderConfig = { ...provider, id: "provider-m", provider: "mistral", label: "Mistral" };
    const mistralModel: ProviderModel = { ...model, providerConfigId: mistralProvider.id, provider: "mistral" };
    const result = buildProfileAiConfiguration(
      getCopy("en"), mistralProvider, mistralModel, "low", "0.8", "", "", "", [mistralProvider], [mistralModel],
      { enabled: true, topP: 0.4, seed: 42 },
    );
    expect(result.defaultViewerTemperature).toBe(0.8);
    expect(result.defaultViewerOpenRouterSampling).toBeUndefined();
  });

  it("does not persist the legacy Viewer System Prompt when the shared setup passes an empty prompt", () => {
    const result = buildProfileAiConfiguration(getCopy("en"), provider, model, "", "", "", "", "");
    expect(result.defaultViewerSystemPrompt).toBeUndefined();
    expect(result.defaultViewerModelId).toBe("model-1");
  });

  it("parses Auto independently from manual zero values", () => {
    expect(parseOpenRouterAdditionalSamplingInputs(getCopy("en"), true, "", "0", "42")).toEqual({ enabled: true, topK: 0, seed: 42 });
    expect(parseOpenRouterAdditionalSamplingInputs(getCopy("en"), true, "0.04", "", "")).toEqual({ enabled: true, topP: 0.04 });
  });

  it("rejects invalid sampling text before profile persistence", () => {
    expect(() => parseOpenRouterAdditionalSamplingInputs(getCopy("en"), true, "20", "", "")).toThrow(getCopy("en").topPOutOfRange);
    expect(() => parseOpenRouterAdditionalSamplingInputs(getCopy("en"), true, "", "1.5", "")).toThrow(getCopy("en").topKOutOfRange);
    expect(() => parseOpenRouterAdditionalSamplingInputs(getCopy("en"), true, "", "", String(Number.MAX_SAFE_INTEGER + 1))).toThrow(getCopy("en").seedOutOfRange);
  });

});
