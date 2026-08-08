import { describe, expect, it } from "vitest";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import type { AppRepository } from "../storage/repository";
import type { CustomProtocolVersion } from "../protocols/types";
import { runAutomaticCustomSession } from "./customController";

const config: ProviderConfig = { id: "p", provider: "openrouter", label: "P", credentialId: "c", enabled: true, createdAt: "now", updatedAt: "now" };
const model: ProviderModel = {
  providerConfigId: "p", provider: "openrouter", modelId: "m", displayName: "M", route: "openrouter:m", pricing: {}, recommended: false, rawMetadata: {}, refreshedAt: "now",
  capabilities: { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: false, confidence: "unknown" }, supportedParameters: [], maxOutputTokens: 4096, source: "provider", capturedAt: "now" },
};
const protocol: CustomProtocolVersion = { protocolId: "custom", versionId: "cv1", displayName: "Custom", version: "v1", language: "en", steps: ["Observe {{SESSION_CODE}}", "Deepen only prior evidence"], contentHash: "hash", createdAt: "now" };

function repository(log: string[]) {
  return {
    createRvSession: async () => ({} as never), updateRvSessionState: async () => undefined,
    appendSessionEvent: async (_id: string, event: { eventType: string }) => { log.push(event.eventType); },
    updatePreRevealTranscript: async () => { log.push("saved"); }, saveSessionSnapshot: async () => undefined,
    sealPreReveal: async () => { log.push("sealed"); }, acceptReveal: async () => undefined, recordTargetUsage: async () => undefined,
  } as unknown as Pick<AppRepository, "createRvSession" | "updateRvSessionState" | "appendSessionEvent" | "updatePreRevealTranscript" | "saveSessionSnapshot" | "sealPreReveal" | "acceptReveal" | "recordTargetUsage">;
}

describe("automatic Custom Protocol controller", () => {
  it("runs every blind step automatically and saves before the next call", async () => {
    const log: string[] = [];
    let calls = 0;
    const result = await runAutomaticCustomSession({ repository: repository(log), workspaceId: "w", profileId: "u", providerConfig: config, model, protocol, sessionLanguage: "en", requestedSettings: { maxOutputTokens: 1024 }, chat: async ({ messages }) => {
      calls += 1;
      if (calls === 2) expect(log.filter((item) => item === "saved")).toHaveLength(1);
      expect(JSON.stringify(messages)).not.toContain("SECRET REVEAL");
      return { content: `Evidence ${calls}`, usage: {} };
    }});
    expect(calls).toBe(2);
    expect(result.state).toBe("AwaitingReveal");
    expect(log.at(-1)).toBe("PRE_REVEAL_SEALED");
  });
});
