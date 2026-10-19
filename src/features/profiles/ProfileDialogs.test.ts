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

  it("accepts manual sampling for Custom OpenAI-compatible without requiring OpenRouter capability metadata", () => {
    const customProvider: ProviderConfig = { ...provider, id: "provider-custom", provider: "custom_openai", label: "Custom", baseUrl: "https://example.test/v1" };
    const customModel: ProviderModel = {
      ...model,
      providerConfigId: customProvider.id,
      provider: "custom_openai",
      route: "custom_openai:model-1",
      capabilities: { ...model.capabilities, supportedParameters: ["temperature"] },
      rawMetadata: {},
    };
    const result = buildProfileAiConfiguration(
      getCopy("en"), customProvider, customModel, "low", "0.8", "", "", "", [customProvider], [customModel],
      { enabled: true, topP: 0.04, topK: 0, seed: 42 },
    );
    expect(result.defaultViewerTemperature).toBe(0.8);
    expect(result.defaultViewerOpenRouterSampling).toEqual({ enabled: true, topP: 0.04, topK: 0, seed: 42 });
  });

  it("accepts documented Mistral direct sampling without claiming per-model live verification", () => {
    const mistralProvider: ProviderConfig = { ...provider, id: "provider-m", provider: "mistral", label: "Mistral" };
    const mistralModel: ProviderModel = { ...model, providerConfigId: mistralProvider.id, provider: "mistral", route: "mistral:model-1", rawMetadata: {} };
    const result = buildProfileAiConfiguration(
      getCopy("en"), mistralProvider, mistralModel, "low", "0.8", "", "", "", [mistralProvider], [mistralModel],
      { enabled: true, topP: 0.4, topK: 100, seed: 42 },
    );
    expect(result.defaultViewerTemperature).toBe(0.8);
    expect(result.defaultViewerOpenRouterSampling).toEqual({ enabled: true, topP: 0.4, topK: 100, seed: 42 });
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

  it("blocks enabled manual sampling when the selected model does not confirm that parameter", () => {
    const unsupported: ProviderModel = { ...model, rawMetadata: { supported_parameters: ["temperature"] } };
    const unknown: ProviderModel = { ...model, rawMetadata: {} };
    const supported: ProviderModel = {
      ...model,
      capabilities: { ...model.capabilities, supportedParameters: ["temperature", "top_p", "top_k", "seed"] },
      rawMetadata: { supported_parameters: ["temperature", "top_p", "top_k", "seed"] },
    };

    expect(() => buildProfileAiConfiguration(
      getCopy("en"), provider, unsupported, "", "0.8", "", "", "", [provider], [unsupported],
      { enabled: true, topK: 0 },
    )).toThrow(`Top K: ${getCopy("en").samplingUnsupported}`);
    expect(() => buildProfileAiConfiguration(
      getCopy("en"), provider, unknown, "", "0.8", "", "", "", [provider], [unknown],
      { enabled: true, seed: 42 },
    )).toThrow(`Seed: ${getCopy("en").samplingUnknown}`);
    expect(buildProfileAiConfiguration(
      getCopy("en"), provider, supported, "", "0.8", "", "", "", [provider], [supported],
      { enabled: true, topP: 0.04, topK: 0, seed: 42 },
    ).defaultViewerOpenRouterSampling).toEqual({ enabled: true, topP: 0.04, topK: 0, seed: 42 });
  });

  it("allows remembered incompatible values to remain stored when the sampling section is disabled", () => {
    const unsupported: ProviderModel = { ...model, rawMetadata: { supported_parameters: ["temperature"] } };
    const result = buildProfileAiConfiguration(
      getCopy("en"), provider, unsupported, "", "0.8", "", "", "", [provider], [unsupported],
      { enabled: false, topP: 0.04, topK: 0, seed: 42 },
    );
    expect(result.defaultViewerOpenRouterSampling).toEqual({ enabled: false, topP: 0.04, topK: 0, seed: 42 });
  });


  it("allows Custom manual temperature without advertised capability and distinguishes provider default", () => {
    const copy = getCopy("en");
    const customProvider = { ...provider, provider: "custom_openai" as const };
    const customModel = { ...model, provider: "custom_openai" as const, capabilities: { ...model.capabilities, temperature: { supported: false, confidence: "unknown" as const } } };
    const manual = buildProfileAiConfiguration(copy, customProvider, customModel, "", "0", "", "", "", [customProvider], [customModel], undefined, "manual");
    expect(manual.defaultViewerTemperature).toBe(0);
    expect(manual.defaultViewerCustomTemperatureMode).toBe("manual");
    const providerDefault = buildProfileAiConfiguration(copy, customProvider, customModel, "", "9", "", "", "", [customProvider], [customModel], undefined, "provider_default");
    expect(providerDefault.defaultViewerTemperature).toBeUndefined();
    expect(providerDefault.defaultViewerCustomTemperatureMode).toBe("provider_default");
  });

});
