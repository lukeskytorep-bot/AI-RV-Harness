import { describe, expect, it, vi } from "vitest";
import type { ProviderContinuationState } from "../providers/continuationContract";
import googleFixture from "../providers/continuation-fixtures/google-thought-signature.json";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import { getRvLite } from "../resources/protocolRegistry";
import type { AppRepository } from "../storage/repository";
import type { TargetRecord } from "../targets/types";
import { runAutomaticRvLiteSession } from "./rvLiteController";
import type { SessionEventInput, SessionSnapshot } from "./types";

const config: ProviderConfig = { id: "p", provider: "openrouter", label: "P", credentialId: "c", enabled: true, createdAt: "now", updatedAt: "now" };
const model: ProviderModel = {
  providerConfigId: "p", provider: "openrouter", modelId: "m", displayName: "M", route: "openrouter:m", pricing: {}, recommended: false, rawMetadata: {}, refreshedAt: "now",
  capabilities: { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: false, confidence: "unknown" }, supportedParameters: [], maxOutputTokens: 4096, source: "provider", capturedAt: "now" },
};
const target: TargetRecord = { id: "training_1", collection: "training", title: "Secret target", revealText: "SECRET REVEAL", tags: [], sourceMetadata: {}, createdAt: "now", updatedAt: "now" };

function repository(log: string[], snapshots: SessionSnapshot[] = []) {
  return {
    createRvSession: async () => ({} as never),
    updateRvSessionState: async (_id: string, state: string) => { log.push(`state:${state}`); },
    appendSessionEvent: async (_id: string, event: { eventType: string }) => { log.push(event.eventType); },
    appendSessionEventWithProviderState: async (_id: string, event: { eventType: string }) => ({ ...event, id: "event", sessionId: "session", sequenceNumber: 1, createdAt: "now" } as never),
    updatePreRevealTranscript: async () => { log.push("saved"); },
    saveSessionSnapshot: async (_id: string, snapshot: SessionSnapshot) => { snapshots.push(snapshot); },
    sealPreReveal: async () => { log.push("sealed"); },
    acceptReveal: async () => { log.push("reveal"); },
    recordTargetUsage: async () => undefined,
  } as unknown as Pick<AppRepository, "createRvSession" | "updateRvSessionState" | "appendSessionEvent" | "appendSessionEventWithProviderState" | "updatePreRevealTranscript" | "saveSessionSnapshot" | "sealPreReveal" | "acceptReveal" | "recordTargetUsage">;
}

