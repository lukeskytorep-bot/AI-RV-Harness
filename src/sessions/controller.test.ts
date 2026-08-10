import { describe, expect, it } from "vitest";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import { getFullRcp } from "../resources/protocolRegistry";
import type { AppRepository } from "../storage/repository";
import { detectRepetitiveOutput, runAutomaticRcpSession } from "./controller";
import { RCP_CONTROLLER_PROMPT_VERSION, rcpPhasePrompt } from "./controllerPrompts";
import type { SessionSnapshot } from "./types";

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

function fakeRepository(log: string[], snapshots: SessionSnapshot[] = []) {
  return {
    createRvSession: async () => { log.push("create"); return {} as never; },
    updateRvSessionState: async (_id: string, state: string) => { log.push(`state:${state}`); },
    appendSessionEvent: async (_id: string, event: { eventType: string }) => { log.push(`event:${event.eventType}`); },
    updatePreRevealTranscript: async (_id: string, transcript: string) => { log.push(`save:${(transcript.match(/## Phase/g) ?? []).length}`); },
    saveSessionSnapshot: async (_id: string, snapshot: SessionSnapshot) => { snapshots.push(snapshot); log.push("snapshot"); },
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
    const snapshots: SessionSnapshot[] = [];
    let calls = 0;
    const result = await runAutomaticRcpSession({
      repository: fakeRepository(log, snapshots),
      workspaceId: "workspace_1",
      profileId: "profile_1",
      providerConfig: config,
      model,
      protocol: getFullRcp("en"),
      sessionLanguage: "en",
      requestedSettings: { reasoningEffort: "high", temperature: 1.1, maxOutputTokens: 4096 },
      rvSystemPrompt: { id: "profile_prompt", version: "1", content: "FIXED PROFILE VIEWER PROMPT", contentSha256: "c".repeat(64) },
      researchConditionInstruction: { id: "condition_a", version: "1", content: "CUSTOM VARIABLE A", contentSha256: "d".repeat(64) },
      chat: async ({ messages }) => {
        calls += 1;
        if (calls > 1) expect(log).toContain(`save:${calls - 1}`);
        expect(messages.some((message) => message.role === "system" && message.content === "FIXED PROFILE VIEWER PROMPT")).toBe(true);
        expect(messages.some((message) => message.role === "system" && message.content.includes("CUSTOM VARIABLE A"))).toBe(true);
        return { content: `Distinct phase ${calls} response with useful target descriptors.`, usage: {} };
      },
    });
    expect(calls).toBe(6);
    expect(result.state).toBe("AwaitingReveal");
    expect(log.at(-1)).toBe("event:PRE_REVEAL_SEALED");
    expect(log).toContain("sealed");
    expect(snapshots[0].rvSystemPrompt).toEqual(expect.objectContaining({ contentSha256: "c".repeat(64), fullContent: "FIXED PROFILE VIEWER PROMPT" }));
    expect(snapshots[0].researchConditionInstruction).toEqual(expect.objectContaining({ contentSha256: "d".repeat(64), fullContent: "CUSTOM VARIABLE A" }));
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

  it("audits a rejected Monitor response and continues the protocol after a limited retry", async () => {
    const log: string[] = [];
    let viewerCalls = 0;
    let monitorCalls = 0;
    const result = await runAutomaticRcpSession({
      repository: fakeRepository(log),
      workspaceId: "w",
      profileId: "p",
      providerConfig: config,
      model,
      protocol: getFullRcp("en"),
      sessionLanguage: "en",
      requestedSettings: { maxOutputTokens: 1024 },
      maxRetries: 2,
      monitor: { providerConfig: config, model },
      chat: async ({ messages }) => {
        const monitorRequest = messages.some((message) => message.role === "system" && message.content.includes("AI Monitor for a blind"));
        if (monitorRequest) {
          monitorCalls += 1;
          return { content: monitorCalls <= 2 ? "not-json" : '{"decision":"CONTINUE_PROTOCOL"}', usage: {} };
        }
        viewerCalls += 1;
        return { content: `Distinct Viewer material for phase ${viewerCalls}, containing new sensory and spatial evidence.`, usage: {} };
      },
    });
    expect(result.state).toBe("AwaitingReveal");
    expect(viewerCalls).toBe(6);
    expect(monitorCalls).toBe(7);
    expect(log).toContain("event:MONITOR_ATTEMPT_REJECTED");
    expect(log).toContain("event:MONITOR_SKIPPED_CONTINUE_PROTOCOL");
    expect(log).toContain("sealed");
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

  it("passes STOP into an in-flight provider request instead of waiting for its timeout", async () => {
    const log: string[] = [];
    const abort = new AbortController();
    let requestStarted!: () => void;
    const started = new Promise<void>((resolve) => { requestStarted = resolve; });
    const run = runAutomaticRcpSession({
      repository: fakeRepository(log), workspaceId: "w", profileId: "p", providerConfig: config, model,
      protocol: getFullRcp("en"), sessionLanguage: "en", requestedSettings: { maxOutputTokens: 1024 }, signal: abort.signal,
      chat: async (request) => new Promise((_, reject) => {
        requestStarted();
        request.signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
      }),
    });
    await started;
    abort.abort();
    const result = await run;
    expect(result.state).toBe("Interrupted");
    expect(result.stopReason).toBe("USER STOP");
  });

  it("accepts an image-only automatic target after the blind transcript is sealed", async () => {
    const log: string[] = [];
    const target = {
      id: "image_target", collection: "user" as const, title: "Image target",
      revealArtifacts: [{ artifactId: "a", path: "/managed/a.png", originalFileName: "a.png", mimeType: "image/png", size: 10, sha256: "a".repeat(64) }],
      tags: [], sourceMetadata: {}, createdAt: "now", updatedAt: "now",
    };
    const result = await runAutomaticRcpSession({
      repository: fakeRepository(log), workspaceId: "w", profileId: "p", providerConfig: config, model,
      protocol: getFullRcp("en"), sessionLanguage: "en", requestedSettings: { maxOutputTokens: 1024 }, automaticTarget: target,
      chat: async () => ({ content: "Independent blind evidence for the current protocol phase.", usage: {} }),
    });
    expect(result.state).toBe("Revealed");
    expect(log.indexOf("sealed")).toBeLessThan(log.indexOf("target-used"));
  });

  it("detects obvious repetitive generation loops", () => {
    expect(detectRepetitiveOutput(Array(7).fill("same repeated perceptual fragment over and over").join("\n"))).toBe(true);
    expect(detectRepetitiveOutput("A concise, varied response.")).toBe(false);
  });

  it("keeps the versioned ASCII-sketch instruction in the first Full RCP call in both languages", () => {
    expect(RCP_CONTROLLER_PROMPT_VERSION).toBe("1.1.0");
    expect(rcpPhasePrompt("en", 1, "1234 5678")).toMatch(/ASCII sketch[\s\S]*fenced code block/i);
    expect(rcpPhasePrompt("pl", 1, "1234 5678")).toMatch(/szkic ASCII[\s\S]*bloku kodu/i);
    expect(rcpPhasePrompt("en", 2, "1234 5678")).not.toMatch(/ASCII sketch/i);
    expect(rcpPhasePrompt("pl", 2, "1234 5678")).not.toMatch(/szkic ASCII/i);
  });
});
