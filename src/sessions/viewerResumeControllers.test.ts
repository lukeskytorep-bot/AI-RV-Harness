import { ProviderCallError } from "../providers/providerError";
import { inspectViewerSessionResume } from "./viewerResumeDecision";
import { createSessionReplay } from "./resumeReplay";
import { prepareViewerSessionResume } from "./viewerResumeDecision";
import { workflowTestRepository } from "../testing/workflowRepository";
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
  let snapshot: unknown = null;
  const append = async (sessionId: string, event: SessionEventInput) => {
    const record: SessionEventRecord = { ...event, id: `e${++sequence}`, sessionId, sequenceNumber: sequence, createdAt: "now" };
    events.push(structuredClone(record));
    return record;
  };
  const repository = workflowTestRepository({
    createRvSession: async () => ({} as never),
    updateRvSessionState: async () => undefined,
    appendSessionEvent: append,
    appendSessionEventWithProviderState: async (sessionId: string, event: SessionEventInput) => append(sessionId, event),
    listSessionEvents: async () => structuredClone(events),
    updatePreRevealTranscript: async () => undefined,
    saveSessionSnapshot: async (_id: string, value: unknown) => { snapshot = structuredClone(value); },
    getSessionSnapshot: async () => structuredClone(snapshot),
    getSessionEventProviderState: async () => null,
    sealPreReveal: async () => undefined,
    acceptReveal: async () => undefined,
    recordTargetUsage: async () => undefined,
    createMonitorRun: async () => "monitor",
    appendMonitorIntervention: async () => undefined,
  } as unknown as AppRepository);
  return workflowTestRepository({ repository, events });
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

  await prepareViewerSessionResume({ repository, sessionId: first.sessionId, language: "en", confirm: async () => true });
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

const rejected = () => new ProviderCallError({ code: "empty_assistant_response", message: "Rejected final response", phase: "validating_response",
  responseEvidence: { version: 1, transportOutcome: "response_finished", boundary: "sse_done" } });
const runners = {
  RCP: (repository: AppRepository, resumeSession: RvSession | undefined, chat: (request: any) => Promise<any>) => runAutomaticRcpSession({ repository, workspaceId: "w", profileId: "profile", providerConfig: config, model: model(32768), protocol: getFullRcp("en"), sessionLanguage: "en", requestedSettings: {}, resumeSession, chat }),
  Lite: (repository: AppRepository, resumeSession: RvSession | undefined, chat: (request: any) => Promise<any>) => runAutomaticRvLiteSession({ repository, workspaceId: "w", profileId: "profile", providerConfig: config, model: model(32768), protocol: getRvLite("en", "core"), sessionLanguage: "en", requestedSettings: {}, resumeSession, chat }),
  Custom: (repository: AppRepository, resumeSession: RvSession | undefined, chat: (request: any) => Promise<any>) => runAutomaticCustomSession({ repository, workspaceId: "w", profileId: "profile", providerConfig: config, model: model(32768), protocol: { protocolId: "c", versionId: "v1", displayName: "Custom", version: "1", language: "en", steps: ["Observe"], contentHash: "hash", createdAt: "now" }, sessionLanguage: "en", requestedSettings: {}, resumeSession, chat }),
  Telepathic: (repository: AppRepository, resumeSession: RvSession | undefined, chat: (request: any) => Promise<any>) => runAutomaticTelepathicSession({ repository, workspaceId: "w", profileId: "profile", providerConfig: config, model: model(32768), protocol: getTelepathicProtocol("en"), sessionLanguage: "en", requestedSettings: {}, step8Questions: { mode: "predefined", questions: ["Describe the intention."] }, resumeSession, chat }),
};
for (const [name, run] of Object.entries(runners)) it(`T3 ${name}: completed rejection needs confirmation; one authorization cannot become an automatic third attempt`, async () => {
  const { repository, events } = memoryRepository();
  const first = await run(repository, undefined, async () => { throw rejected(); });
  expect(first.state).toBe("Interrupted");
  expect(inspectViewerSessionResume(events)).toMatchObject({ kind: "finished_rejected" });
  const saved = structuredClone(events);
  const session = interruptedSession(first.sessionId, first.sessionCode);
  let calls = 0;
  await run(repository, session, async () => { calls++; return { content: "unexpected", usage: {} }; }).catch(() => undefined);
  expect(calls).toBe(0);
  await prepareViewerSessionResume({ repository, sessionId: first.sessionId, language: "en", confirm: async () => true });
  await run(repository, session, async () => { calls++; throw new ProviderCallError({ code: "response_body_read", phase: "reading_body", message: "retryable connection loss" }); }).catch(() => undefined);
  expect(calls).toBe(1);
  expect(events.slice(0, saved.length)).toEqual(saved);
  expect(events.filter(e => e.eventType === "VIEWER_OUTPUT_ATTEMPT_STARTED" && e.metadata?.resumeAuthorizationId)).toHaveLength(1);
  await run(repository, session, async () => { calls++; return { content: "unexpected", usage: {} }; }).catch(() => undefined);
  expect(calls).toBe(1);
});

it("T3 Lite restart replays the accepted first output and sends only the confirmed missing step", async () => {
  const { repository, events } = memoryRepository(); let firstCalls = 0;
  const first = await runners.Lite(repository, undefined, async () => {
    if (++firstCalls >= 2) throw rejected();
    return { content: "SAVED_FIRST_OUTPUT", finishReason: "stop", usage: {} };
  });
  expect(first.state).toBe("Interrupted");
  const session = interruptedSession(first.sessionId, first.sessionCode);
  await prepareViewerSessionResume({ repository, sessionId: session.id, language: "en", confirm: async () => true });
  const liveMessages: string[] = [];
  const replay = await createSessionReplay({ repository, session, events: structuredClone(events), liveChat: async request => {
    liveMessages.push(JSON.stringify(request.messages)); return { content: "next output", finishReason: "stop", usage: {} };
  } });
  const result = await runners.Lite(replay.repository, session, replay.chat);
  expect(result.stopReason).toBeUndefined();
  expect(result.state).toBe("AwaitingReveal");
  expect(liveMessages).toHaveLength(3); // Core Lite has four Viewer calls; the first is replayed.
  expect(liveMessages.every(messages => messages.includes("SAVED_FIRST_OUTPUT"))).toBe(true);
  expect(events.filter(e => e.eventType === "VIEWER_RESPONSE" && e.content === "SAVED_FIRST_OUTPUT")).toHaveLength(1);
});
