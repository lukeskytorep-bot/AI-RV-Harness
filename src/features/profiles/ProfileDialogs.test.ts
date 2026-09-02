import { describe, expect, it } from "vitest";

import { getCopy } from "../../i18n";
import type { ProviderConfig, ProviderModel } from "../../providers/types";
import { buildProfileAiConfiguration } from "./ProfileDialogs";

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
});
