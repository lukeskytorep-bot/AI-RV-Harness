import { ProviderCallError } from "./providerError";
import { beforeEach, describe, expect, it, vi } from "vitest";
const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke, Channel: class { onmessage?: unknown; } }));
vi.mock("../storage", () => ({ isTauriRuntime: () => true }));
vi.mock("./debug", () => ({ recordProviderDebug: vi.fn(), detailedProviderDiagnosticsEnabled: () => false }));
import { customCompatibilityProfile, newRunGenerationSettings } from "./customCompatibility";
import { resolveGenerationSettings } from "./capabilities";
import { executeProviderChat } from "./requestExecutor";
import type { ModelCapabilities, ProviderConfig } from "./types";

const config: ProviderConfig = { id: "p", credentialId: "k", provider: "custom_openai", label: "Pod", baseUrl: "https://example.test/v1", enabled: true, createdAt: "t", updatedAt: "t", customCompatibilityProfile: "llama_cpp" };
const caps: ModelCapabilities = { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, contextTokens: 131072, maxOutputTokens: 65536, reasoning: { supported: true, efforts: ["high"], supportsMaxTokens: true, confidence: "provider_metadata" }, temperature: { supported: true, confidence: "provider_metadata" }, supportedParameters: ["top_p", "top_k", "seed"], source: "provider", capturedAt: "t" };
beforeEach(() => { bridge.invoke.mockReset(); bridge.invoke.mockResolvedValue({ content: "Accepted final", finish_reason: "stop", usage: {} }); });

describe("frozen Custom compatibility", () => {
  it("defaults old configs to generic and validates unknown discriminators", () => {
    expect(customCompatibilityProfile(undefined)).toBe("generic");
    expect(() => customCompatibilityProfile("guessed")).toThrow();
    expect(() => resolveGenerationSettings(caps, { customCompatibilityProfile: "bad" as never }, { provider: "custom_openai" })).toThrow();
    expect(() => resolveGenerationSettings(caps, { customCompatibilityProfile: "generic" }, { provider: "openrouter" })).toThrow();
  });
  it.each(["generic", "llama_cpp"] as const)("freezes %s while later connection edits leave requested and effective intact", profile => {
    const requested = newRunGenerationSettings({ ...config, customCompatibilityProfile: profile }, { maxOutputTokens: 32768 });
    const saved = JSON.parse(JSON.stringify(requested));
    const changed = { ...config, customCompatibilityProfile: profile === "generic" ? "llama_cpp" : "generic" };
    expect(changed.customCompatibilityProfile).not.toBe(profile);
    expect(resolveGenerationSettings(caps, saved, { provider: "custom_openai" }).effective.customCompatibilityProfile).toBe(profile);
    expect(newRunGenerationSettings({ ...config, customCompatibilityProfile: changed.customCompatibilityProfile as "generic" | "llama_cpp" }, saved).customCompatibilityProfile).toBe(changed.customCompatibilityProfile);
  });
  it.each([true, false])("sends only the frozen dialect through native with SSE=%s, keeping legacy generic", async streaming => {
    for (const frozen of [undefined, "generic", "llama_cpp"] as const) {
      const settings = resolveGenerationSettings(caps, { ...(frozen ? { customCompatibilityProfile: frozen } : {}), customReasoningMode: "off", maxOutputTokens: 32768, temperature: 0.7, topP: 0.9, topK: 20, seed: 1234 }, { provider: "custom_openai" });
      const response = await executeProviderChat({ config: { ...config, customStreamingEnabled: streaming }, settings, modelId: "model", messages: [{ role: "user", content: "test" }], operationId: "conversation" });
      expect(response.content).toBe("Accepted final");
      const call = bridge.invoke.mock.calls.filter(([name]) => name === "provider_chat").at(-1)!;
      expect(call[1].request).toMatchObject({ customCompatibilityProfile: frozen ?? "generic", customStreamingEnabled: streaming, reasoningTransportKind: "enabled_boolean", reasoningTransportValue: "false", maxOutputTokens: 32768, temperature: 0.7, topP: 0.9, topK: 20, seed: 1234 });
    }
  });
  it.each([{ reasoningEffort: "high" as const }, { reasoningMaxTokens: 1024 }])("rejects unsupported llama reasoning before any dispatch: %j", requested => {
    expect(() => resolveGenerationSettings(caps, { ...requested, customCompatibilityProfile: "llama_cpp" }, { provider: "custom_openai" })).toThrow("llama.cpp");
    expect(bridge.invoke).not.toHaveBeenCalled();
    expect(() => resolveGenerationSettings(caps, requested, { provider: "custom_openai" })).not.toThrow();
  });
});

it("physical transport retry keeps the frozen dialect after the live connection changes", async () => {
  const live = { ...config };
  const settings = resolveGenerationSettings(caps, newRunGenerationSettings(live, { maxOutputTokens: 32768 }), { provider: "custom_openai" });
  const seen: unknown[] = [];
  bridge.invoke.mockImplementation(async (command, args) => {
    if (command !== "provider_chat") return null;
    seen.push(args.request.customCompatibilityProfile);
    if (seen.length === 1) {
      live.customCompatibilityProfile = "generic";
      throw new ProviderCallError({ code: "http_status", message: "temporary service error", phase: "awaiting_headers", httpStatus: 503 });
    }
    return { content: "Recovered final", finish_reason: "stop", usage: {} };
  });
  const response = await executeProviderChat({ config: live, modelId: "model", settings, messages: [{ role: "user", content: "test" }], configuredRetries: 1, operationId: "conversation" });
  expect(response.content).toBe("Recovered final");
  expect(seen).toEqual(["llama_cpp", "llama_cpp"]);
});
