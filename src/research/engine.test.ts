import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import type { AppRepository } from "../storage/repository";
import type { JudgeScoreRecord } from "../judge/types";
import { executeResearchSessions, judgeResearch, prepareInterruptedResearchRetry, unblindAndComputeResearch } from "./engine";
import type { ResearchConfig, ResearchProjectRecord, ResearchResults, ResearchState } from "./types";
import { createResearchProtocolSelection } from "./protocolPolicy";

const config: ResearchConfig = {
  schemaVersion: 1, name: "Blind test", workspaceId: "w", templateType: "model", sessionLanguage: "en", protocol: { id: "full-rcp", version: "1.5a" }, targetIds: ["t"], repetitions: 1, requireUnusedTargets: false,
  conditions: [
    { key: "a", label: "Model A", profileId: "p", providerConfigId: "pc", modelId: "m", requestedSettings: {} },
    { key: "b", label: "Model B", profileId: "p", providerConfigId: "pc", modelId: "m", requestedSettings: {} },
  ], judges: [{ providerConfigId: "pc", modelId: "m" }], randomization: { matchedTargets: true, randomizedExecution: true, randomizedJudgeOrder: true },
};
const provider: ProviderConfig = { id: "pc", provider: "openrouter", label: "P", credentialId: "c", enabled: true, createdAt: "now", updatedAt: "now" };
const model: ProviderModel = { providerConfigId: "pc", provider: "openrouter", modelId: "m", displayName: "M", route: "openrouter:m", capabilities: { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: false, confidence: "unknown" }, supportedParameters: [], source: "provider", capturedAt: "now" }, pricing: {}, recommended: true, rawMetadata: {}, refreshedAt: "now" };
const score: JudgeScoreRecord = { id: "score", judgeRunId: "jr", judgeIndex: 1, modelRoute: "openrouter:m", gestalt: 2, verifiableFeatures: 2, activityFunctionEvent: 1, confabulationControl: 1, total: 6, narrative: { strongestMatches: [], majorMissesContradictions: [], confabulationObservations: [], conciseRationale: "R" }, frozenAt: "now", createdAt: "now" };

