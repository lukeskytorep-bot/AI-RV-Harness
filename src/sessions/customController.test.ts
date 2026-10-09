import { describe, expect, it } from "vitest";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import type { AppRepository } from "../storage/repository";
import type { CustomProtocolVersion } from "../protocols/types";
import { runAutomaticCustomSession } from "./customController";
import type { SessionSnapshot } from "./types";

const config: ProviderConfig = { id: "p", provider: "openrouter", label: "P", credentialId: "c", enabled: true, createdAt: "now", updatedAt: "now" };
const model: ProviderModel = {
  providerConfigId: "p", provider: "openrouter", modelId: "m", displayName: "M", route: "openrouter:m", pricing: {}, recommended: false, rawMetadata: {}, refreshedAt: "now",
  capabilities: { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: false, confidence: "unknown" }, supportedParameters: [], maxOutputTokens: 65536, contextTokens: 131072, source: "provider", capturedAt: "now" },
};
const protocol: CustomProtocolVersion = { protocolId: "custom", versionId: "cv1", displayName: "Custom", version: "v1", language: "en", steps: ["Observe {{SESSION_CODE}}", "Deepen only prior evidence"], contentHash: "hash", createdAt: "now" };

function repository(log: string[], snapshots: SessionSnapshot[] = []) {
  return {
    createRvSession: async () => ({} as never), updateRvSessionState: async () => undefined,
    appendSessionEvent: async (_id: string, event: { eventType: string }) => { log.push(event.eventType); },
    updatePreRevealTranscript: async () => { log.push("saved"); }, saveSessionSnapshot: async (_id: string, snapshot: SessionSnapshot) => { snapshots.push(snapshot); },
    sealPreReveal: async () => { log.push("sealed"); }, acceptReveal: async () => undefined, recordTargetUsage: async () => undefined,
  } as unknown as Pick<AppRepository, "createRvSession" | "updateRvSessionState" | "appendSessionEvent" | "updatePreRevealTranscript" | "saveSessionSnapshot" | "sealPreReveal" | "acceptReveal" | "recordTargetUsage">;
}

describe("automatic Custom Protocol controller", () => {
  it("runs every blind step automatically and saves before the next call", async () => {
    const log: string[] = [];
    const snapshots: SessionSnapshot[] = [];
    let calls = 0;
    const result = await runAutomaticCustomSession({ repository: repository(log, snapshots), workspaceId: "w", profileId: "u", providerConfig: config, model, protocol, sessionLanguage: "en", requestedSettings: { maxOutputTokens: 1024 }, rvSystemPrompt: { id: "profile_prompt", version: "1", content: "FIXED PROFILE VIEWER PROMPT", contentSha256: "b".repeat(64) }, chat: async ({ messages }) => {
      calls += 1;
      if (calls === 2) expect(log.filter((item) => item === "saved")).toHaveLength(1);
      expect(JSON.stringify(messages)).not.toContain("SECRET REVEAL");
      expect(messages.some((message) => message.role === "system" && message.content === "FIXED PROFILE VIEWER PROMPT")).toBe(true);
      return { content: `Evidence ${calls}`, usage: {} };
    }});
    expect(calls).toBe(2);
    expect(result.state).toBe("AwaitingReveal");
    expect(log.at(-1)).toBe("PRE_REVEAL_SEALED");
    expect(snapshots[0].rvSystemPrompt?.fullContent).toBe("FIXED PROFILE VIEWER PROMPT");
  });
  it("retries the same custom step after length and never accepts the partial response", async () => {
    const log: string[] = [];
    const budgets: number[] = [];
    let calls = 0;
    const result = await runAutomaticCustomSession({
      repository: repository(log), workspaceId: "w", profileId: "u", providerConfig: config, model, protocol, sessionLanguage: "en", requestedSettings: { maxOutputTokens: 1024 },
      chat: async ({ settings }) => {
        budgets.push(settings.effective.maxOutputTokens ?? 0);
        calls += 1;
        if (calls === 1) return { content: "partial", finishReason: "length", usage: {} };
        return { content: `complete ${calls}`, finishReason: "stop", usage: {} };
      },
    });
    expect(result.state).toBe("AwaitingReveal");
    expect(budgets.slice(0, 2)).toEqual([16384, 32768]);
    expect(result.transcript).not.toContain("partial");
    expect(log.filter((item) => item === "VIEWER_OUTPUT_INCOMPLETE")).toHaveLength(1);
  });

});
