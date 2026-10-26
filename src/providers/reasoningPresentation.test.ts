import { describe, expect, it } from "vitest";
import { getCopy } from "../i18n";
import type { ProviderModel } from "./types";
import { reasoningSelectionLead } from "./reasoningPresentation";

const model: ProviderModel = {
  providerConfigId: "pc",
  provider: "custom_openai",
  modelId: "m",
  displayName: "M",
  route: "custom_openai:m",
  capabilities: {
    inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true,
    reasoning: { supported: true, efforts: ["low", "high"], confidence: "provider_metadata" },
    temperature: { supported: false, confidence: "unknown" }, supportedParameters: [], source: "compatibility", capturedAt: "now",
  },
  pricing: {}, recommended: false, rawMetadata: {}, refreshedAt: "now",
};

describe("reasoning selection presentation", () => {
  it("separates the current selection from capability metadata and preserves its real source", () => {
    const en = getCopy("en");
    expect(reasoningSelectionLead(en, model, { customReasoningMode: "off", source: "profile" })).toBe("Reasoning: Off · from profile");
    expect(reasoningSelectionLead(en, model, { customReasoningMode: "off", source: "session" })).toBe("Reasoning: Off · set manually for this session");
    expect(reasoningSelectionLead(en, model, { customReasoningMode: "default", source: "provider" })).toBe("Reasoning: Provider default");
    expect(reasoningSelectionLead(en, model, { customReasoningMode: "default", reasoningEffort: "high", source: "session" })).toBe("Reasoning: HIGH · set manually for this session");
  });

  it("uses Polish source labels without claiming the server applied the parameter", () => {
    const pl = getCopy("pl");
    expect(reasoningSelectionLead(pl, model, { customReasoningMode: "on", source: "profile" })).toBe("Reasoning: Włączone · z profilu");
    expect(pl.reasoningSentLead).toContain("zostanie wysłane do API");
  });
});
