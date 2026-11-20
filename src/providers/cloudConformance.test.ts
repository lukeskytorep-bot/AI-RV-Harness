import { beforeEach, expect, it, vi } from "vitest";
const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke, Channel: class { onmessage?: unknown; } }));
vi.mock("../storage", () => ({ isTauriRuntime: () => true }));
vi.mock("./debug", () => ({ recordProviderDebug: vi.fn(), detailedProviderDiagnosticsEnabled: () => false }));
import { runCloudConformance } from "./cloudConformance";
import { CLOUD_CONFORMANCE_OPERATION, CLOUD_CONFORMANCE_BUDGET, CLOUD_CONFORMANCE_RECALL, cloudConformanceFirstMessage } from "./cloudConformanceContract";
import { executeProviderChat } from "./requestExecutor";
import { normalizeModelDiscovery } from "./capabilities";
import type { ProviderConfig, ProviderMessage } from "./types";
const config: ProviderConfig = { id: "cloud", provider: "ollama_cloud", label: "Cloud", credentialId: "PRIVATE_CREDENTIAL_ID", enabled: true, createdAt: "t", updatedAt: "t" };
const baseModel = normalizeModelDiscovery(config, { models: [{ name: "qwen:exact", digest: "fixture-digest" }] }, "t")[0];
let key: string, currentConfig: ProviderConfig, model: typeof baseModel;
const repository = { listProviderConfigs: async () => [currentConfig], listProviderModels: async () => [model] };
const calls = () => bridge.invoke.mock.calls.filter(([cmd]) => cmd === "provider_chat");
const evidence = { version: 1, transportOutcome: "response_finished", boundary: "body_read", finishReason: "stop", usage: { inputTokens: 20, outputTokens: 3 } };
function answer(request: { messages: ProviderMessage[] }) {
  const marker = request.messages[0].content.match(/rvh_cloud_[a-f0-9]{32}/)![0];
  return { content: request.messages.length === 1 ? "READY" : marker, reasoning_content: "PRIVATE_THINKING", finish_reason: "stop", response_evidence: evidence, usage: { input_tokens: 20, output_tokens: 3 }, provider_request_id: "request-fixture" };
}
beforeEach(() => {
  bridge.invoke.mockReset(); key = "PRIVATE_NATIVE_FINGERPRINT"; currentConfig = structuredClone(config); model = structuredClone(baseModel);
  bridge.invoke.mockImplementation(async (cmd, args) => {
    if (cmd === "credential_identity_fingerprint") return key;
    if (cmd === "provider_chat") return answer(args.request);
    throw new Error("Unexpected IPC command");
  });
});
const run = (signal = new AbortController().signal) => runCloudConformance({ repository, providerConfigId: config.id, modelId: model.modelId, signal });
it("real executor/IPC makes exactly two bounded calls and exports limited observations without secrets or thinking", async () => {
  const report = await run();
  expect(report).toMatchObject({ outcome: "two_turn_recall_observed", fullInputPreservation: "unverified", oversizedRejection: "unverified", automaticGenerationEnabled: false, serverVersion: null, cachedModelDigest: "fixture-digest" });
  expect(calls()).toHaveLength(2);
  const requests = calls().map(([, args]) => args.request);
  expect(requests[0]).toMatchObject({ provider: "ollama_cloud", modelId: "qwen:exact", maxOutputTokens: 4096 });
  expect(requests[1].messages).toEqual([requests[0].messages[0], { role: "assistant", content: "READY" }, { role: "user", content: CLOUD_CONFORMANCE_RECALL }]);
  expect(report.turns).toHaveLength(2);
  for (const turn of report.turns) expect(turn.responseTextSha256).toBe(turn.expectedReplySha256);
  expect(report.turns.every(t => t.dispatch === "response_received" && t.replyMatched && t.thinkingObserved)).toBe(true);
  for (const privateText of [config.credentialId, key, "PRIVATE_THINKING"]) expect(JSON.stringify(report)).not.toContain(privateText);
  expect(report.cachedModelMetadataSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.parse(JSON.stringify(report))).toEqual(report);
});
it.each(["wrong", "length", "reasoning_only"])("%s first answer stops the diagnostic after one call", async kind => {
  bridge.invoke.mockImplementation(async (cmd, args) => cmd === "credential_identity_fingerprint" ? key : { ...answer(args.request), content: kind === "wrong" ? "No" : kind === "reasoning_only" ? "" : "READY", finish_reason: kind === "length" ? "length" : "stop" });
  const report = await run(); expect(report.outcome).toBe("not_observed"); expect(calls()).toHaveLength(1);
});
it("a finished rejected response retains completion evidence and never triggers retry", async () => {
  bridge.invoke.mockImplementation(async cmd => {
    if (cmd === "credential_identity_fingerprint") return key;
    throw { code: "empty_assistant_response", message: "PRIVATE_ERROR", phase: "validating_response", responseEvidence: evidence };
  });
  const report = await run(); expect(calls()).toHaveLength(1); expect(report).toMatchObject({ outcome: "request_failed", turns: [{ dispatch: "response_received", responseEvidence: evidence }] }); expect(JSON.stringify(report)).not.toContain("PRIVATE_ERROR");
});
it("an unknown cancellation retains uncertainty without retry or blaming the user", async () => {
  bridge.invoke.mockImplementation(async cmd => {
    if (cmd === "credential_identity_fingerprint") return key;
    throw { code: "cancelled", message: "provider request cancelled", phase: "awaiting_headers" };
  });
  const report = await run(); expect(report).toMatchObject({ outcome: "request_failed", turns: [{ dispatch: "unknown" }] }); expect(calls()).toHaveLength(1);
});
it("STOP during the first call prevents the second call", async () => {
  const controller = new AbortController();
  bridge.invoke.mockImplementation(async (cmd, args) => {
    if (cmd === "credential_identity_fingerprint") return key;
    if (cmd === "cancel_provider_request") return true;
    controller.abort(); return answer(args.request);
  });
  const report = await run(controller.signal); expect(report.outcome).toBe("cancelled"); expect(calls()).toHaveLength(1);
});
it("STOP before starting makes no calls", async () => {
  const controller = new AbortController(); controller.abort(); expect((await run(controller.signal)).outcome).toBe("cancelled"); expect(bridge.invoke).not.toHaveBeenCalled();
});
it.each(["key", "model", "disabled"])("%s drift between turns prevents the second request", async change => {
  bridge.invoke.mockImplementation(async (cmd, args) => {
    if (cmd === "credential_identity_fingerprint") return key;
    if (change === "key") key = "NEW_IDENTITY";
    if (change === "model") model.rawMetadata = { digest: "different" };
    if (change === "disabled") currentConfig.enabled = false;
    return answer(args.request);
  });
  expect((await run()).outcome).toBe("connection_changed"); expect(calls()).toHaveLength(1);
});
it.each(["arbitrary", "oversized", "images", "wrong_budget", "wrong_id", "extra_settings"])("the conformance exception cannot dispatch %s input", async variant => {
  const first = cloudConformanceFirstMessage("rvh_cloud_" + "a".repeat(32));
  const messages: ProviderMessage[] = variant === "arbitrary" ? [{ role: "user", content: "Research prompt" }] : variant === "oversized" ? [{ ...first, content: first.content + "x".repeat(10000) }] : variant === "images" ? [{ ...first, images: [] }] : [first];
  await expect(executeProviderChat({ config, modelId: model.modelId, messages, settings: { requested: {}, effective: { maxOutputTokens: variant === "wrong_budget" ? 49152 : CLOUD_CONFORMANCE_BUDGET, ...(variant === "extra_settings" ? { temperature: 1 } : {}) }, omitted: [] }, configuredRetries: 0, operationKind: "cloud_conformance", operationId: variant === "wrong_id" ? "telepathic-series:s" : CLOUD_CONFORMANCE_OPERATION })).rejects.toMatchObject({ details: { phase: "before_dispatch", code: "configuration" } });
  expect(calls()).toHaveLength(0);
});

it("a local native refusal is reported as not dispatched", async () => {
  bridge.invoke.mockImplementation(async cmd => {
    if (cmd === "credential_identity_fingerprint") return key;
    throw { code: "configuration", message: "Changed route", phase: "before_dispatch" };
  });
  expect(await run()).toMatchObject({ outcome: "request_failed", turns: [{ dispatch: "not_dispatched" }] }); expect(calls()).toHaveLength(1);
});
