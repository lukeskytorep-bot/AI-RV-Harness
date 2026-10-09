import { describe, expect, it } from "vitest";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import { getFullRcp, getRvLite, getTelepathicProtocol } from "../resources/protocolRegistry";
import type { AppRepository } from "../storage/repository";
import type { CustomProtocolVersion } from "../protocols/types";
import { runAutomaticRcpSession } from "./controller";
import { runAutomaticRvLiteSession } from "./rvLiteController";
import { runAutomaticCustomSession } from "./customController";
import { runAutomaticTelepathicSession } from "./telepathicController";
import type { RvSession, SessionEventInput, SessionEventRecord } from "./types";

const config: ProviderConfig = { id: "p", provider: "openrouter", label: "P", credentialId: "c", enabled: true, createdAt: "now", updatedAt: "now" };
const model = (maxOutputTokens: number): ProviderModel => ({
  providerConfigId: "p", provider: "openrouter", modelId: "m", displayName: "M", route: "openrouter:m", pricing: {}, recommended: false, rawMetadata: {}, refreshedAt: "now",
  capabilities: { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: false, confidence: "unknown" }, supportedParameters: [], maxOutputTokens, contextTokens: 131072, source: "provider", capturedAt: "now" },
});

function memoryRepository() {
  const events: SessionEventRecord[] = [];
  let sequence = 0;
  const append = async (sessionId: string, event: SessionEventInput) => {
    const record: SessionEventRecord = { ...event, id: `e${++sequence}`, sessionId, sequenceNumber: sequence, createdAt: "now" };
    events.push(structuredClone(record));
    return record;
  };
  const repository = {
    createRvSession: async () => ({} as never),
    updateRvSessionState: async () => undefined,
    appendSessionEvent: append,
    appendSessionEventWithProviderState: async (sessionId: string, event: SessionEventInput) => append(sessionId, event),
    listSessionEvents: async () => structuredClone(events),
    updatePreRevealTranscript: async () => undefined,
    saveSessionSnapshot: async () => undefined,
    sealPreReveal: async () => undefined,
    acceptReveal: async () => undefined,
    recordTargetUsage: async () => undefined,
    createMonitorRun: async () => "monitor",
    appendMonitorIntervention: async () => undefined,
  } as unknown as AppRepository;
  return { repository, events };
}

function interruptedSession(id: string, sessionCode: string): RvSession {
  return { id, workspaceId: "w", profileId: "profile", sessionCode, state: "Interrupted", runType: "automatic", preRevealTranscript: "", postRevealTranscript: "", createdAt: "now", updatedAt: "now" };
}

async function expectResumeAtRecovery(runPrimary: (repository: AppRepository, viewerModel: ProviderModel, resume?: RvSession, chat?: (request: any) => Promise<any>) => Promise<{ sessionId: string; sessionCode: string; state: string }>) {
  const { repository, events } = memoryRepository();
  let primaryCalls = 0;
  const first = await runPrimary(repository, model(16384), undefined, async () => {
    primaryCalls += 1;
    return { content: "partial", finishReason: "length", usage: {} };
  });
  expect(first.state).toBe("Interrupted");
  expect(primaryCalls).toBe(1);
  const incomplete = events.find((event) => event.eventType === "VIEWER_OUTPUT_INCOMPLETE");
  const started = events.find((event) => event.eventType === "VIEWER_OUTPUT_ATTEMPT_STARTED");
  expect(incomplete?.metadata?.attemptId).toBe(started?.metadata?.attemptId);

  const budgets: number[] = [];
  let resumedCalls = 0;
  const resumed = await runPrimary(repository, model(32768), interruptedSession(first.sessionId, first.sessionCode), async ({ settings }: any) => {
    resumedCalls += 1;
    budgets.push(settings.effective.maxOutputTokens ?? 0);
    return { content: `complete-${resumedCalls}`, finishReason: "stop", usage: {} };
  });
  expect(resumed.state).toBe("AwaitingReveal");
  expect(budgets[0]).toBe(32768);
}

describe("Viewer durable Resume across controllers", () => {
  it("RCP resumes the persisted first length at recovery level one", async () => {
    await expectResumeAtRecovery((repository, viewerModel, resumeSession, chat) => runAutomaticRcpSession({ repository, workspaceId: "w", profileId: "profile", providerConfig: config, model: viewerModel, protocol: getFullRcp("en"), sessionLanguage: "en", requestedSettings: { maxOutputTokens: 1024 }, ...(resumeSession ? { resumeSession } : {}), ...(chat ? { chat } : {}) }));
  });

  it("RV Lite resumes the persisted first length at recovery level one", async () => {
    await expectResumeAtRecovery((repository, viewerModel, resumeSession, chat) => runAutomaticRvLiteSession({ repository, workspaceId: "w", profileId: "profile", profileName: "Viewer", providerConfig: config, model: viewerModel, protocol: getRvLite("en", "extended"), sessionLanguage: "en", requestedSettings: { maxOutputTokens: 1024 }, ...(resumeSession ? { resumeSession } : {}), ...(chat ? { chat } : {}) }));
  });

  it("Custom resumes the persisted first length at recovery level one", async () => {
    const protocol: CustomProtocolVersion = { protocolId: "custom", versionId: "v1", displayName: "Custom", version: "1", language: "en", steps: ["Observe", "Deepen"], contentHash: "hash", createdAt: "now" };
    await expectResumeAtRecovery((repository, viewerModel, resumeSession, chat) => runAutomaticCustomSession({ repository, workspaceId: "w", profileId: "profile", providerConfig: config, model: viewerModel, protocol, sessionLanguage: "en", requestedSettings: { maxOutputTokens: 1024 }, ...(resumeSession ? { resumeSession } : {}), ...(chat ? { chat } : {}) }));
  });

  it("Telepathic resumes the persisted first length at recovery level one", async () => {
    await expectResumeAtRecovery((repository, viewerModel, resumeSession, chat) => runAutomaticTelepathicSession({ repository, workspaceId: "w", profileId: "profile", providerConfig: config, model: viewerModel, protocol: getTelepathicProtocol("en"), sessionLanguage: "en", requestedSettings: { maxOutputTokens: 1024 }, step8Questions: { mode: "predefined", questions: ["Describe the primary intention."] }, ...(resumeSession ? { resumeSession } : {}), ...(chat ? { chat } : {}) }));
  });
});
