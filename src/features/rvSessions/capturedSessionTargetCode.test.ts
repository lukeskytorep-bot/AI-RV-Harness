import type { ProviderConfig, ProviderModel } from "../../providers/types";
import { describe, expect, it } from "vitest";
import { targetCodePolicy } from "../../resources/rvLiteTargetCode";
import type { SessionSnapshot } from "../../sessions/types";
import type { TargetCodeMode } from "../../domain/targetCodeMode";
import { capturedSessionTargetCode } from "./capturedSessionTargetCode";

function snapshot(id: string, mode?: TargetCodeMode): Pick<SessionSnapshot, "protocol" | "profileTargetCode"> {
  return { protocol: { id, version: "1", language: "en", fullContent: "", contentSha256: "" },
    ...(mode ? { profileTargetCode: { policy: targetCodePolicy(mode), renderProfileName: null, renderedPrompts: [] } } : {}) };
}

describe("captured session target-code policy", () => {
  it.each(["with_code", "without_code"] as const)("restarts with frozen %s despite profile changes", mode => {
    const current = mode === "with_code" ? "without_code" : "with_code";
    expect(capturedSessionTargetCode(snapshot("rv-lite", mode), false, current)).toEqual({ blocked: false, restartOptions: { targetCodeMode: mode } });
    expect(capturedSessionTargetCode(snapshot("rv-lite", mode), true, current)).toEqual({ blocked: false, restartOptions: {} });
  });
  it("retains the legacy renderer when no policy was saved", () => {
    expect(capturedSessionTargetCode(snapshot("rv-lite"), false, "without_code")).toEqual({ blocked: false, restartOptions: {} });
  });
  it.each(["telepathic-protocol", "custom-example"])("blocks unsupported restart for %s", id => {
    expect(capturedSessionTargetCode(snapshot(id), false, "without_code").blocked).toBe(true);
    expect(capturedSessionTargetCode(snapshot(id, "without_code"), false, "with_code").blocked).toBe(true);
    expect(capturedSessionTargetCode(snapshot(id, "without_code"), true, "with_code").blocked).toBe(true);
    expect(capturedSessionTargetCode(snapshot(id), true, "without_code").blocked).toBe(false);
    expect(capturedSessionTargetCode(snapshot(id), false, "with_code").blocked).toBe(false);
  });
});

it.each(["without_code", "with_code", undefined] as const)("dispatches a fresh controller run with the captured mode %s", async mode => {
  const { runAutomaticRvLiteSession } = await import("../../sessions/rvLiteController");
  const { getRvLite } = await import("../../resources/protocolRegistry");
  const { workflowTestRepository } = await import("../../testing/workflowRepository");
  const { BrowserSessionsRepository } = await import("../../storage/browser/sessionsRepository");
  const config: ProviderConfig = { id: "p", provider: "openrouter", label: "P", credentialId: "c", enabled: true, createdAt: "now", updatedAt: "now" };
  const model: ProviderModel = {
    providerConfigId: "p", provider: "openrouter", modelId: "m", displayName: "M", route: "openrouter:m", pricing: {}, recommended: false, rawMetadata: {}, refreshedAt: "now",
    capabilities: { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: false, confidence: "unknown" }, supportedParameters: [], maxOutputTokens: 65536, contextTokens: 131072, source: "provider", capturedAt: "now" },
  };
  const data = new Map<string, string>();
  const storage: Storage = { get length() { return data.size; }, clear: () => data.clear(), key: index => [...data.keys()][index] ?? null, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  const repository = workflowTestRepository(Object.assign(new BrowserSessionsRepository({ storage, isResearchScoresFrozen: () => false }), { recordTargetUsage: async () => undefined }));
  const requests: string[] = [];
  const code = "RVH-RESTART-NEW";
  const original = await runAutomaticRvLiteSession({ repository, workspaceId: "w", profileId: "p", providerConfig: config, model, protocol: getRvLite("en", "core"), sessionLanguage: "en", requestedSettings: { maxOutputTokens: 1024 }, ...(mode ? { targetCodeMode: mode } : {}), sessionIdentity: { id: "original", sessionCode: "RVH-RESTART-OLD" }, chat: async () => ({ content: "Observation", finishReason: "stop", usage: {} }) });
  expect(original.state).toBe("AwaitingReveal");
  const saved = await repository.getSessionSnapshot("original");
  expect(saved).toBeTruthy();
  const captured = capturedSessionTargetCode(saved!, false, mode === "without_code" ? "with_code" : "without_code");
  const result = await runAutomaticRvLiteSession({ repository, workspaceId: "w", profileId: "p", providerConfig: config, model, protocol: getRvLite("en", "core"), sessionLanguage: "en", requestedSettings: { maxOutputTokens: 1024 }, ...captured.restartOptions, sessionIdentity: { id: "fresh", sessionCode: code }, chat: async ({ messages }) => { requests.push(JSON.stringify(messages)); return { content: "Observation", finishReason: "stop", usage: {} }; } });
  expect(result.state).toBe("AwaitingReveal");
  expect(result.sessionCode).toBe(code);
  expect(requests).toHaveLength(4);
  expect(requests.some(payload => payload.includes(code))).toBe(mode !== "without_code");
  expect((await repository.getSessionSnapshot("fresh"))?.profileTargetCode?.policy.mode).toBe(mode);
});


it.each(["version", "templatesSha256"] as const)("rejects a mismatched frozen %s before dispatch", async field => {
  const saved = snapshot("rv-lite", "without_code");
  const policy = saved.profileTargetCode!.policy;
  const invalid = { ...saved, profileTargetCode: { ...saved.profileTargetCode!, policy: { ...policy, [field]: "invalid" } } };
  const requests: string[] = [];
  const restart = async () => {
    const captured = capturedSessionTargetCode(invalid, false, "with_code");
    requests.push(JSON.stringify(captured.restartOptions));
  };
  let error: unknown;
  try { await restart(); } catch (cause) { error = cause; }
  expect(error instanceof Error).toBe(true);
  expect(requests).toHaveLength(0);
});
