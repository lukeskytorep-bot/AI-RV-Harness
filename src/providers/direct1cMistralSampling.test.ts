import { beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke, Channel: class { onmessage?: unknown; } }));
vi.mock("../storage", () => ({ isTauriRuntime: () => true }));
vi.mock("./debug", () => ({ recordProviderDebug: vi.fn(), detailedProviderDiagnosticsEnabled: () => false }));

import { resolveGenerationSettings } from "./capabilities";
import { executeProviderChat } from "./requestExecutor";
import type { ModelCapabilities, ProviderConfig } from "./types";

const config: ProviderConfig = {
  id: "pc-mistral",
  provider: "mistral",
  label: "Mistral",
  credentialId: "cred-mistral",
  enabled: true,
  createdAt: "now",
  updatedAt: "now",
};

const capabilities: ModelCapabilities = {
  inputModalities: ["text"],
  outputModalities: ["text"],
  supportsVision: false,
  supportsStreaming: true,
  contextTokens: 131072,
  maxOutputTokens: 32768,
  reasoning: { supported: true, efforts: ["high"], confidence: "provider_metadata" },
  temperature: { supported: true, confidence: "provider_metadata" },
  supportedParameters: [],
  source: "compatibility",
  capturedAt: "now",
};

beforeEach(() => {
  bridge.invoke.mockReset();
  bridge.invoke.mockResolvedValue({ content: "ok", finish_reason: "stop", usage: {} });
});

describe("DIRECT-1C Mistral sampling transport", () => {
  it("carries Harness topP/topK/seed through IPC for Rust provider-specific wire translation", async () => {
    const settings = resolveGenerationSettings(capabilities, {
      topP: 0.7,
      topK: 100,
      seed: 42,
      maxOutputTokens: 16384,
    }, { provider: "mistral" });

    expect(settings.effective).toMatchObject({ topP: 0.7, topK: 100, seed: 42, maxOutputTokens: 16384 });

    await executeProviderChat({
      config,
      modelId: "mistral-medium-3-5",
      messages: [{ role: "user", content: "test" }],
      settings,
      configuredRetries: 0,
    });

    const request = bridge.invoke.mock.calls.find(([command]) => command === "provider_chat")?.[1]?.request;
    expect(request).toMatchObject({
      provider: "mistral",
      topP: 0.7,
      topK: 100,
      seed: 42,
      maxOutputTokens: 16384,
    });
    expect(request.providerRouting).toBeUndefined();
    expect(request.customStreamingEnabled).toBeUndefined();
  });

  it("keeps Auto omitted instead of inventing sampler defaults", async () => {
    const settings = resolveGenerationSettings(capabilities, { maxOutputTokens: 16384 }, { provider: "mistral" });
    await executeProviderChat({
      config,
      modelId: "mistral-medium-3-5",
      messages: [{ role: "user", content: "test" }],
      settings,
      configuredRetries: 0,
    });
    const request = bridge.invoke.mock.calls.find(([command]) => command === "provider_chat")?.[1]?.request;
    expect(request.topP).toBeUndefined();
    expect(request.topK).toBeUndefined();
    expect(request.seed).toBeUndefined();
  });
});
