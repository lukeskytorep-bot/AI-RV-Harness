import { describe, expect, it, vi } from "vitest";

import type { ProviderConfig, ProviderModel } from "../providers/types";
import { createSessionReplay } from "../sessions/resumeReplay";
import type { RvSession, SessionEventInput, SessionEventRecord, SessionSnapshot } from "../sessions/types";
import type { AppRepository } from "../storage/repository";
import type { ResearchAssignmentRecord, ResearchConditionRecord, ResearchProjectRecord } from "./types";
import { createResearchProtocolSelection } from "./protocolPolicy";
import { executeResearchSessions, prepareInterruptedResearchRetry } from "./engine";

const provider: ProviderConfig = { id: "pc", provider: "openrouter", label: "P", credentialId: "c", enabled: true, createdAt: "now", updatedAt: "now" };
const model: ProviderModel = {
  providerConfigId: "pc", provider: "openrouter", modelId: "m", displayName: "M", route: "openrouter:m", pricing: {}, recommended: false, rawMetadata: {}, refreshedAt: "now",
  capabilities: { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, contextTokens: 131072, maxOutputTokens: 65536, reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: false, confidence: "unknown" }, supportedParameters: [], source: "provider", capturedAt: "now" },
};

function researchDurableRepository(options?: { frozenOutputPolicy?: boolean }) {
  const protocol = createResearchProtocolSelection("rv-lite", "en");
  const condition = {
    key: "a", label: "A", profileId: "profile", providerConfigId: provider.id, modelId: model.modelId,
    requestedSettings: { maxOutputTokens: 16384 },
    ...(options?.frozenOutputPolicy ? { viewerOutputPolicy: { version: 1 as const, initialTokens: 16384, recoveryTokens: 32768, preserveConfiguredBudget: false } } : {}),
    effectiveSettings: { requested: { maxOutputTokens: 16384 }, effective: { maxOutputTokens: 16384 }, omitted: [] },
    capabilitySnapshot: structuredClone(model.capabilities),
  };
  let project: ResearchProjectRecord = {
    id: "research", workspaceId: "w", name: "Resume", templateType: "model", state: "Locked",
    config: { schemaVersion: 1, name: "Resume", workspaceId: "w", templateType: "model", sessionLanguage: "en", protocol, targetIds: ["target"], repetitions: 1, requireUnusedTargets: false, conditions: [condition], judges: [], randomization: { matchedTargets: true, randomizedExecution: true, randomizedJudgeOrder: true } },
    createdAt: "now", updatedAt: "now",
  };
  let assignment: ResearchAssignmentRecord = { id: "assignment", researchProjectId: project.id, anonymousSessionId: "BlindSession_ABCDEF12", targetId: "target", executionOrder: 1, judgeOrder: 1, status: "Pending" };
  const conditionRecord: ResearchConditionRecord = { id: "condition", researchProjectId: project.id, conditionKey: "a", config: condition };
  let session: RvSession | undefined;
  let snapshot: SessionSnapshot | undefined;
  let reveal: Parameters<AppRepository["acceptReveal"]>[1] | undefined;
  const usage: Array<{ id: string; targetId: string; profileId?: string; researchProjectId?: string; sessionId?: string; usedAt: string }> = [];
  const events: SessionEventRecord[] = [];
  let sequence = 0;
  let crashAfterFirstIncomplete = true;
  const append = async (sessionId: string, event: SessionEventInput): Promise<SessionEventRecord> => {
    sequence = Math.max(sequence, 0, ...events.map((item) => item.sequenceNumber));
    const record = { ...structuredClone(event), id: `e${++sequence}`, sessionId, sequenceNumber: sequence, createdAt: `t${sequence}` } as SessionEventRecord;
    events.push(record);
    if (event.eventType === "VIEWER_OUTPUT_INCOMPLETE" && crashAfterFirstIncomplete) {
      crashAfterFirstIncomplete = false;
      throw new Error("SIMULATED_PROCESS_CRASH_AFTER_DURABLE_INCOMPLETE");
    }
    return record;
  };
  const repository = {
    getResearchProject: vi.fn(async () => structuredClone(project)),
    setResearchProjectState: vi.fn(async (_id: string, state: ResearchProjectRecord["state"]) => { project = { ...project, state }; }),
    listResearchAssignments: vi.fn(async () => [structuredClone(assignment)]),
    updateResearchAssignment: vi.fn(async (_id: string, sessionId: string | undefined, status: string) => { assignment = { ...assignment, sessionId, status }; }),
    initializeResearchSession: vi.fn(async (_assignmentId: string, input: Parameters<AppRepository["initializeResearchSession"]>[1]) => {
      if (session) throw new Error("UNIQUE constraint failed: rv_sessions.id");
      session = { ...input, state: "Draft", preRevealTranscript: "", postRevealTranscript: "", createdAt: "now", updatedAt: "now" } as RvSession;
      assignment = { ...assignment, sessionId: session.id, status: "Initializing" };
      await append(session.id, { eventType: "SESSION_CREATED", role: "controller", metadata: { sessionCode: session.sessionCode, researchInitialization: true } });
      return structuredClone(session);
    }),
    listBlindingMappings: vi.fn(async () => [{ id: "mapping", researchProjectId: project.id, anonymousSessionId: assignment.anonymousSessionId, conditionId: conditionRecord.id, pairKey: "pair", mappingHash: "hash", createdAt: "now" }]),
    listResearchConditions: vi.fn(async () => [structuredClone(conditionRecord)]),
    listTargets: vi.fn(async () => [{ id: "target", collection: "user", title: "Target", revealText: "Reveal", tags: [], sourceMetadata: {}, createdAt: "now", updatedAt: "now" }]),
    listProviderConfigs: vi.fn(async () => [provider]),
    listProviderModels: vi.fn(async () => [model]),
    listProfiles: vi.fn(async () => [{ id: "profile", name: "Viewer", credentialId: "c", createdAt: "now", updatedAt: "now" }]),
    createRvSession: vi.fn(async (input: Record<string, unknown>) => {
      if (session) throw new Error("UNIQUE constraint failed: rv_sessions.id");
      session = { ...input, state: "Created", preRevealTranscript: "", postRevealTranscript: "", createdAt: "now", updatedAt: "now" } as unknown as RvSession;
    }),
    getRvSession: vi.fn(async () => session ? structuredClone(session) : undefined),
    updateRvSessionState: vi.fn(async (_id: string, state: RvSession["state"]) => { if (session) session = { ...session, state, updatedAt: "later" }; }),
    appendSessionEvent: vi.fn(append),
    appendSessionEventWithProviderState: vi.fn(async (sessionId: string, event: SessionEventInput) => append(sessionId, event)),
    listSessionEvents: vi.fn(async () => events.map((event) => structuredClone(event))),
    updatePreRevealTranscript: vi.fn(async (_id: string, transcript: string) => { if (session) session = { ...session, preRevealTranscript: transcript }; }),
    saveSessionSnapshot: vi.fn(async (_id: string, value: SessionSnapshot) => { snapshot = structuredClone(value); }),
    getSessionSnapshot: vi.fn(async () => snapshot ? structuredClone(snapshot) : undefined),
    getSessionEventProviderState: vi.fn(async () => undefined),
    sealPreReveal: vi.fn(async (_id: string, transcript: string, hash: string) => { if (session) session = { ...session, preRevealTranscript: transcript, preRevealHash: hash, preRevealSealedAt: "sealed", state: "AwaitingReveal", updatedAt: "later" }; }),
    acceptReveal: vi.fn(async (_id: string, value: Parameters<AppRepository["acceptReveal"]>[1]) => { if (session?.state !== "AwaitingReveal") throw new Error("Reveal requires a sealed pre-reveal session"); reveal = structuredClone(value); session = { ...session, state: "Revealed", updatedAt: "later" }; }),
    getReveal: vi.fn(async () => reveal ? structuredClone(reveal) : null),
    recordTargetUsage: vi.fn(async (value: { targetId: string; profileId?: string; researchProjectId?: string; sessionId?: string }) => { if (!usage.some((item) => item.targetId === value.targetId && item.sessionId === value.sessionId)) usage.push({ ...value, id: `u${usage.length + 1}`, usedAt: "now" }); }),
    listTargetUsage: vi.fn(async () => structuredClone(usage) as never),
  } as unknown as AppRepository;
  return { repository, events, assignment: () => assignment, project: () => project, session: () => session!, snapshot: () => snapshot! };
}

