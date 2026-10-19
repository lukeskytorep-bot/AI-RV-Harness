import { beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke, Channel: class { onmessage?: unknown; } }));
vi.mock("../storage", () => ({ isTauriRuntime: () => true }));
vi.mock("./debug", () => ({ recordProviderDebug: vi.fn(), detailedProviderDiagnosticsEnabled: () => false }));

import { resolveGenerationSettings } from "./capabilities";
import { executeProviderChat } from "./requestExecutor";
import type { ModelCapabilities, ProviderConfig } from "./types";

const config: ProviderConfig = {
  id: "pc-blackbox",
  provider: "blackbox",
  label: "Blackbox Enterprise",
  credentialId: "cred-blackbox",
  baseUrl: "https://enterprise.blackbox.ai",
  enabled: true,
  createdAt: "now",
  updatedAt: "now",
};

const capabilities: ModelCapabilities = {
  inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: false,
  contextTokens: 0, maxOutputTokens: 0,
  reasoning: { supported: false, efforts: [], confidence: "unknown" },
  temperature: { supported: false, confidence: "unknown" },
  supportedParameters: [], source: "compatibility", capturedAt: "now",
};

beforeEach(() => {
  bridge.invoke.mockReset();
  bridge.invoke.mockResolvedValue({ content: "ok", finish_reason: "stop", usage: {} });
});

describe("DIRECT-2D Blackbox sampling transport", () => {
  it("carries topP/topK/seed through IPC without inventing Blackbox routing metadata", async () => {
    const settings = resolveGenerationSettings(capabilities, { topP: 0.7, topK: 100, seed: 42 }, { provider: "blackbox" });
    expect(settings.effective).toMatchObject({ topP: 0.7, topK: 100, seed: 42 });
    await executeProviderChat({ config, modelId: "provider/model-a", messages: [{ role: "user", content: "test" }], settings, configuredRetries: 0 });
    const request = bridge.invoke.mock.calls.find(([command]) => command === "provider_chat")?.[1]?.request;
    expect(request).toMatchObject({ provider: "blackbox", topP: 0.7, topK: 100, seed: 42 });
    expect(request.providerRouting).toBeUndefined();
    expect(request.customStreamingEnabled).toBeUndefined();
  });

  it("keeps Auto omitted instead of inventing sampler defaults", async () => {
    const settings = resolveGenerationSettings(capabilities, {}, { provider: "blackbox" });
    await executeProviderChat({ config, modelId: "provider/model-a", messages: [{ role: "user", content: "test" }], settings, configuredRetries: 0 });
    const request = bridge.invoke.mock.calls.find(([command]) => command === "provider_chat")?.[1]?.request;
    expect(request.topP).toBeUndefined();
    expect(request.topK).toBeUndefined();
    expect(request.seed).toBeUndefined();
  });
});
