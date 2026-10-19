import { beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke, Channel: class { onmessage?: unknown; } }));
vi.mock("../storage", () => ({ isTauriRuntime: () => true }));
vi.mock("./debug", () => ({ recordProviderDebug: vi.fn(), detailedProviderDiagnosticsEnabled: () => false }));

import { resolveGenerationSettings } from "./capabilities";
import { executeProviderChat } from "./requestExecutor";
import type { ModelCapabilities, ProviderConfig } from "./types";

const config = (streaming: boolean): ProviderConfig => ({
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

const capabilities: ModelCapabilities = {
  inputModalities: ["text"],
  outputModalities: ["text"],
  supportsVision: false,
  supportsStreaming: true,
  contextTokens: 131072,
  maxOutputTokens: 65536,
  reasoning: { supported: true, efforts: ["high"], confidence: "provider_metadata" },
  temperature: { supported: false, confidence: "unknown" },
  supportedParameters: [],
  source: "provider",
  capturedAt: "now",
};

beforeEach(() => {
  bridge.invoke.mockReset();
  bridge.invoke.mockResolvedValue({ content: "ok", finish_reason: "stop", usage: {} });
});

describe("CUSTOM-CTRL-3 final Custom OpenAI-compatible regression", () => {
  it.each([false, true])("keeps manual temperature, sampling and reasoning Off identical with SSE=%s", async (streaming) => {
    const settings = resolveGenerationSettings(capabilities, {
      customTemperatureMode: "manual",
      temperature: 0.7,
      topP: 0.9,
      topK: 40,
      seed: 42,
      customReasoningMode: "off",
      reasoningEffort: "high",
      maxOutputTokens: 32768,
    }, { provider: "custom_openai" });

    expect(settings.omitted).toEqual([]);
    expect(settings.requested.customTemperatureMode).toBe("manual");
    expect(settings.effective).toMatchObject({
      temperature: 0.7,
      topP: 0.9,
      topK: 40,
      seed: 42,
      customReasoningMode: "off",
      maxOutputTokens: 32768,
    });
    expect(settings.effective.reasoningEffort).toBeUndefined();

    await executeProviderChat({
      config: config(streaming),
      modelId: "custom-model",
      messages: [{ role: "user", content: "test" }],
      settings,
      configuredRetries: 0,
    });

    const request = bridge.invoke.mock.calls.find(([command]) => command === "provider_chat")?.[1]?.request;
    expect(request).toMatchObject({
      provider: "custom_openai",
      temperature: 0.7,
      topP: 0.9,
      topK: 40,
      seed: 42,
      reasoningTransportKind: "enabled_boolean",
      reasoningTransportValue: "false",
      customStreamingEnabled: streaming,
      maxOutputTokens: 32768,
    });
    expect(request.reasoningEffort).toBeUndefined();
    expect(request.reasoningMaxTokens).toBeUndefined();
  });

  it("omits explicit provider-default temperature while preserving the existing effort path", async () => {
    const settings = resolveGenerationSettings(capabilities, {
      customTemperatureMode: "provider_default",
      temperature: 0.2,
      customReasoningMode: "default",
      reasoningEffort: "high",
    }, { provider: "custom_openai" });

    expect(settings.omitted).toEqual([]);
    expect(settings.effective.temperature).toBeUndefined();
    expect(settings.effective.reasoningEffort).toBe("high");

    await executeProviderChat({
      config: config(false),
      modelId: "custom-model",
      messages: [{ role: "user", content: "test" }],
      settings,
      configuredRetries: 0,
    });

    const request = bridge.invoke.mock.calls.find(([command]) => command === "provider_chat")?.[1]?.request;
    expect(request.temperature).toBeUndefined();
    expect(request.reasoningEffort).toBe("high");
    expect(request.reasoningTransportKind).toBe("effort");
    expect(request.reasoningTransportValue).toBe("high");
  });

  it("keeps Custom override intents isolated from non-Custom providers", () => {
    expect(() => resolveGenerationSettings(capabilities, { customTemperatureMode: "manual", temperature: 0.7 }, { provider: "openrouter" })).toThrow(/Custom temperature override/);
    expect(() => resolveGenerationSettings(capabilities, { customReasoningMode: "off" }, { provider: "openrouter" })).toThrow(/Custom reasoning override/);
  });
});
