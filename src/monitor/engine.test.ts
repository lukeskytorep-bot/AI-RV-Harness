import { describe, expect, it } from "vitest";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import { evaluateMonitor, monitorOutputTokenBudget, parseMonitorDecision } from "./engine";

const config: ProviderConfig = {
  id: "provider", provider: "openrouter", label: "Provider", credentialId: "credential", enabled: true,
  createdAt: "now", updatedAt: "now",
};

const model: ProviderModel = {
  providerConfigId: config.id, provider: config.provider, modelId: "reasoning-model", displayName: "Reasoning model",
  route: "openrouter:reasoning-model", recommended: false, rawMetadata: {}, refreshedAt: "now", pricing: {},
  capabilities: {
    inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true,
    reasoning: { supported: true, efforts: ["high"], confidence: "provider_metadata" },
    temperature: { supported: false, confidence: "unknown" }, supportedParameters: ["max_tokens"],
    maxOutputTokens: 16_384, source: "provider", capturedAt: "now",
  },
};

describe("autonomous AI Monitor decisions", () => {
  it("accepts a natural-language instruction without a command library or evidence gate", () => {
    expect(parseMonitorDecision("Move 200 meters above the target and describe the spatial arrangement.")).toEqual({
      decision: "INTERVENE",
      commandText: "Move 200 meters above the target and describe the spatial arrangement.",
      rawResponse: "Move 200 meters above the target and describe the spatial arrangement.",
    });
  });

  it("recognizes the only controller sentinel", () => {
    expect(parseMonitorDecision("CONTINUE_PROTOCOL")).toEqual({ decision: "CONTINUE_PROTOCOL" });
    expect(parseMonitorDecision("Continue.")).toEqual({ decision: "INTERVENE", commandText: "Continue.", rawResponse: "Continue." });
  });

  it("does not treat JSON as a privileged command format", () => {
    expect(parseMonitorDecision('{"decision":"INTERVENE","command_id":"CENTER"}').decision).toBe("INTERVENE");
  });

  it("uses only final content and preserves a multi-sentence Monitor instruction verbatim", async () => {
    const finalContent = "Move above the perceived structure. Describe its northern edge. Then compare both sides without naming a target.";
    const decision = await evaluateMonitor({
      providerConfig: config, model, language: "en", phase: 7, blindTranscript: "Blind Viewer transcript.",
      chat: async ({ settings }) => {
        expect(settings.effective.maxOutputTokens).toBe(4096);
        return {
          content: finalContent,
          reasoningContent: "A very long internal analysis that is deliberately separate from final content.".repeat(200),
          reasoningSource: "openai_reasoning_content",
          usage: {},
        };
      },
    });
    expect(decision).toEqual({ decision: "INTERVENE", commandText: finalContent, rawResponse: finalContent });
  });

  it("increases the combined output budget on a retry while respecting the model route limit", () => {
    expect(monitorOutputTokenBudget(model, 0)).toBe(4096);
    expect(monitorOutputTokenBudget(model, 1)).toBe(8192);
    expect(monitorOutputTokenBudget({ ...model, capabilities: { ...model.capabilities, maxOutputTokens: 6000 } }, 1)).toBe(6000);
  });

  it("rejects a technically truncated Monitor completion before it can command the Viewer", async () => {
    await expect(evaluateMonitor({
      providerConfig: config, model, language: "en", phase: 7, blindTranscript: "Blind Viewer transcript.",
      chat: async () => ({ content: "Partial instruction", finishReason: "length", usage: {} }),
    })).rejects.toThrow("incomplete assistant response");
  });
});