describe("Research same-assignment Resume", () => {
  it("replays accepted P1 and resumes only missing P2 at 32K under the same assignment/session", async () => {
    const durable = researchDurableRepository({ frozenOutputPolicy: true });
    let firstCalls = 0;
    await executeResearchSessions({
      repository: durable.repository,
      projectId: "research",
      rvLiteSessionRunner: async (input) => (await import("../sessions/rvLiteController")).runAutomaticRvLiteSession({
        ...input,
        chat: async () => {
          firstCalls += 1;
          if (firstCalls === 1) return { content: "P1 accepted", finishReason: "stop", usage: {} };
          return { content: "P2 partial", finishReason: "length", usage: {} };
        },
      }),
    });
    expect(firstCalls).toBe(2);
    const originalSessionId = durable.assignment().sessionId;
    expect(originalSessionId).toBeTruthy();
    expect(durable.assignment().status).toBe("Interrupted");

    expect(await prepareInterruptedResearchRetry(durable.repository, "research")).toBe(1);
    expect(durable.assignment()).toMatchObject({ sessionId: originalSessionId, status: "ResumeApproved" });

    const liveBudgets: number[] = [];
    const livePrompts: string[] = [];
    await executeResearchSessions({
      repository: durable.repository,
      projectId: "research",
      sessionReplayFactory: (args) => createSessionReplay({
        ...args,
        liveChat: async ({ settings, messages }) => {
          liveBudgets.push(settings.effective.maxOutputTokens ?? 0);
          livePrompts.push(messages.at(-1)?.content ?? "");
          return { content: `recovered ${liveBudgets.length}`, finishReason: "stop", usage: {} };
        },
      }),
    });

    expect(durable.assignment()).toMatchObject({ sessionId: originalSessionId, status: "SessionComplete" });
    expect(durable.project().state).toBe("SessionsComplete");
    expect(liveBudgets[0]).toBe(32768);
    expect(livePrompts[0]).toContain("Step 2");
    expect(durable.events.filter((event) => event.eventType === "VIEWER_RESPONSE" && event.metadata?.stepId === "lite:prompt:1:viewer")).toHaveLength(1);
  });
  it("preserves a legacy locked Research single output budget instead of silently upgrading it", async () => {
    const durable = researchDurableRepository();
    let calls = 0;
    await executeResearchSessions({
      repository: durable.repository,
      projectId: "research",
      rvLiteSessionRunner: async (input) => (await import("../sessions/rvLiteController")).runAutomaticRvLiteSession({
        ...input,
        chat: async () => {
          calls += 1;
          return { content: "partial", finishReason: "length", usage: {} };
        },
      }),
    });
    expect(calls).toBe(1);
    expect(durable.assignment().status).toBe("Interrupted");
    expect(durable.snapshot().viewerOutputPolicy?.preserveConfiguredBudget).toBe(true);
  });

});
