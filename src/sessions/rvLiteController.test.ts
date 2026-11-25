import { workflowTestRepository } from "../testing/workflowRepository";
import { describe, expect, it, vi } from "vitest";
import type { ProviderContinuationState } from "../providers/continuationContract";
import anthropicFixture from "../providers/continuation-fixtures/anthropic-thinking-blocks.json";
import googleFixture from "../providers/continuation-fixtures/google-thought-signature.json";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import { ProviderCallError } from "../providers/providerError";
import { getRvLite, renderRvLiteSteps } from "../resources/protocolRegistry";
import type { AppRepository } from "../storage/repository";
import type { TargetRecord } from "../targets/types";
import { runAutomaticRvLiteSession } from "./rvLiteController";
import type { SessionEventInput, SessionSnapshot } from "./types";
import { composeResearchContext } from "../research/contextComposition";

const config: ProviderConfig = { id: "p", provider: "openrouter", label: "P", credentialId: "c", enabled: true, createdAt: "now", updatedAt: "now" };
const model: ProviderModel = {
  providerConfigId: "p", provider: "openrouter", modelId: "m", displayName: "M", route: "openrouter:m", pricing: {}, recommended: false, rawMetadata: {}, refreshedAt: "now",
  capabilities: { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: false, confidence: "unknown" }, supportedParameters: [], maxOutputTokens: 65536, contextTokens: 131072, source: "provider", capturedAt: "now" },
};
const target: TargetRecord = { id: "training_1", collection: "training", title: "Secret target", revealText: "SECRET REVEAL", tags: [], sourceMetadata: {}, createdAt: "now", updatedAt: "now" };

function repository(log: string[], snapshots: SessionSnapshot[] = []) {
  return workflowTestRepository({
    listSessionEvents: async () => [],
    createRvSession: async () => ({} as never),
    updateRvSessionState: async (_id: string, state: string) => { log.push(`state:${state}`); },
    appendSessionEvent: async (_id: string, event: { eventType: string }) => { log.push(event.eventType); },
    appendSessionEventWithProviderState: async (_id: string, event: { eventType: string }) => ({ ...event, id: "event", sessionId: "session", sequenceNumber: 1, createdAt: "now" } as never),
    updatePreRevealTranscript: async () => { log.push("saved"); },
    saveSessionSnapshot: async (_id: string, snapshot: SessionSnapshot) => { snapshots.push(snapshot); },
    sealPreReveal: async () => { log.push("sealed"); },
    acceptReveal: async () => { log.push("reveal"); },
    recordTargetUsage: async () => undefined,
  } as unknown as Pick<AppRepository, "listSessionEvents" | "createRvSession" | "updateRvSessionState" | "appendSessionEvent" | "appendSessionEventWithProviderState" | "updatePreRevealTranscript" | "saveSessionSnapshot" | "sealPreReveal" | "acceptReveal" | "recordTargetUsage">);
}