describe("automatic RV Lite controller", () => {
  it("runs exactly four blind calls, persists each response first, deepens in Prompt 3, and reveals only after sealing", async () => {
    const log: string[] = [];
    const snapshots: SessionSnapshot[] = [];
    const requests: string[] = [];
    let calls = 0;
    const result = await runAutomaticRvLiteSession({
      repository: repository(log, snapshots), workspaceId: "w", profileId: "profile", profileName: "Leo", providerConfig: config, model,
      protocol: getRvLite("pl"), sessionLanguage: "pl", requestedSettings: { maxOutputTokens: 1024 }, automaticTarget: target,
      rvSystemPrompt: {
        id: "viewer_prompt_identity_en", version: "1.5.0:field-guide:fg-v1", content: "FIXED PROFILE VIEWER PROMPT", contentSha256: "a".repeat(64),
        fieldGuide: { aiIdentityId: "identity", language: "en", versionId: "fg-v1", versionNumber: 1, content: "FIELD GUIDE", contentSha256: "f".repeat(64), estimatedTokens: 10, estimatorVersion: "conservative-char-v1", capacityTokens: 2048, modelRoute: model.route, capturedAt: "now", sourceKind: "factory-baseline" },
      },
      chat: async ({ messages }) => {
        calls += 1;
        if (calls > 1) expect(log.filter((item) => item === "saved")).toHaveLength(calls - 1);
        const payload = JSON.stringify(messages);
        expect(payload).not.toContain("SECRET REVEAL");
        expect(messages[0]).toEqual({ role: "system", content: "FIXED PROFILE VIEWER PROMPT" });
        requests.push(messages.at(-1)?.content ?? "");
        return { content: `Blind evidence ${calls}`, usage: {} };
      },
    });
    expect(calls).toBe(4);
    expect(requests[0]).toContain("Witaj Leo, przedstawiam układ sesji RV.");
    expect(requests[2]).toContain("obowiązkowo wykonaj Deepening Movement");
    expect(requests[3]).toContain("Teraz wykonaj Krok 4.");
    expect(log.filter((item) => item === "saved")).toHaveLength(4);
    expect(log.indexOf("sealed")).toBeLessThan(log.indexOf("reveal"));
    expect(result.state).toBe("Revealed");
    expect(snapshots[0].rvSystemPrompt).toEqual(expect.objectContaining({ contentSha256: "a".repeat(64), fullContent: "FIXED PROFILE VIEWER PROMPT" }));
    expect(snapshots[0].rvSystemPrompt?.lockedBlocks?.map((block) => block.id)).toEqual(["locked-viewer-identity", "locked-viewer-base-vocabulary"]);
    expect(snapshots[0].rvSystemPrompt?.fieldGuide).toMatchObject({ versionId: "fg-v1", content: "FIELD GUIDE", capacityTokens: 2048 });
    expect(snapshots[0].automaticRevealHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("persists OpenRouter continuation state on the exact response event and replays it on later Viewer calls", async () => {
    const log: string[] = [];
    const snapshots: SessionSnapshot[] = [];
    const repo = repository(log, snapshots);
    const persisted: Array<{ event: { eventType: string; content?: string; metadata?: Record<string, unknown> }; state: unknown }> = [];
    repo.appendSessionEventWithProviderState = vi.fn(async (_sessionId: string, event: SessionEventInput, state: ProviderContinuationState) => {
      persisted.push({ event, state });
      return { ...event, id: `event-${persisted.length}`, sessionId: "session", sequenceNumber: persisted.length, createdAt: "now" };
    });
    let calls = 0;
    await runAutomaticRvLiteSession({
      repository: repo, workspaceId: "w", profileId: "profile", providerConfig: config, model,
      protocol: getRvLite("en", "extended"), sessionLanguage: "en", requestedSettings: { maxOutputTokens: 1024 },
      chat: async ({ messages }) => {
        calls += 1;
        if (calls > 1) {
          const previousAssistant = [...messages].reverse().find((message) => message.role === "assistant");
          expect(previousAssistant?.continuationState).toBeDefined();
          expect(previousAssistant?.continuationState?.transport).toBe("openrouter");
        }
        return {
          content: `Evidence ${calls}`,
          reasoningDetails: [{ type: "reasoning.encrypted", data: "RklYVFVSRQ==", id: `r${calls}`, format: "openai-responses-v1", index: 0 }],
          usage: {},
        };
      },
    });
    expect(calls).toBe(4);
    expect(persisted).toHaveLength(4);
    expect(persisted.every(({ event }) => event.eventType === "VIEWER_RESPONSE")).toBe(true);
    expect(snapshots[0].continuationRoute).toMatchObject({
      transport: "openrouter", providerConfigId: "p", credentialId: "c", requestedModelId: "m",
    });
  });

  it("persists and replays Google native thoughtSignature across all RV Lite Viewer calls", async () => {
    const googleConfig: ProviderConfig = { ...config, id: "google-p", provider: "google", label: "Google" };
    const googleModel: ProviderModel = { ...model, providerConfigId: googleConfig.id, provider: "google", modelId: "gemini-3.8-flash", route: "google:gemini-3.8-flash" };
    const log: string[] = [];
    const snapshots: SessionSnapshot[] = [];
    const repo = repository(log, snapshots);
    const persisted: ProviderContinuationState[] = [];
    repo.appendSessionEventWithProviderState = vi.fn(async (_sessionId: string, event: SessionEventInput, state: ProviderContinuationState) => {
      persisted.push(structuredClone(state));
      return { ...event, id: `google-event-${persisted.length}`, sessionId: "session", sequenceNumber: persisted.length, createdAt: "now" };
    });
    const parts = structuredClone(googleFixture.providerResponse.candidates[0].content.parts);
    let calls = 0;
    await runAutomaticRvLiteSession({
      repository: repo, workspaceId: "w", profileId: "profile", providerConfig: googleConfig, model: googleModel,
      protocol: getRvLite("en", "extended"), sessionLanguage: "en", requestedSettings: { maxOutputTokens: 1024 },
      chat: async ({ messages }) => {
        calls += 1;
        if (calls > 1) {
          const previousAssistant = [...messages].reverse().find((message) => message.role === "assistant");
          expect(previousAssistant?.continuationState?.transport).toBe("google-native");
          expect(previousAssistant?.continuationState && "parts" in previousAssistant.continuationState ? previousAssistant.continuationState.parts : undefined).toEqual(parts);
        }
        return { content: "Visible fixture answer.", reasoningDetails: parts, reasoningSource: "google_thought_parts", usage: {} };
      },
    });
    expect(calls).toBe(4);
    expect(persisted).toHaveLength(4);
    expect(persisted.every((state) => state.transport === "google-native")).toBe(true);
    expect(snapshots[0].continuationRoute).toMatchObject({ transport: "google-native", providerConfigId: "google-p", credentialId: "c", requestedModelId: "gemini-3.8-flash", stateFormat: "google-thought-parts" });
  });

  it("preserves Research ownership, assignment linkage and locked condition instruction", async () => {
    const log: string[] = [];
    const snapshots: SessionSnapshot[] = [];
    const repo = repository(log, snapshots);
    const createRvSession = vi.fn(async () => ({} as never));
    const recordTargetUsage = vi.fn(async () => undefined);
    repo.createRvSession = createRvSession;
    repo.recordTargetUsage = recordTargetUsage;
    const onSessionCreated = vi.fn(async () => undefined);
    let calls = 0;
    await runAutomaticRvLiteSession({
      repository: repo, workspaceId: "w", profileId: "profile", profileName: "Viewer", providerConfig: config, model,
      protocol: getRvLite("en", "extended"), sessionLanguage: "en", requestedSettings: { maxOutputTokens: 1024 }, automaticTarget: target,
      researchProjectId: "research-1",
      researchConditionInstruction: { id: "condition-a", version: "1", content: "LOCKED VARIABLE A", contentSha256: "c".repeat(64) },
      onSessionCreated,
      chat: async ({ messages }) => {
        calls += 1;
        expect(JSON.stringify(messages)).toContain("[LOCKED RESEARCH CONDITION INSTRUCTION]");
        expect(JSON.stringify(messages)).toContain("LOCKED VARIABLE A");
        return { content: `Evidence ${calls}`, usage: {} };
      },
    });
    expect(calls).toBe(4);
    expect(createRvSession).toHaveBeenCalledWith(expect.objectContaining({ researchProjectId: "research-1" }));
    expect(onSessionCreated).toHaveBeenCalledTimes(1);
    expect(recordTargetUsage).toHaveBeenCalledWith(expect.objectContaining({ researchProjectId: "research-1" }));
    expect(snapshots[0]).toMatchObject({
      researchProjectId: "research-1",
      researchConditionInstruction: { id: "condition-a", version: "1", fullContent: "LOCKED VARIABLE A" },
    });
  });

  it("runs the Special Viewer Task in a separate call after Step 3 and appends the visible response", async () => {
    const log: string[] = [];
    const requests: string[] = [];
    let savedTranscript = "";
    const repo = repository(log);
    repo.updatePreRevealTranscript = async (_id: string, transcript: string) => { savedTranscript = transcript; log.push("saved"); };
    const result = await runAutomaticRvLiteSession({
      repository: repo,
      workspaceId: "w",
      profileId: "p",
      providerConfig: config,
      model,
      protocol: getRvLite("en", "extended"),
      sessionLanguage: "en",
      requestedSettings: { maxOutputTokens: 1024 },
      specialTask: { selectedOptions: ["subject_a"] },
      chat: async ({ messages }) => {
        requests.push(messages.at(-1)?.content ?? "");
        return { content: `Distinct response ${requests.length}`, usage: {} };
      },
    });
    expect(result.state).toBe("AwaitingReveal");
    expect(requests).toHaveLength(5);
    expect(requests[2]).toContain("Step 3");
    expect(requests[2]).not.toContain("SPECIAL VIEWER TASK");
    expect(requests[3]).toContain("SPECIAL VIEWER TASK");
    expect(requests[4]).toContain("Step 4");
    expect(savedTranscript).toContain("## RV Lite — Special Task after Step 3");
    expect(savedTranscript).toContain("Distinct response 4");
    expect(log).toContain("VIEWER_SPECIAL_TASK_RESPONSE");
  });

  it("omits the name cleanly when the Profile has no AI name", async () => {
    let firstPrompt = "";
    let calls = 0;
    await runAutomaticRvLiteSession({
      repository: repository([]), workspaceId: "w", profileId: "profile", profileName: "", providerConfig: config, model,
      protocol: getRvLite("pl"), sessionLanguage: "pl", requestedSettings: { maxOutputTokens: 1024 },
      chat: async ({ messages }) => {
        calls += 1;
        if (calls === 1) firstPrompt = messages.at(-1)?.content ?? "";
        return { content: `Blind evidence ${calls}`, usage: {} };
      },
    });
    expect(firstPrompt).toContain("Witaj, przedstawiam układ sesji RV.");
    expect(firstPrompt).not.toContain("Nemo");
  });
});