describe("Research evidence boundaries", () => {
  it("keeps Viewer Notes reflection out of the Research execution engine", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/research/engine.ts"), "utf8");
    expect(source).not.toContain("runViewerNoteReflection");
    expect(source).not.toContain("commitViewerNoteReflection");
  });

  it("passes the fixed Viewer prompt and separate Custom Variable instruction into the locked session", async () => {
    const fixedPrompt = { id: "profile_prompt", version: "1", content: "FIXED VIEWER PROMPT", contentSha256: "a".repeat(64) };
    const conditionInstruction = { id: "condition_a", version: "1", content: "VARIABLE A", contentSha256: "b".repeat(64) };
    const condition = {
      key: "a", label: "A", profileId: "p", providerConfigId: "pc", modelId: "m", requestedSettings: {},
      capabilitySnapshot: model.capabilities, effectiveSettings: { requested: {}, effective: {}, omitted: [] },
      systemPrompt: fixedPrompt, conditionInstruction,
    };
    const project: ResearchProjectRecord = { id: "r", workspaceId: "w", name: "R", templateType: "custom", state: "Locked", config: { ...config, templateType: "custom", conditions: [condition] }, createdAt: "now", updatedAt: "now" };
    const sessionRunner = vi.fn(async (input) => {
      await input.onSessionCreated?.("session", "RV-TEST");
      return { sessionId: "session", sessionCode: "RV-TEST", state: "Revealed" as const, transcript: "evidence" };
    });
    const repo = {
      getResearchProject: vi.fn().mockResolvedValue(project),
      listResearchAssignments: vi.fn().mockResolvedValue([{ id: "assignment", researchProjectId: "r", anonymousSessionId: "BlindSession_ABCDEF12", targetId: "t", executionOrder: 1, judgeOrder: 1, status: "Pending" }]),
      listBlindingMappings: vi.fn().mockResolvedValue([{ id: "mapping", researchProjectId: "r", anonymousSessionId: "BlindSession_ABCDEF12", conditionId: "condition", pairKey: "pair", mappingHash: "hash", createdAt: "now" }]),
      listResearchConditions: vi.fn().mockResolvedValue([{ id: "condition", researchProjectId: "r", conditionKey: "a", config: condition }]),
      listTargets: vi.fn().mockResolvedValue([{ id: "t", collection: "user", title: "T", revealText: "Reveal", tags: [], sourceMetadata: {}, createdAt: "now", updatedAt: "now" }]),
      listProviderConfigs: vi.fn().mockResolvedValue([provider]),
      listProviderModels: vi.fn().mockResolvedValue([model]),
      setResearchProjectState: vi.fn(),
      updateResearchAssignment: vi.fn(),
    } as unknown as AppRepository;
    await executeResearchSessions({ repository: repo, projectId: "r", sessionRunner });
    expect(sessionRunner).toHaveBeenCalledWith(expect.objectContaining({ rvSystemPrompt: fixedPrompt, researchConditionInstruction: conditionInstruction }));
  });

  it("dispatches locked RV Lite Research through four-call controller semantics and keeps assignment ownership", async () => {
    const conditionInstruction = { id: "condition_a", version: "1", content: "VARIABLE A", contentSha256: "b".repeat(64) };
    const condition = {
      key: "a", label: "A", profileId: "p", providerConfigId: "pc", modelId: "m", requestedSettings: {},
      capabilitySnapshot: model.capabilities, effectiveSettings: { requested: {}, effective: {}, omitted: [] }, conditionInstruction,
    };
    const project: ResearchProjectRecord = {
      id: "r", workspaceId: "w", name: "RV Lite Research", templateType: "custom", state: "Locked",
      config: { ...config, templateType: "custom", protocol: createResearchProtocolSelection("rv-lite", "en"), conditions: [condition] },
      createdAt: "now", updatedAt: "now",
    };
    const rcpRunner = vi.fn();
    const rvLiteSessionRunner = vi.fn(async (input) => {
      expect(input.protocol).toMatchObject({ id: "rv-lite", version: "1.1.0", variant: "extended" });
      expect(input.researchProjectId).toBe("r");
      expect(input.researchConditionInstruction).toEqual(conditionInstruction);
      await input.onSessionCreated?.("session-lite", "RV-LITE");
      return { sessionId: "session-lite", sessionCode: "RV-LITE", state: "Revealed" as const, transcript: "evidence" };
    });
    const updateResearchAssignment = vi.fn();
    const repo = {
      getResearchProject: vi.fn().mockResolvedValue(project),
      listResearchAssignments: vi.fn().mockResolvedValue([{ id: "assignment", researchProjectId: "r", anonymousSessionId: "BlindSession_ABCDEF12", targetId: "t", executionOrder: 1, judgeOrder: 1, status: "Pending" }]),
      listBlindingMappings: vi.fn().mockResolvedValue([{ id: "mapping", researchProjectId: "r", anonymousSessionId: "BlindSession_ABCDEF12", conditionId: "condition", pairKey: "pair", mappingHash: "hash", createdAt: "now" }]),
      listResearchConditions: vi.fn().mockResolvedValue([{ id: "condition", researchProjectId: "r", conditionKey: "a", config: condition }]),
      listTargets: vi.fn().mockResolvedValue([{ id: "t", collection: "user", title: "T", revealText: "Reveal", tags: [], sourceMetadata: {}, createdAt: "now", updatedAt: "now" }]),
      listProviderConfigs: vi.fn().mockResolvedValue([provider]),
      listProviderModels: vi.fn().mockResolvedValue([model]),
      listProfiles: vi.fn().mockResolvedValue([{ id: "p", name: "P", credentialId: "c", createdAt: "now", updatedAt: "now" }]),
      setResearchProjectState: vi.fn(),
      updateResearchAssignment,
    } as unknown as AppRepository;
    await executeResearchSessions({ repository: repo, projectId: "r", sessionRunner: rcpRunner, rvLiteSessionRunner });
    expect(rcpRunner).not.toHaveBeenCalled();
    expect(rvLiteSessionRunner).toHaveBeenCalledTimes(1);
    expect(updateResearchAssignment).toHaveBeenCalledWith("assignment", "session-lite", "Running");
    expect(updateResearchAssignment).toHaveBeenCalledWith("assignment", "session-lite", "SessionComplete");
  });

  it("resumes with the Viewer Notes snapshot saved at Experiment Lock and rejects snapshot drift", async () => {
    const lockedNotes = { enabled: true, aiIdentityId: "identity", noteType: "viewer_self_notes" as const, versionId: "v3", versionNumber: 3, content: "locked notes", contentSha256: "n".repeat(64), estimatedTokens: 4, estimatorVersion: "conservative-char-v1" as const, capacityTokens: 1024 as const, modelRoute: "openrouter:m", capturedAt: "lock-time" };
    const condition = {
      key: "a", label: "A", profileId: "p", providerConfigId: "pc", modelId: "m", requestedSettings: {},
      capabilitySnapshot: model.capabilities, effectiveSettings: { requested: {}, effective: {}, omitted: [] },
      viewerNotes: lockedNotes,
    };
    const project: ResearchProjectRecord = { id: "r", workspaceId: "w", name: "R", templateType: "model", state: "Interrupted", config: { ...config, conditions: [condition] }, createdAt: "now", updatedAt: "now" };
    const stored = { id: "condition", researchProjectId: "r", conditionKey: "a", config: structuredClone(condition) };
    const sessionRunner = vi.fn(async (input) => {
      expect(input.viewerNotes).toEqual(lockedNotes);
      await input.onSessionCreated?.("session", "RV-TEST");
      return { sessionId: "session", sessionCode: "RV-TEST", state: "Revealed" as const, transcript: "evidence" };
    });
    const baseRepo = {
      getResearchProject: vi.fn().mockResolvedValue(project),
      listResearchAssignments: vi.fn().mockResolvedValue([{ id: "assignment", researchProjectId: "r", anonymousSessionId: "BlindSession_ABCDEF12", targetId: "t", executionOrder: 1, judgeOrder: 1, status: "RetryApproved" }]),
      listBlindingMappings: vi.fn().mockResolvedValue([{ id: "mapping", researchProjectId: "r", anonymousSessionId: "BlindSession_ABCDEF12", conditionId: "condition", pairKey: "pair", mappingHash: "hash", createdAt: "now" }]),
      listTargets: vi.fn().mockResolvedValue([{ id: "t", collection: "user", title: "T", revealText: "Reveal", tags: [], sourceMetadata: {}, createdAt: "now", updatedAt: "now" }]),
      listProviderConfigs: vi.fn().mockResolvedValue([provider]),
      listProviderModels: vi.fn().mockResolvedValue([model]),
      listProfiles: vi.fn().mockResolvedValue([{ id: "p", name: "P", credentialId: "c", createdAt: "now", updatedAt: "now" }]),
      setResearchProjectState: vi.fn(), updateResearchAssignment: vi.fn(),
    };
    const repo = { ...baseRepo, listResearchConditions: vi.fn().mockResolvedValue([stored]) } as unknown as AppRepository;
    await executeResearchSessions({ repository: repo, projectId: "r", sessionRunner });
    expect(sessionRunner).toHaveBeenCalledTimes(1);

    const drifted = structuredClone(stored);
    drifted.config.viewerNotes!.versionId = "v4";
    drifted.config.viewerNotes!.versionNumber = 4;
    const driftRepo = { ...baseRepo, listResearchConditions: vi.fn().mockResolvedValue([drifted]), setResearchProjectState: vi.fn() } as unknown as AppRepository;
    await expect(executeResearchSessions({ repository: driftRepo, projectId: "r", sessionRunner: vi.fn() })).rejects.toThrow("snapshot drift");
    expect(driftRepo.setResearchProjectState).toHaveBeenCalledWith("r", "Interrupted");
  });

  it("resumes from the frozen Field Guide prompt snapshot and ignores later active-guide drift", async () => {
    const fieldGuide = {
      aiIdentityId: "identity", language: "en" as const, versionId: "fg-v3", versionNumber: 3, versionCreatedAt: "lock-time", content: "frozen guide", contentSha256: "f".repeat(64), estimatedTokens: 4, estimatorVersion: "conservative-char-v1" as const, capacityTokens: 4096 as const, capacityTokensAtCreation: 4096 as const, modelRoute: "openrouter:m", capturedAt: "lock-time", sourceKind: "training-reflection" as const, sourceTrainingRunId: "training-3", sourceSessionId: "source-session",
      sourceSnapshot: { schemaVersion: 1 as const, sourceKind: "training-reflection" as const, profileId: "p", capturedAt: "lock-time", sourceTrainingRunId: "training-3", sourceSessionId: "source-session" },
      identity: { aiIdentityId: "identity", profileId: "p", credentialFingerprint: "fp", providerConfigId: "pc", provider: "openrouter" as const, modelId: "m", modelRoute: "openrouter:m" },
    };
    const prompt = { id: "research_field_guide_identity_en", version: "1.5.0:field-guide:fg-v3", content: "LOCKED CORE\nLOCKED BASE\nfrozen guide", contentSha256: "p".repeat(64), fieldGuide };
    const condition = {
      key: "a", label: "A", profileId: "p", providerConfigId: "pc", modelId: "m", requestedSettings: {},
      capabilitySnapshot: model.capabilities, effectiveSettings: { requested: {}, effective: {}, omitted: [] }, fieldGuide, systemPrompt: prompt,
    };
    const project: ResearchProjectRecord = { id: "r", workspaceId: "w", name: "R", templateType: "model", state: "Interrupted", config: { ...config, conditions: [condition] }, createdAt: "now", updatedAt: "now" };
    const stored = { id: "condition", researchProjectId: "r", conditionKey: "a", config: structuredClone(condition) };
    const sessionRunner = vi.fn(async (input) => {
      expect(input.rvSystemPrompt).toEqual(prompt);
      await input.onSessionCreated?.("session", "RV-TEST");
      return { sessionId: "session", sessionCode: "RV-TEST", state: "Revealed" as const, transcript: "evidence" };
    });
    const getFieldGuideBundle = vi.fn().mockRejectedValue(new Error("active guide must not be read during Resume"));
    const baseRepo = {
      getResearchProject: vi.fn().mockResolvedValue(project),
      listResearchAssignments: vi.fn().mockResolvedValue([{ id: "assignment", researchProjectId: "r", anonymousSessionId: "BlindSession_ABCDEF12", targetId: "t", executionOrder: 1, judgeOrder: 1, status: "RetryApproved" }]),
      listBlindingMappings: vi.fn().mockResolvedValue([{ id: "mapping", researchProjectId: "r", anonymousSessionId: "BlindSession_ABCDEF12", conditionId: "condition", pairKey: "pair", mappingHash: "hash", createdAt: "now" }]),
      listTargets: vi.fn().mockResolvedValue([{ id: "t", collection: "user", title: "T", revealText: "Reveal", tags: [], sourceMetadata: {}, createdAt: "now", updatedAt: "now" }]),
      listProviderConfigs: vi.fn().mockResolvedValue([provider]), listProviderModels: vi.fn().mockResolvedValue([model]), listProfiles: vi.fn().mockResolvedValue([{ id: "p", name: "P", credentialId: "c", createdAt: "now", updatedAt: "now" }]),
      setResearchProjectState: vi.fn(), updateResearchAssignment: vi.fn(), getFieldGuideBundle,
    };
    const repo = { ...baseRepo, listResearchConditions: vi.fn().mockResolvedValue([stored]) } as unknown as AppRepository;
    await executeResearchSessions({ repository: repo, projectId: "r", sessionRunner });
    expect(sessionRunner).toHaveBeenCalledTimes(1);
    expect(getFieldGuideBundle).not.toHaveBeenCalled();

    const drifted = structuredClone(stored);
    drifted.config.fieldGuide.versionId = "fg-v4";
    const driftRepo = { ...baseRepo, listResearchConditions: vi.fn().mockResolvedValue([drifted]), setResearchProjectState: vi.fn() } as unknown as AppRepository;
    await expect(executeResearchSessions({ repository: driftRepo, projectId: "r", sessionRunner: vi.fn() })).rejects.toThrow("Field Guide snapshot drift");
    expect(driftRepo.setResearchProjectState).toHaveBeenCalledWith("r", "Interrupted");
  });

  it("requires an explicit recovery action before an interrupted assignment can be retried", async () => {
    const project: ResearchProjectRecord = { id: "r", workspaceId: "w", name: "R", templateType: "model", state: "Interrupted", config, createdAt: "now", updatedAt: "now" };
    const updateRvSessionState = vi.fn();
    const updateResearchAssignment = vi.fn();
    const repo = {
      getResearchProject: vi.fn().mockResolvedValue(project),
      listResearchAssignments: vi.fn().mockResolvedValue([{ id: "a", researchProjectId: "r", anonymousSessionId: "BlindSession_ABCDEF12", sessionId: "partial", targetId: "t", executionOrder: 1, judgeOrder: 1, status: "Interrupted" }]),
      updateRvSessionState,
      updateResearchAssignment,
    } as unknown as AppRepository;
    expect(await prepareInterruptedResearchRetry(repo, "r")).toBe(1);
    expect(updateRvSessionState).toHaveBeenCalledWith("partial", "Interrupted", expect.stringContaining("explicit retry"));
    expect(updateResearchAssignment).toHaveBeenCalledWith("a", undefined, "RetryApproved");
  });

  it("judges randomized assignments without opening the Blinding Key", async () => {
    const project: ResearchProjectRecord = { id: "r", workspaceId: "w", name: "R", templateType: "model", state: "SessionsComplete", config, createdAt: "now", updatedAt: "now" };
    const mappings = vi.fn(() => { throw new Error("Judge path touched Blinding Key"); });
    const states: ResearchState[] = [];
    const repo = {
      getResearchProject: vi.fn().mockResolvedValue(project),
      listResearchAssignments: vi.fn().mockResolvedValue([{ id: "a", researchProjectId: "r", anonymousSessionId: "BlindSession_ABCDEF12", sessionId: "s", targetId: "t", executionOrder: 1, judgeOrder: 1, status: "SessionComplete" }]),
      listProviderConfigs: vi.fn().mockResolvedValue([provider]),
      listProviderModels: vi.fn().mockResolvedValue([model]),
      listJudgeScores: vi.fn().mockResolvedValue([score]),
      updateResearchAssignment: vi.fn(),
      setResearchProjectState: vi.fn(async (_id: string, state: ResearchState) => { states.push(state); }),
      listBlindingMappings: mappings,
    } as unknown as AppRepository;
    await judgeResearch({ repository: repo, projectId: "r" });
    expect(mappings).not.toHaveBeenCalled();
    expect(states).toEqual(["Judging", "ScoresFrozen"]);
  });

  it("does not read condition mappings until after ScoresFrozen transitions to Unblinded", async () => {
    const project: ResearchProjectRecord = { id: "r", workspaceId: "w", name: "R", templateType: "model", state: "ScoresFrozen", config: { ...config, judges: [{ providerConfigId: "pc", modelId: "m" }] }, scoresFrozenAt: "now", createdAt: "now", updatedAt: "now" };
    let state: ResearchState = "ScoresFrozen";
    let saved: ResearchResults | null = null;
    const repo = {
      getResearchProject: vi.fn(async () => ({ ...project, state })),
      getResearchResults: vi.fn(async () => saved),
      setResearchProjectState: vi.fn(async (_id: string, next: ResearchState) => { state = next; }),
      listResearchAssignments: vi.fn().mockResolvedValue([{ id: "a", researchProjectId: "r", anonymousSessionId: "BlindSession_ABCDEF12", sessionId: "s", targetId: "t", executionOrder: 1, judgeOrder: 1, status: "Judged" }]),
      listJudgeScores: vi.fn().mockResolvedValue([score]),
      listBlindingMappings: vi.fn(async () => {
        expect(state).toBe("Unblinded");
        return [{ id: "map", researchProjectId: "r", anonymousSessionId: "BlindSession_ABCDEF12", conditionId: "cond", pairKey: "pair", mappingHash: "h", createdAt: "now" }];
      }),
      listResearchConditions: vi.fn().mockResolvedValue([{ id: "cond", researchProjectId: "r", conditionKey: "a", config: config.conditions[0] }]),
      saveResearchResults: vi.fn(async (_id: string, results) => { saved = results; }),
    } as unknown as AppRepository;
    const results = await unblindAndComputeResearch(repo, "r");
    expect(results.conditions[0].meanTotal).toBe(6);
    expect(state).toBe("Complete");
  });

  it("resumes result computation after a temporary failure in Unblinded state", async () => {
    const project: ResearchProjectRecord = { id: "r", workspaceId: "w", name: "R", templateType: "model", state: "ScoresFrozen", config, scoresFrozenAt: "now", createdAt: "now", updatedAt: "now" };
    let state: ResearchState = "ScoresFrozen";
    let saved: ResearchResults | null = null;
    const listBlindingMappings = vi.fn()
      .mockRejectedValueOnce(new Error("temporary mapping read failure"))
      .mockResolvedValue([{ id: "map", researchProjectId: "r", anonymousSessionId: "BlindSession_ABCDEF12", conditionId: "cond", pairKey: "pair", mappingHash: "h", createdAt: "now" }]);
    const repo = {
      getResearchProject: vi.fn(async () => ({ ...project, state })),
      getResearchResults: vi.fn(async () => saved),
      setResearchProjectState: vi.fn(async (_id: string, next: ResearchState) => { state = next; }),
      listResearchAssignments: vi.fn().mockResolvedValue([{ id: "a", researchProjectId: "r", anonymousSessionId: "BlindSession_ABCDEF12", sessionId: "s", targetId: "t", executionOrder: 1, judgeOrder: 1, status: "Judged" }]),
      listJudgeScores: vi.fn().mockResolvedValue([score]),
      listBlindingMappings,
      listResearchConditions: vi.fn().mockResolvedValue([{ id: "cond", researchProjectId: "r", conditionKey: "a", config: config.conditions[0] }]),
      saveResearchResults: vi.fn(async (_id: string, results) => { saved = results; }),
    } as unknown as AppRepository;

    await expect(unblindAndComputeResearch(repo, "r")).rejects.toThrow("temporary mapping read failure");
    expect(state).toBe("Unblinded");
    const results = await unblindAndComputeResearch(repo, "r");
    expect(results.sessions).toHaveLength(1);
    expect(state).toBe("Complete");
    expect(listBlindingMappings).toHaveBeenCalledTimes(2);
  });
});
