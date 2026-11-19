import { beforeEach, expect, it, vi } from "vitest";
const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke, Channel: class { onmessage?: unknown; } }));
vi.mock("../storage", () => ({ isTauriRuntime: () => true }));
import { normalizeModelDiscovery, resolveGenerationSettings } from "./capabilities";
import { executeProviderChat } from "./requestExecutor";
import type { OperationKind } from "./operationResourceProfiles";
import { supportsAdditionalSamplingProvider } from "./openRouterSamplingSettings";
const config = { id: "cloud", provider: "ollama_cloud" as const, credentialId: "opaque-bound-key", label: "Cloud", enabled: true, createdAt: "t", updatedAt: "t" };
const models = () => normalizeModelDiscovery(config, { models: [{ name: "qwen3:235b", digest: "sha256:fixture" }] }, "t");
beforeEach(() => bridge.invoke.mockReset());
it("uses exact Cloud names and exposes no invented context, vision, streaming or effort control", () => {
  const model = models()[0];
  expect(model.modelId).toBe("qwen3:235b");
  expect(model.capabilities).toMatchObject({ supportsVision: false, supportsStreaming: false, reasoning: { supported: false, efforts: [] } });
  expect(model.capabilities.contextTokens).toBeUndefined(); expect(model.capabilities.maxOutputTokens).toBeUndefined();
  expect(supportsAdditionalSamplingProvider("ollama_cloud")).toBe(true);
  expect(resolveGenerationSettings(model.capabilities, { reasoningEffort: "high", maxOutputTokens: 49152 }, { provider: "ollama_cloud" })).toMatchObject({ effective: { maxOutputTokens: 49152 }, omitted: ["reasoningEffort"] });
});
const operations: OperationKind[] = ["conversation", "manual_rv_viewer", "rv_session_viewer", "training_blind_viewer", "research_viewer", "live_monitor", "judge", "post_reveal_viewer", "post_reveal_monitor", "field_guide_update", "viewer_notes_reflection"];
it.each(operations.filter(kind => kind === "conversation" || kind === "manual_rv_viewer"))("%s passes the hosted identity, budget, sampling, thinking and native usage through the common executor", async operationKind => {
  bridge.invoke.mockResolvedValueOnce({ content: "Final", reasoning_content: "Thinking", reasoning_source: "ollama_thinking", finish_reason: "stop", actual_model: "qwen3:235b", usage: { input_tokens: 12, output_tokens: 30, native_metrics: { totalDurationNs: 1234567 } }, response_evidence: { version: 1, transportOutcome: "response_finished", boundary: "body_read", finishReason: "stop", usage: { inputTokens: 12, outputTokens: 30 } } });
  const settings = resolveGenerationSettings(models()[0].capabilities, { maxOutputTokens: 32768, temperature: 0.4, topP: 0.8, topK: 40, seed: 7 }, { provider: "ollama_cloud" });
  const result = await executeProviderChat({ config, modelId: models()[0].modelId, messages: [{ role: "user", content: "Question" }], settings, operationKind, configuredRetries: 0 });
  expect(bridge.invoke).toHaveBeenCalledTimes(1);
  expect(bridge.invoke.mock.calls[0][1].request).toMatchObject({ provider: "ollama_cloud", providerConfigId: "cloud", credentialId: "opaque-bound-key", modelId: "qwen3:235b", maxOutputTokens: 32768, topP: 0.8, topK: 40, seed: 7 });
  expect(result).toMatchObject({ content: "Final", reasoningContent: "Thinking", usage: { inputTokens: 12, outputTokens: 30, nativeMetrics: { totalDurationNs: 1234567 } } });
  expect(result.execution?.attemptOutcomes?.[0]).toMatchObject({ outcome: "response_finished", validation: "accepted" });
});
it("STOP before dispatch does not invoke the native command", async () => {
  const controller = new AbortController(); controller.abort();
  await expect(executeProviderChat({ config, modelId: "qwen3:235b", messages: [{ role: "user", content: "Q" }], settings: { requested: {}, effective: {}, omitted: [] }, signal: controller.signal, configuredRetries: 0 })).rejects.toThrow();
  expect(bridge.invoke).not.toHaveBeenCalled();
});

it.each(operations.filter(kind => kind !== "conversation" && kind !== "manual_rv_viewer"))("%s blocks unverified hosted context before dispatch", async operationKind => {
  await expect(executeProviderChat({ config, modelId: models()[0].modelId, messages: [{ role: "user", content: "Question" }], settings: { requested: { maxOutputTokens: 32768 }, effective: { maxOutputTokens: 32768 }, omitted: [] }, operationKind, configuredRetries: 0 })).rejects.toMatchObject({ details: { code: "configuration", phase: "before_dispatch" } });
  expect(bridge.invoke).not.toHaveBeenCalled();
});
