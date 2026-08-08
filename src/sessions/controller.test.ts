import { describe, expect, it } from "vitest";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import { getFullRcp } from "../resources/protocolRegistry";
import type { AppRepository } from "../storage/repository";
import { detectRepetitiveOutput, runAutomaticRcpSession } from "./controller";

const config: ProviderConfig = {
  id: "provider_1",
  provider: "openrouter",
  label: "Test",
  credentialId: "credential_1",
  enabled: true,
  createdAt: "2026-08-08T00:00:00.000Z",
  updatedAt: "2026-08-08T00:00:00.000Z",
};

const model: ProviderModel = {
  providerConfigId: config.id,
  provider: "openrouter",
  modelId: "test/model",
  displayName: "Test model",
  route: "openrouter:test/model",
  recommended: false,
  rawMetadata: {},
  refreshedAt: "2026-08-08T00:00:00.000Z",
  pricing: {},
  capabilities: {
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportsVision: false,
    supportsStreaming: true,
    reasoning: { supported: true, efforts: ["low", "high"], confidence: "provider_metadata" },
    temperature: { supported: true, min: 0, max: 2, confidence: "provider_metadata" },
    supportedParameters: ["reasoning_effort", "temperature", "max_tokens"],
    maxOutputTokens: 8192,
    source: "provider",
    capturedAt: "2026-08-08T00:00:00.000Z",
  },
};

function fakeRepository(log: string[]) {
  return {
    createRvSession: async () => { log.push("create"); return {} as never; },
    updateRvSessionState: async (_id: string, state: string) => { log.push(`state:${state}`); },
    appendSessionEvent: async (_id: string, event: { eventType: string }) => { log.push(`event:${event.eventType}`); },
    updatePreRevealTranscript: async (_id: string, transcript: string) => { log.push(`save:${(transcript.match(/## Phase/g) ?? []).length}`); },
    saveSessionSnapshot: async () => { log.push("snapshot"); },
    sealPreReveal: async () => { log.push("sealed"); },
    acceptReveal: async () => undefined,
    createMonitorRun: async () => "monitor_1",
    appendMonitorIntervention: async () => undefined,
    recordTargetUsage: async () => { log.push("target-used"); },
  } as unknown as Pick<AppRepository, "createRvSession" | "updateRvSessionState" | "appendSessionEvent" | "updatePreRevealTranscript" | "saveSessionSnapshot" | "sealPreReveal" | "acceptReveal" | "createMonitorRun" | "appendMonitorIntervention" | "recordTargetUsage">;
}

describe("automatic RCP controller", () => {
  it("persists each completed phase before issuing the next provider call", async () => {
    const log: string[] = [];
    let calls = 0;
    const result = await runAutomaticRcpSession({
      repository: fakeRepository(log),
      workspaceId: "workspace_1",
      profileId: "profile_1",
      providerConfig: config,
      model,
      protocol: getFullRcp("en"),
      sessionLanguage: "en",
      requestedSettings: { reasoningEffort: "high", temperature: 1.1, maxOutputTokens: 4096 },
      chat: async () => {
        calls += 1;
        if (calls > 1) expect(log).toContain(`save:${calls - 1}`);
        return { content: `Distinct phase ${calls} response with useful target descriptors.`, usage: {} };
      },
    });
    expect(calls).toBe(6);
    expect(result.state).toBe("AwaitingReveal");
    expect(log.at(-1)).toBe("event:PRE_REVEAL_SEALED");
    expect(log).toContain("sealed");
  });

  it("never sends reveal data during blind execution", async () => {
    const log: string[] = [];
    await runAutomaticRcpSession({
      repository: fakeRepository(log), workspaceId: "w", profileId: "p", providerConfig: config, model,
      protocol: getFullRcp("en"), sessionLanguage: "en", requestedSettings: { maxOutputTokens: 1024 },
      chat: async (request) => {
        const packet = JSON.stringify(request.messages).toLowerCase();
        expect(packet).not.toContain("true target");
        expect(packet).not.toContain("reveal image");
        return { content: "Unique blind observation data that does not repeat in a loop.", usage: {} };
      },
    });
  });

  it("keeps an automatic target out of every blind provider request, then reveals after sealing", async () => {
    const log: string[] = [];
    const target = {
      id: "target_secret", collection: "user" as const, title: "Secret tower", revealText: "TRUE TARGET: steel tower",
      tags: [], sourceMetadata: {}, createdAt: "now", updatedAt: "now",
    };
    const result = await runAutomaticRcpSession({
      repository: fakeRepository(log), workspaceId: "w", profileId: "p", providerConfig: config, model,
      protocol: getFullRcp("en"), sessionLanguage: "en", requestedSettings: { maxOutputTokens: 1024 }, automaticTarget: target,
      chat: async (request) => {
        expect(JSON.stringify(request.messages)).not.toContain("TRUE TARGET: steel tower");
        return { content: "Independent blind evidence for this protocol phase.", usage: {} };
      },
    });
    expect(result.state).toBe("Revealed");
    expect(log.indexOf("sealed")).toBeLessThan(log.indexOf("target-used"));
  });

  it("honors STOP after sealing and never auto-reveals the target", async () => {
    const log: string[] = [];
    const abort = new AbortController();
    const repository = fakeRepository(log);
    repository.sealPreReveal = async () => { log.push("sealed"); abort.abort(); };
    repository.acceptReveal = async () => { log.push("REVEAL-MUST-NOT-HAPPEN"); };
    const target = { id: "secret", collection: "user" as const, title: "Secret", revealText: "TRUE TARGET", tags: [], sourceMetadata: {}, createdAt: "now", updatedAt: "now" };
    const result = await runAutomaticRcpSession({ repository, workspaceId: "w", profileId: "p", providerConfig: config, model, protocol: getFullRcp("en"), sessionLanguage: "en", requestedSettings: { maxOutputTokens: 1024 }, automaticTarget: target, signal: abort.signal, chat: async () => ({ content: "Distinct blind evidence for the current protocol phase.", usage: {} }) });
    expect(result.state).toBe("Interrupted");
    expect(result.stopReason).toBe("USER STOP");
    expect(log).not.toContain("REVEAL-MUST-NOT-HAPPEN");
    expect(log).not.toContain("target-used");
  });

  it("detects obvious repetitive generation loops", () => {
    expect(detectRepetitiveOutput(Array(7).fill("same repeated perceptual fragment over and over").join("\n"))).toBe(true);
    expect(detectRepetitiveOutput("A concise, varied response.")).toBe(false);
  });
});