describe("automatic RV Lite controller", () => {
  it("runs exactly four blind calls, persists each response first, deepens in Prompt 3, and reveals only after sealing", async () => {
    const log: string[] = [];
    const snapshots: SessionSnapshot[] = [];
    const requests: string[] = [];
    const events: SessionEventInput[] = [];
    const repo = repository(log, snapshots);
    repo.appendSessionEvent = vi.fn(async (_sessionId: string, event: SessionEventInput) => { events.push(structuredClone(event)); log.push(event.eventType); return { ...event, id: `event-${events.length}`, sessionId: "session", sequenceNumber: events.length, createdAt: "now" } as never; });
    let calls = 0;
    const result = await runAutomaticRvLiteSession({
      repository: repo, workspaceId: "w", profileId: "profile", profileName: "Leo", providerConfig: config, model,
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
        return { content: `Blind evidence ${calls}`, actualProvider: "DeepInfra", actualModel: "m-runtime", usage: {} };
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
    expect(events.filter((event) => event.eventType === "VIEWER_RESPONSE").every((event) => event.metadata?.actualProvider === "DeepInfra" && event.metadata?.actualModel === "m-runtime")).toBe(true);
  });

  it("keeps RV Lite protocol steps while Tabula rasa removes all additional Viewer context and records each request", async () => {
    const snapshots: SessionSnapshot[] = [];
    const events: SessionEventInput[] = [];
    const repo = repository([], snapshots);
    repo.appendSessionEvent = vi.fn(async (_sessionId: string, event: SessionEventInput) => { events.push(structuredClone(event)); return { ...event, id: `event-${events.length}`, sessionId: "session-tabula", sequenceNumber: events.length, createdAt: "now" } as never; });
    const researchContext = await composeResearchContext({ version: 1, mode: "replace_all", content: "" }, {
      system_prompt: { content: "FIELD", source: "field", availability: "available" },
      viewer_notes: { content: "NOTES", source: "notes", availability: "available" },
      viewer_identity: { content: "IDENTITY", source: "identity", availability: "available" },
      base_vocabulary: { content: "VOCAB", source: "vocab", availability: "available" },
    });
    const protocol = getRvLite("en", "extended");
    const sessionIdentity = { id: "session-tabula", sessionCode: "RVH-TABULA" };
    const expectedSteps = renderRvLiteSteps(protocol, undefined, sessionIdentity.sessionCode);
    let calls = 0;
    await runAutomaticRvLiteSession({
      repository: repo, workspaceId: "w", profileId: "profile", providerConfig: config, model,
      protocol, sessionLanguage: "en", requestedSettings: { maxOutputTokens: 1024 }, sessionIdentity,
      operationKind: "research_viewer", researchProjectId: "research", researchContext,
      rvSystemPrompt: { id: "legacy", version: "1", content: "SHOULD NOT LEAK", contentSha256: "e".repeat(64) },
      chat: async ({ messages }) => {
        calls += 1;
        expect(messages.filter((message) => message.role === "system")).toEqual([]);
        expect(JSON.stringify(messages)).not.toContain("SHOULD NOT LEAK");
        expect(messages.at(-1)?.content).toBe(expectedSteps[calls - 1]);
        return { content: `blind ${calls}`, finishReason: "stop", usage: {} };
      },
    });
    expect(calls).toBe(4);
    const requestEvidence = events.filter((event) => event.eventType === "RESEARCH_CONTEXT_REQUEST_EVIDENCE_V1");
    expect(requestEvidence).toHaveLength(4);
    const firstEvidence = JSON.parse(requestEvidence[0].content ?? "{}") as { messages: Array<{ role: string; content: string }> };
    expect(firstEvidence.messages.some((message) => message.role === "system")).toBe(false);
    expect(firstEvidence.messages.at(-1)?.content).toBe(expectedSteps[0]);
    expect(snapshots[0].researchContext?.applicationMessages).toEqual([]);
    expect(snapshots[0].rvSystemPrompt).toBeUndefined();
  });


  it("records request evidence for every physical RV Lite transport retry", async () => {
    const events: SessionEventInput[] = [];
    const repo = repository([]);
    repo.appendSessionEvent = vi.fn(async (_sessionId: string, event: SessionEventInput) => { events.push(structuredClone(event)); return { ...event, id: `event-${events.length}`, sessionId: "session-retry", sequenceNumber: events.length, createdAt: "now" } as never; });
    const researchContext = await composeResearchContext({ version: 1, mode: "replace_all", content: "LITE CONTEXT" }, {
      system_prompt: { content: "FIELD", source: "field", availability: "available" },
      viewer_notes: { content: "NOTES", source: "notes", availability: "available" },
      viewer_identity: { content: "IDENTITY", source: "identity", availability: "available" },
      base_vocabulary: { content: "VOCAB", source: "vocab", availability: "available" },
    });
    let transportCalls = 0;
    await runAutomaticRvLiteSession({
      repository: repo, workspaceId: "w", profileId: "profile", providerConfig: config, model, protocol: getRvLite("en", "extended"),
      sessionLanguage: "en", requestedSettings: { maxOutputTokens: 1024 }, researchProjectId: "research", operationKind: "research_viewer", researchContext,
      chat: async () => {
        transportCalls += 1;
        if (transportCalls === 1) throw new ProviderCallError({ code: "connect", message: "retry me", phase: "awaiting_headers" });
        return { content: `physical ${transportCalls}`, finishReason: "stop", usage: {} };
      },
    });
    expect(transportCalls).toBe(5);
    const evidence = events.filter((event) => event.eventType === "RESEARCH_CONTEXT_REQUEST_EVIDENCE_V1");
    expect(evidence).toHaveLength(5);
    expect(evidence[0].metadata?.logicalRequestId).toBe(evidence[1].metadata?.logicalRequestId);
    expect(evidence.slice(0, 2).map((event) => event.metadata?.physicalAttempt)).toEqual([1, 2]);
    expect(evidence[0].metadata?.physicalAttemptId).not.toBe(evidence[1].metadata?.physicalAttemptId);
    expect(evidence[0].metadata?.attemptId).toBe(evidence[1].metadata?.attemptId);
  });

  it("retries the same RV Lite step once at 16K -> 32K after length and accepts only the recovery", async () => {
    const log: string[] = [];
    const events: SessionEventInput[] = [];
    const repo = repository(log);
    repo.appendSessionEvent = vi.fn(async (_sessionId: string, event: SessionEventInput) => { events.push(structuredClone(event)); log.push(event.eventType); return { ...event, id: `event-${events.length}`, sessionId: "session", sequenceNumber: events.length, createdAt: "now" } as never; });
    const budgets: number[] = [];
    let calls = 0;
    let firstPayload = "";
    const result = await runAutomaticRvLiteSession({
      repository: repo, workspaceId: "w", profileId: "profile", providerConfig: config, model, protocol: getRvLite("en", "extended"), sessionLanguage: "en", requestedSettings: { maxOutputTokens: 1024 },
      chat: async ({ settings, messages }) => {
        budgets.push(settings.effective.maxOutputTokens ?? 0);
        calls += 1;
        const serialized = JSON.stringify(messages);
        if (calls === 1) { firstPayload = serialized; return { content: "partial phase one", finishReason: "length", usage: {} }; }
        if (calls === 2) { expect(serialized).toBe(firstPayload); return { content: "complete phase one", finishReason: "stop", usage: {} }; }
        return { content: `complete ${calls}`, finishReason: "stop", usage: {} };
      },
    });
    expect(result.state).toBe("AwaitingReveal");
    expect(budgets.slice(0, 2)).toEqual([16384, 32768]);
    expect(events.filter((event) => event.eventType === "VIEWER_OUTPUT_INCOMPLETE")).toHaveLength(1);
    expect(events.filter((event) => event.eventType === "VIEWER_RESPONSE")).toHaveLength(4);
    expect(result.transcript).not.toContain("partial phase one");
    expect(result.transcript).toContain("complete phase one");
  });

  it("stops after a second length without starting the next RV Lite step", async () => {
    const log: string[] = [];
    const events: SessionEventInput[] = [];
    const repo = repository(log);
    repo.appendSessionEvent = vi.fn(async (_sessionId: string, event: SessionEventInput) => { events.push(structuredClone(event)); log.push(event.eventType); return { ...event, id: `event-${events.length}`, sessionId: "session", sequenceNumber: events.length, createdAt: "now" } as never; });
    const requestedPrompts: string[] = [];
    const result = await runAutomaticRvLiteSession({
      repository: repo, workspaceId: "w", profileId: "profile", providerConfig: config, model, protocol: getRvLite("en", "extended"), sessionLanguage: "en", requestedSettings: { maxOutputTokens: 1024 },
      chat: async ({ messages }) => { requestedPrompts.push(messages.at(-1)?.content ?? ""); return { content: `partial-${requestedPrompts.length}`, finishReason: "length", usage: {} }; },
    });
    expect(result.state).toBe("Interrupted");
    expect(requestedPrompts).toHaveLength(2);
    expect(requestedPrompts[0]).toBe(requestedPrompts[1]);
    expect(events.filter((event) => event.eventType === "VIEWER_OUTPUT_INCOMPLETE")).toHaveLength(2);
    expect(events.some((event) => event.eventType === "VIEWER_RESPONSE")).toBe(false);
    expect(log).not.toContain("sealed");
    expect(log).not.toContain("reveal");
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

  it("persists and replays Anthropic thinking blocks across all RV Lite Viewer calls on an append-only route", async () => {
    const anthropicConfig: ProviderConfig = { ...config, id: "anthropic-p", provider: "anthropic", label: "Anthropic" };
    const anthropicModel: ProviderModel = { ...model, providerConfigId: anthropicConfig.id, provider: "anthropic", modelId: "claude-fixture", route: "anthropic:claude-fixture" };
    const log: string[] = [];
    const snapshots: SessionSnapshot[] = [];
    const repo = repository(log, snapshots);
    const persisted: ProviderContinuationState[] = [];
    repo.appendSessionEventWithProviderState = vi.fn(async (_sessionId: string, event: SessionEventInput, state: ProviderContinuationState) => {
      persisted.push(structuredClone(state));
      return { ...event, id: `anthropic-event-${persisted.length}`, sessionId: "session", sequenceNumber: persisted.length, createdAt: "now" };
    });
    const blocks = structuredClone(anthropicFixture.continuationState.blocks);
    let calls = 0;
    await runAutomaticRvLiteSession({
      repository: repo, workspaceId: "w", profileId: "profile", providerConfig: anthropicConfig, model: anthropicModel,
      protocol: getRvLite("en", "extended"), sessionLanguage: "en", requestedSettings: { maxOutputTokens: 1024 },
      chat: async ({ messages }) => {
        calls += 1;
        if (calls > 1) {
          const previousAssistant = [...messages].reverse().find((message) => message.role === "assistant");
          expect(previousAssistant?.continuationState?.transport).toBe("anthropic-native");
          expect(previousAssistant?.continuationState && "blocks" in previousAssistant.continuationState ? previousAssistant.continuationState.blocks : undefined).toEqual(blocks);
        }
        return { content: "Visible fixture answer.", reasoningDetails: blocks, reasoningSource: "anthropic_thinking_blocks", usage: {} };
      },
    });
    expect(calls).toBe(4);
    expect(persisted).toHaveLength(4);
    expect(persisted.every((state) => state.transport === "anthropic-native")).toBe(true);
    expect(snapshots[0].continuationRoute).toMatchObject({ transport: "anthropic-native", providerConfigId: "anthropic-p", credentialId: "c", requestedModelId: "claude-fixture", stateFormat: "anthropic-thinking-blocks", prefixPolicy: "append-only" });
  });

  it("stops a real repeated-sentence loop inside fenced output before the next Lite step or Reveal", async () => {
    const log: string[] = [];
    const events: SessionEventInput[] = [];
    const repo = repository(log);
    repo.appendSessionEvent = vi.fn(async (_sessionId: string, event: SessionEventInput) => {
      events.push(structuredClone(event));
      log.push(event.eventType);
      return { ...event, id: `event-${events.length}`, sessionId: "session", sequenceNumber: events.length, createdAt: "now" } as never;
    });
    const fencedLoop = `\`\`\`text\n${Array(80).fill("The same runaway sentence repeats with no new perceptual information.").join("\n")}\n\`\`\``;
    let calls = 0;

    const result = await runAutomaticRvLiteSession({
      repository: repo, workspaceId: "w", profileId: "profile", providerConfig: config, model,
      protocol: getRvLite("en", "extended"), sessionLanguage: "en", requestedSettings: { maxOutputTokens: 1024 }, automaticTarget: target,
      chat: async () => { calls += 1; return { content: fencedLoop, usage: {} }; },
    });

    expect(calls).toBe(2);
    expect(result.state).toBe("Interrupted");
    const incomplete = events.filter((event) => event.eventType === "VIEWER_OUTPUT_INCOMPLETE");
    expect(incomplete).toHaveLength(2);
    expect(incomplete.map((event) => event.metadata?.recoveryLevel)).toEqual([0, 1]);
    expect(incomplete.every((event) => event.metadata?.reason === "repetition_runaway")).toBe(true);
    expect(log).not.toContain("sealed");
    expect(log).not.toContain("reveal");
  });

  it("auto-stops before replay when repetition sanitization changes an Anthropic signed turn", async () => {
    const anthropicConfig: ProviderConfig = { ...config, id: "anthropic-p", provider: "anthropic", label: "Anthropic" };
    const anthropicModel: ProviderModel = { ...model, providerConfigId: anthropicConfig.id, provider: "anthropic", modelId: "claude-fixture", route: "anthropic:claude-fixture" };
    const log: string[] = [];
    const repo = repository(log);
    const events: SessionEventInput[] = [];
    repo.appendSessionEvent = vi.fn(async (_sessionId: string, event: SessionEventInput) => {
      events.push(structuredClone(event));
      log.push(event.eventType);
      return { ...event, id: `event-${events.length}`, sessionId: "session", sequenceNumber: events.length, createdAt: "now" } as never;
    });
    const persistWithProviderState = vi.fn(repo.appendSessionEventWithProviderState);
    repo.appendSessionEventWithProviderState = persistWithProviderState;
    const blocks = structuredClone(anthropicFixture.continuationState.blocks);
    const runaway = `Useful perceptual evidence before the provider loop.\n${"X".repeat(650)}`;
    let calls = 0;

    const result = await runAutomaticRvLiteSession({
      repository: repo, workspaceId: "w", profileId: "profile", providerConfig: anthropicConfig, model: anthropicModel,
      protocol: getRvLite("en", "extended"), sessionLanguage: "en", requestedSettings: { maxOutputTokens: 1024 },
      chat: async ({ messages }) => {
        calls += 1;
        expect(messages.some((message) => Boolean(message.continuationState))).toBe(false);
        return { content: runaway, reasoningDetails: blocks, reasoningSource: "anthropic_thinking_blocks", usage: {} };
      },
    });

    expect(calls).toBe(2);
    expect(result.state).toBe("Interrupted");
    expect(result.stopReason).toContain("repetition runaway");
    expect(result.transcript).not.toContain("Useful perceptual evidence");
    expect(result.transcript).not.toContain("OUTPUT TRUNCATED");
    expect(persistWithProviderState).not.toHaveBeenCalled();
    const incompleteAttempts = events.filter((event) => event.eventType === "VIEWER_OUTPUT_INCOMPLETE");
    expect(incompleteAttempts).toHaveLength(2);
    expect(incompleteAttempts.map((event) => event.metadata?.recoveryLevel)).toEqual([0, 1]);
    expect(events).not.toContainEqual(expect.objectContaining({ eventType: "VIEWER_RESPONSE" }));
    expect(events).not.toContainEqual(expect.objectContaining({ eventType: "OUTPUT_TRUNCATED_LOOP" }));
    expect(events).toContainEqual(expect.objectContaining({ eventType: "VIEWER_OUTPUT_INCOMPLETE", content: expect.stringContaining("Useful perceptual evidence"), metadata: expect.objectContaining({ accepted: false, reason: "repetition_runaway", rawOutputSha256: expect.any(String), recoveryLevel: expect.any(Number) }) }));
    expect(events).toContainEqual(expect.objectContaining({ eventType: "SESSION_STOPPED", content: expect.stringContaining("repetition runaway") }));
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

  it("persists the Session Snapshot before publishing reserved Research session linkage", async () => {
    const log: string[] = [];
    const snapshots: SessionSnapshot[] = [];
    const repo = repository(log, snapshots);
    let calls = 0;
    await runAutomaticRvLiteSession({
      repository: repo, workspaceId: "w", profileId: "p", providerConfig: config, model,
      protocol: getRvLite("en", "extended"), sessionLanguage: "en", requestedSettings: { maxOutputTokens: 16384 },
      sessionIdentity: { id: "session_reserved", sessionCode: "RES-TEST" },
      onSessionCreated: async () => { expect(snapshots).toHaveLength(1); log.push("linked"); },
      chat: async () => ({ content: `evidence ${++calls}`, finishReason: "stop", usage: {} }),
    });
    expect(snapshots).toHaveLength(1);
    expect(log).toContain("linked");
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

it("B2 RV Lite freezes the analytical policy independently of actual blind requests",async()=>{
 const snapshots:SessionSnapshot[]=[],budgets:number[]=[];
 const policy={version:2 as const,initialTokens:32768 as const,recoveryTokens:49152 as const};let calls=0;
 await runAutomaticRvLiteSession({repository:repository([],snapshots),workspaceId:"w",profileId:"p",profileName:"P",providerConfig:config,model,protocol:getRvLite("en"),sessionLanguage:"en",requestedSettings:{maxOutputTokens:8192},operationKind:"research_viewer",viewerOutputPolicy:{version:1,initialTokens:16384,recoveryTokens:32768,preserveConfiguredBudget:false},postRevealOutputPolicy:policy,chat:async request=>{
  budgets.push(request.settings.effective.maxOutputTokens!);return {content:`Blind sensory evidence ${++calls}`,finishReason:"stop",usage:{}};
 }});
 expect(snapshots[0].postRevealOutputPolicy).toEqual(policy);expect(snapshots[0].postRevealOutputPolicy).not.toBe(policy);
 expect(budgets).toEqual([16384,16384,16384,16384]);
 expect(JSON.parse(JSON.stringify(snapshots[0])).postRevealOutputPolicy).toEqual(policy);
});

for (const variant of ["core", "extended"] as const) {
  it(`resolves a partial ${variant} sketch in step 4 with no retry and seals before Reveal`, async () => {
    const log: string[] = [];
    const repo = repository(log);
    const append = vi.spyOn(repo, "appendSessionEvent");
    let calls = 0;
    const result = await runAutomaticRvLiteSession({
      repository: repo, workspaceId: "w", profileId: "p", providerConfig: config, model,
      protocol: getRvLite("en", variant), sessionLanguage: "en", requestedSettings: {},
      ...(variant === "extended" ? { automaticTarget: target } : {}),
      chat: async request => {
        if (++calls < 4) return { content: "earlier observation", finishReason: "stop", usage: {} };
        const prefix = "Useful sketch\n /\\\n";
        if (variant === "extended") {
          request.onStreamEvent?.({ event: "contentDelta", data: { content: prefix } });
          for (const chunk of "| /\\ |\n".repeat(500).match(/[\s\S]{1,31}/g)!) {
            request.onStreamEvent?.({ event: "contentDelta", data: { content: chunk } });
            if (request.signal?.aborted) throw request.signal.reason;
          }
          throw new Error("stream should have been cancelled before completion");
        }
        return { content: prefix + "-".repeat(12_000), finishReason: "length", usage: { outputTokens: 1200 } };
      },
    });
    expect(calls).toBe(4);
    expect(result.transcript).toContain("Useful sketch");
    expect(result.transcript).toContain("[SKETCH TRUNCATED");
    expect(result.transcript).not.toContain("-".repeat(2048));
    expect(result.state).toBe(variant === "extended" ? "Revealed" : "AwaitingReveal");
    // A partial sketch is a durable terminal response for step 4.
    const sketch = append.mock.calls.map(([, event]) => event).find(event => event.eventType === "VIEWER_RESPONSE" && event.metadata?.promptNumber === 4);
    expect(sketch?.metadata).toMatchObject({
      stepId: "lite:prompt:4:viewer", requestSha256: expect.any(String), accepted: true, partial: true,
      sketchTruncation: { repetitionRule: expect.stringMatching(/^ascii-/), rawOutputSha256: expect.any(String) },
    });
    expect(log.lastIndexOf("VIEWER_RESPONSE")).toBeLessThan(log.indexOf("sealed"));
    if (variant === "extended") expect(log.indexOf("sealed")).toBeLessThan(log.indexOf("reveal"));
    else expect(log).not.toContain("reveal");
  });
}

it.each([3, 4])("does not reveal after an incomplete earlier sketch or STOP racing step %s", async step => {
  const log: string[] = [];
  const repo = repository(log);
  const stop = new AbortController();
  let calls = 0;
  const result = await runAutomaticRvLiteSession({
    repository: repo, workspaceId: "w", profileId: "p", providerConfig: config, model,
    protocol: getRvLite("en", "extended"), sessionLanguage: "en", requestedSettings: {},
    automaticTarget: target, signal: stop.signal,
    chat: async request => {
      if (++calls < step) return { content: "earlier observation", usage: {} };
      request.onStreamEvent?.({ event: "contentDelta", data: { content: "-".repeat(12_000) } });
      expect(request.signal?.aborted).toBe(true);
      if (step === 4) stop.abort(new DOMException("User stop", "AbortError"));
      throw request.signal?.reason;
    },
  });
  expect(result.state).toBe("Interrupted");
  expect(calls).toBe(4);
  if (step === 4) expect(result.stopReason).toContain("USER STOP");
  expect(log).not.toContain("sealed");
  expect(log).not.toContain("reveal");
});

describe("Research target-code controller payloads",()=>{
  it.each(["pl","en"] as const)("runs independent A/B histories, frozen rendering and recovery without B code (%s)",async language=>{
    const {targetCodePolicy,renderResearchTargetCodeSteps}=await import("../resources/rvLiteTargetCode");
    for(const mode of ["with_code","without_code"] as const){
      const log:string[]=[], snapshots:SessionSnapshot[]=[], payloads:unknown[]=[];
      const code=`RV-LOCAL-${mode}`,protocol=getRvLite(language,"extended");let calls=0;
      const result=await runAutomaticRvLiteSession({repository:repository(log,snapshots),workspaceId:"w",profileId:"profile",profileName:"Leo",providerConfig:config,model,protocol,sessionLanguage:language,requestedSettings:{maxOutputTokens:16384},automaticTarget:target,researchProjectId:"research",operationKind:"research_viewer",viewerOutputPolicy:{version:1,initialTokens:16384,recoveryTokens:32768,preserveConfiguredBudget:false},targetCode:targetCodePolicy(mode),sessionIdentity:{id:`s-${mode}`,sessionCode:code},chat:async({messages})=>{
        calls++;payloads.push(structuredClone(messages));
        expect(JSON.stringify(messages)).not.toContain("SECRET REVEAL");
        if(mode==="without_code")expect(JSON.stringify(messages)).not.toContain(code);
        if(calls===1){expect(messages.filter(m=>m.role==="assistant")).toHaveLength(0);return {content:"partial",finishReason:"length",usage:{}};}
        return {content:`EVIDENCE-${mode}-${calls}`,finishReason:"stop",usage:{}};
      }});
      if(process.env.TARGET_CODE_EVIDENCE_DIR){
        const fs=await import("node:fs");fs.mkdirSync(process.env.TARGET_CODE_EVIDENCE_DIR,{recursive:true});
        fs.writeFileSync(`${process.env.TARGET_CODE_EVIDENCE_DIR}/${language}-${mode}.json`,JSON.stringify({language,mode,sessionCode:code,prompts:snapshots[0].researchTargetCode?.renderedPrompts,payloads},null,2));
      }
      expect(calls).toBe(5);expect(payloads[0]).toEqual(payloads[1]);expect(result.sessionCode).toBe(code);expect(log.indexOf("sealed")).toBeLessThan(log.indexOf("reveal"));
      expect(snapshots[0].researchTargetCode?.policy).toEqual(targetCodePolicy(mode));
      expect(snapshots[0].researchTargetCode?.renderedPrompts.map(p=>p.content)).toEqual(renderResearchTargetCodeSteps(protocol,"Leo",code,targetCodePolicy(mode)));
      expect(snapshots[0].researchTargetCode?.renderedPrompts.every(p=>/^[a-f0-9]{64}$/.test(p.sha256))).toBe(true);
      expect(snapshots[0].protocol.contentSha256).toBe(protocol.contentSha256);
    }
  });
  it("blocks ordinary RV, extra instructions and wrong source before any call",async()=>{
    const {targetCodePolicy}=await import("../resources/rvLiteTargetCode");const chat=vi.fn();
    const base={repository:repository([]),workspaceId:"w",profileId:"profile",providerConfig:config,model,protocol:getRvLite("en","extended"),sessionLanguage:"en" as const,requestedSettings:{},targetCode:targetCodePolicy("without_code"),chat};
    await expect(runAutomaticRvLiteSession(base)).rejects.toThrow(/restricted/);
    await expect(runAutomaticRvLiteSession({...base,researchProjectId:"r",operationKind:"research_viewer",researchConditionInstruction:{id:"x",version:"1",content:"extra",contentSha256:"x"}})).rejects.toThrow(/restricted/);
    expect(chat).not.toHaveBeenCalled();
  });
});

describe("ordinary RV profile target-code payloads", () => {
  for (const language of ["pl", "en"] as const) for (const variant of ["core", "extended"] as const) for (const mode of ["with_code", "without_code"] as const) {
    it(`freezes ${language}/${variant}/${mode}, keeping the code local in without-code`, async () => {
      const snapshots: SessionSnapshot[] = [], requests: string[] = [], log: string[] = [];
      const code = "RVH-ONLY-LOCAL", protocol = getRvLite(language, variant);
      const result = await runAutomaticRvLiteSession({ repository: repository(log, snapshots), workspaceId: "w", profileId: "p", profileName: "Leo", providerConfig: config, model, protocol, sessionLanguage: language, requestedSettings: {}, targetCodeMode: mode, sessionIdentity: { id: "session", sessionCode: code }, automaticTarget: target, chat: async ({ messages }) => {
        requests.push(JSON.stringify(messages));
        return { content: "Observation", finishReason: "stop", usage: {} };
      } });
      expect(requests).toHaveLength(4);
      expect(result.sessionCode).toBe(code);
      expect(result.state).toBe("Revealed");
      expect(log.indexOf("sealed")).toBeLessThan(log.indexOf("reveal"));
      expect(snapshots[0].profileTargetCode?.policy.mode).toBe(mode);
      expect(snapshots[0].researchTargetCode).toBeUndefined();
      expect(snapshots[0].profileTargetCode?.renderedPrompts).toHaveLength(4);
      expect(requests.every(payload => !payload.includes("SECRET REVEAL"))).toBe(true);
      if (mode === "without_code") {
        expect(requests.every(payload => !payload.includes(code))).toBe(true);
        expect(result.transcript).not.toContain(code);
      } else expect(requests[1]).toContain(code);
    });
  }
  it("fails closed before sending a system prompt containing the assigned code", async () => {
    const chat = vi.fn(), code = "RVH-LOCAL-LEAK";
    const result = await runAutomaticRvLiteSession({ repository: repository([]), workspaceId: "w", profileId: "p", providerConfig: config, model, protocol: getRvLite("en", "core"), sessionLanguage: "en", requestedSettings: {}, targetCodeMode: "without_code", sessionIdentity: { id: "session", sessionCode: code }, rvSystemPrompt: { id: "x", version: "1", content: code, contentSha256: "x" }, chat });
    expect(result.state).toBe("Interrupted");
    expect(chat).not.toHaveBeenCalled();
  });
});
