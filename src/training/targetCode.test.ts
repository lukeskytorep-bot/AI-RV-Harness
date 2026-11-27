import { describe, expect, it } from "vitest";
import { sha256Text } from "../application/sha256";
import { executeLearningProposal, LearningProposalFailure } from "../aiCenter/learningExecution";
import { getRvLite } from "../resources/protocolRegistry";
import { targetCodePolicy } from "../resources/rvLiteTargetCode";
import { runAutomaticRvLiteSession } from "../sessions/rvLiteController";
import { createSessionReplay } from "../sessions/resumeReplay";
import { runAutomaticPostRevealReview } from "../sessions/postReveal";
import { BrowserSessionsRepository } from "../storage/browser/sessionsRepository";
import { BrowserTrainingRepository } from "../storage/browser/trainingRepository";
import type { AppRepository } from "../storage/repository";
import type { ProviderConfig, ProviderModel, ProviderMessage } from "../providers/types";
import type { TargetRecord, TargetUsageRecord } from "../targets/types";
import { workflowTestRepository } from "../testing/workflowRepository";
import { executeTrainingRun } from "../features/training/trainingExecution";
import type { Profile } from "../types";
import { assertTrainingLearningMessages, validateTrainingSessionTargetCode, validateTrainingTargetCodePolicy } from "./targetCode";

const config: ProviderConfig = { id: "p", provider: "openrouter", label: "P", credentialId: "c", enabled: true, createdAt: "now", updatedAt: "now" };
const model: ProviderModel = { providerConfigId: "p", provider: "openrouter", modelId: "m", displayName: "M", route: "openrouter:m", pricing: {}, recommended: false, rawMetadata: {}, refreshedAt: "now", capabilities: { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: false, confidence: "unknown" }, supportedParameters: [], maxOutputTokens: 65536, contextTokens: 131072, source: "provider", capturedAt: "now" } };
const targets: TargetRecord[] = ["first", "second"].map(id => ({ id, collection: "training", title: "Target", revealText: "A stone building", tags: [], sourceMetadata: { category: "mixed_targets" }, createdAt: "now", updatedAt: "now" }));
const profile: Profile = { id: "profile", name: "Viewer", credentialId: "c", createdAt: "now", updatedAt: "now" };
const policy = targetCodePolicy("without_code");
const settings = { maxRetries: 0, requestTimeoutMs: 30_000, sessionCodePrefix: "RVH" };
function storage(): Storage {
  const data = new Map<string, string>();
  return { get length() { return data.size; }, clear: () => data.clear(), key: i => [...data.keys()][i] ?? null, getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: k => { data.delete(k); } };
}
function setup(store = storage(), usage: TargetUsageRecord[] = []) {
  const sessions = new BrowserSessionsRepository({ storage: store, isResearchScoresFrozen: () => false });
  const training = new BrowserTrainingRepository({ storage: store });
  const repository = workflowTestRepository(Object.assign(sessions, {
    listTrainingRuns: training.listTrainingRuns.bind(training), createTrainingRun: training.createTrainingRun.bind(training), updateTrainingRun: training.updateTrainingRun.bind(training),
    listTargetUsage: async () => usage,
    recordTargetUsage: async (value: Omit<TargetUsageRecord, "id" | "usedAt">) => { usage.push({ ...value, id: `u${usage.length}`, usedAt: "now" }); },
    listFieldGuideVersions: async () => [], listViewerNoteReflectionRuns: async () => [], listTargetClarifications: async () => [],
  }) as unknown as AppRepository);
  return { repository, store, usage };
}
function blind(repository: AppRepository, language: "pl" | "en" = "en", variant: "core" | "extended" = "extended") {
  return { repository, workspaceId: "w", profileId: profile.id, providerConfig: config, model, protocol: getRvLite(language, variant), sessionLanguage: language, requestedSettings: { maxOutputTokens: 16384 }, operationKind: "training_blind_viewer" as const, maxRetries: 0 };
}
const response = (content: string) => ({ content, finishReason: "stop", usage: {} });

describe("RV Training target-code policy", () => {
  for (const language of ["en", "pl"] as const) for (const variant of ["core", "extended"] as const) for (const mode of ["with_code", "without_code"] as const) {
    it(`real RV Lite ${language}/${variant}/${mode}: durable snapshot and final blind messages`, async () => {
      const { repository } = setup(); const payloads: string[] = [];
      const result = await runAutomaticRvLiteSession({ ...blind(repository, language, variant), targetCodeMode: mode, chat: async ({ messages }) => { payloads.push(JSON.stringify(messages)); return response(`observation ${payloads.length}`); } });
      expect(result.state).toBe("AwaitingReveal"); expect(payloads).toHaveLength(4);
      expect(payloads.some(p => p.includes(result.sessionCode))).toBe(mode === "with_code");
      const snapshot = (await repository.getSessionSnapshot(result.sessionId))!;
      await validateTrainingSessionTargetCode(targetCodePolicy(mode), snapshot);
      expect(snapshot.sessionCode).toBe(result.sessionCode);
      await expect(validateTrainingSessionTargetCode(targetCodePolicy(mode === "with_code" ? "without_code" : "with_code"), snapshot)).rejects.toThrow("policy mismatch");
      await expect(validateTrainingSessionTargetCode(targetCodePolicy(mode), { ...snapshot, profileTargetCode: undefined })).rejects.toThrow("compatible frozen");
    });
  }
  it("rejects malformed policy, rendered prompts and conflicts, while allowing legacy", async () => {
    const { repository } = setup();
    const r = await runAutomaticRvLiteSession({ ...blind(repository), targetCodeMode: "without_code", chat: async () => response("observation") });
    const snapshot = (await repository.getSessionSnapshot(r.sessionId))!;
    await expect(validateTrainingSessionTargetCode(policy, { ...snapshot, profileTargetCode: { ...snapshot.profileTargetCode!, renderedPrompts: [] } })).rejects.toThrow("rendered prompts");
    await expect(validateTrainingSessionTargetCode(policy, { ...snapshot, researchTargetCode: { policy, renderedPrompts: [] } })).rejects.toThrow("compatible frozen");
    const changed = structuredClone(snapshot); changed.profileTargetCode!.renderedPrompts[0].sha256 = "changed";
    await expect(validateTrainingSessionTargetCode(policy, changed)).rejects.toThrow("prompt/hash");
    expect(() => validateTrainingTargetCodePolicy({ ...policy, templatesSha256: "changed" })).toThrow("hash mismatch");
    await validateTrainingSessionTargetCode(undefined, { ...snapshot, profileTargetCode: undefined });
    const legacy = { ...snapshot, profileTargetCode: undefined };
    for (const invalid of [undefined, null, { ...legacy, protocol: undefined }, { ...legacy, protocol: { ...legacy.protocol, id: "full-rcp" } },
      { ...legacy, researchTargetCode: { policy, renderedPrompts: [] } },
      { ...legacy, rcpProfileTargetCode: {} }, { ...legacy, telepathicProfileTargetCode: {} },
      { ...legacy, researchTargetCode: null }, { ...legacy, profileTargetCode: null }]) {
      await expect(validateTrainingSessionTargetCode(undefined, invalid as Parameters<typeof validateTrainingSessionTargetCode>[1])).rejects.toThrow("compatible frozen");
    }
  });
  for (const invalid of ["missing", "foreign-policy"] as const) it(`legacy post-Reveal checkpoint rejects ${invalid} before review`, async () => {
    const h = setup();
    const first = await runAutomaticRvLiteSession({ ...blind(h.repository), automaticTarget: targets[0], chat: async () => response("observation") });
    const run = await h.repository.createTrainingRun({ name: "Legacy series", status: "Interrupted", mode: "partial", profileId: profile.id, workspaceId: "w", modelRoute: model.route, protocolVariant: "extended", targetIds: [targets[0].id], categories: ["mixed_targets"], judgeModelRoutes: [], pauseAfterBlock: false, viewerNotesEnabled: false, executionSnapshot: { language: "en", generationSettings: {}, transport: settings } });
    await h.repository.updateTrainingRun(run.id, { activeTargetCheckpoint: { targetId: targets[0].id, sessionId: first.sessionId, stage: "session_revealed" } });
    const snapshot = (await h.repository.getSessionSnapshot(first.sessionId))!;
    h.repository.getSessionSnapshot = async () => invalid === "missing" ? null : { ...snapshot, researchTargetCode: { policy, renderedPrompts: [] } };
    let calls = 0;
    const result = await executeTrainingRun({ repository: h.repository, initial: run, profile, providerConfig: config, model, judges: [], targets, language: "en", settings, dependencies: { runAutomaticPostRevealReview: async () => { calls++; throw new Error("unexpected dispatch"); } } });
    expect(result.error).toContain("compatible frozen");
    expect(result.run.status).toBe("Interrupted");
    expect(calls).toBe(0);
  });
  it("initializes only a provably untouched row using the frozen without-code condition", async () => {
    const { repository } = setup();
    const session = await repository.createRvSession({ id: "initialized", workspaceId: "w", profileId: profile.id, sessionCode: "RVH-PRIVATE-INIT", runType: "automatic", targetId: targets[0].id });
    await repository.appendSessionEvent(session.id, { eventType: "SESSION_CREATED" });
    let calls = 0;
    const result = await runAutomaticRvLiteSession({ ...blind(repository), initializationExistingSession: session, automaticTarget: targets[0], targetCodeMode: "without_code", chat: async ({ messages }) => { calls++; expect(JSON.stringify(messages).includes(session.sessionCode)).toBe(false); return response(`observation ${calls}`); } });
    expect(result.state).toBe("Revealed"); expect(calls).toBe(4); expect(result.sessionId).toBe(session.id);
    await validateTrainingSessionTargetCode(policy, await repository.getSessionSnapshot(session.id));
  });
  it("rejects missing snapshot with evidence of prior dispatch", async () => {
    const { repository } = setup();
    const session = await repository.createRvSession({ id: "unsafe", workspaceId: "w", profileId: profile.id, sessionCode: "RVH-PRIVATE-UNSAFE", runType: "automatic", targetId: targets[0].id });
    await repository.appendSessionEvent(session.id, { eventType: "VIEWER_OUTPUT_ATTEMPT_STARTED" });
    let calls = 0;
    await expect(runAutomaticRvLiteSession({ ...blind(repository), initializationExistingSession: session, automaticTarget: targets[0], targetCodeMode: "without_code", chat: async () => { calls++; return response("unexpected"); } })).rejects.toThrow("never dispatched");
    expect(calls).toBe(0); expect(await repository.getSessionSnapshot(session.id)).toBe(null);
  });
  it("resumes a stopped Training blind session from durable replay without revealing its code", async () => {
    const h = setup(); const stop = new AbortController(); const payloads: string[] = [];
    const answer = ({ messages }: { messages: ProviderMessage[] }) => { payloads.push(JSON.stringify(messages)); return response(`observation ${payloads.length}`); };
    const first = await runAutomaticRvLiteSession({ ...blind(h.repository), automaticTarget: targets[0], targetCodeMode: "without_code", signal: stop.signal, chat: async request => { const value = answer(request); if (payloads.length === 2) stop.abort(); return value; } });
    expect(first.state).toBe("Interrupted");
    const reopened = setup(h.store, h.usage).repository;
    const session = (await reopened.getRvSession(first.sessionId))!, snapshot = (await reopened.getSessionSnapshot(first.sessionId))!;
    await validateTrainingSessionTargetCode(policy, snapshot);
    const replay = await createSessionReplay({ repository: reopened, session, events: await reopened.listSessionEvents(session.id), liveChat: async request => answer(request) });
    const result = await runAutomaticRvLiteSession({ ...blind(replay.repository), automaticTarget: targets[0], resumeSession: session, resumeContinuationRoute: snapshot.continuationRoute, chat: replay.chat });
    expect(result.state).toBe("Revealed"); expect(payloads).toHaveLength(4);
    expect(payloads.every(p => !p.includes(first.sessionCode))).toBe(true);
    await validateTrainingSessionTargetCode(policy, await reopened.getSessionSnapshot(session.id));
  });
  it("persists the series mode across Pause, repository reopen and a changed profile preference", async () => {
    const h = setup();
    const run = await h.repository.createTrainingRun({ name: "Series", status: "Running", mode: "partial", profileId: profile.id, workspaceId: "w", modelRoute: model.route, protocolVariant: "extended", targetIds: targets.map(t => t.id), categories: ["mixed_targets"], judgeModelRoutes: [], pauseAfterBlock: false, viewerNotesEnabled: false, executionSnapshot: { language: "en", generationSettings: { maxOutputTokens: 16384 }, transport: settings, targetCodePolicy: policy } });
    const payloads: string[] = [];
    const chat = async ({ messages }: { messages: ProviderMessage[] }) => { payloads.push(JSON.stringify(messages)); return response(`observation ${payloads.length}`); };
    const guide = { aiIdentityId: "identity", language: "en" as const, versionId: "v1", versionNumber: 1, content: "Guide", contentSha256: await sha256Text("Guide"), estimatedTokens: 10, estimatorVersion: "conservative-char-v1" as const, capacityTokens: 2048 as const, modelRoute: model.route, capturedAt: "now", sourceKind: "factory-baseline" as const };
    const dependencies = {
      prepareFieldGuideForSession: async () => guide,
      viewerSystemPromptSnapshotFromFieldGuide: async () => ({ id: "guide", version: "1", language: "en" as const, content: "Guide", contentSha256: guide.contentSha256, fieldGuide: guide }),
      prepareViewerNotesForSession: async () => ({ enabled: false, aiIdentityId: "identity", noteType: "viewer_self_notes" as const, content: "", contentSha256: await sha256Text(""), estimatedTokens: 0, estimatorVersion: "conservative-char-v1" as const, capacityTokens: 1024 as const, modelRoute: model.route, capturedAt: "now" }),
      runAutomaticRvLiteSession: (request: Parameters<typeof runAutomaticRvLiteSession>[0]) => runAutomaticRvLiteSession({ ...request, chat }),
      runAutomaticPostRevealReview: (request: Parameters<typeof runAutomaticPostRevealReview>[0]) => runAutomaticPostRevealReview({ ...request, chat }),
      runFieldGuideUpdate: async () => null,
      runViewerNoteReflection: async () => null,
    };
    const common = { providerConfig: config, model, judges: [], targets, language: "en" as const, settings, dependencies };
    const first = await executeTrainingRun({ ...common, repository: h.repository, initial: run, profile: { ...profile, targetCodeMode: "without_code" }, shouldPause: () => true });
    expect(first.error).toBe(undefined); expect(first.run.status).toBe("Paused"); expect(first.run.completedTargetIds).toEqual([targets[0].id]);
    const reopened = setup(h.store, h.usage).repository;
    const persisted = (await reopened.listTrainingRuns())[0];
    expect(persisted.executionSnapshot?.targetCodePolicy).toEqual(policy);
    const second = await executeTrainingRun({ ...common, repository: reopened, initial: persisted, profile: { ...profile, targetCodeMode: "with_code" } });
    expect(second.error).toBe(undefined); expect(second.run.status).toBe("Completed"); expect(second.run.completedTargetIds).toHaveLength(2);
    for (const id of second.run.sessionIds) {
      const snapshot = (await reopened.getSessionSnapshot(id))!;
      await validateTrainingSessionTargetCode(policy, snapshot);
      expect(payloads.every(p => !p.includes(snapshot.sessionCode))).toBe(true);
    }
    expect(payloads).toHaveLength(10); // four blind requests and one review per target
  });
  for (const kind of ["field_guide", "viewer_notes"] as const) {
    for (const repair of [false, true]) it(`${kind}: blocks code in ${repair ? "repair" : "initial"} messages before dispatch`, async () => {
      const { repository } = setup();
      const session = await runAutomaticRvLiteSession({ ...blind(repository), targetCodeMode: "without_code", chat: async () => response("observation") });
      const snapshot = (await repository.getSessionSnapshot(session.sessionId))!;
      let calls = 0;
      const messages: ProviderMessage[] = [{ role: "user", content: repair ? "Return JSON" : snapshot.sessionCode }];
      await expect(executeLearningProposal({ repository, sessionId: session.sessionId, packetHash: "test", kind, config, modelId: model.modelId,
        analytical: { model, operationKind: kind === "field_guide" ? "field_guide_update" : "viewer_notes_reflection", learningObjectCapacityTokens: 2048, budgetPolicy: "training_reveal" }, messages,
        assertMessages: payload => assertTrainingLearningMessages(snapshot, payload),
        chat: async () => { calls++; return { ...response("invalid JSON"), responseEvidence: { version: 1 as const, transportOutcome: "response_finished" as const, boundary: "body_read" as const } }; },
        parse: () => { throw new LearningProposalFailure("FAILED_PARSE", "invalid JSON", 0); },
        repairMessages: () => [{ role: "user", content: snapshot.sessionCode }],
      })).rejects.toThrow("refused an assigned session code");
      expect(calls).toBe(repair ? 1 : 0);
      const reservations = (await repository.listSessionEvents(session.sessionId)).filter(e => e.eventType === "LEARNING_PHYSICAL_ATTEMPT" && e.metadata?.state === "reserved");
      expect(reservations).toHaveLength(repair ? 1 : 0);
    });
  }
});

for (const mode of ["full", "partial"] as const) it.each(["policy", "marker", "version"])(`CODE-6B ${mode}: refuses %s loss before any Training stage`, async field => {
  const h = setup();
  const run = await h.repository.createTrainingRun({ name: "Frozen", status: "Interrupted", mode, profileId: profile.id, workspaceId: "w", modelRoute: model.route,
    protocolVariant: "extended", targetIds: [targets[0].id], categories: ["mixed_targets"], judgeModelRoutes: [], pauseAfterBlock: false, viewerNotesEnabled: false,
    executionSnapshot: { language: "en", generationSettings: {}, transport: settings, targetCodePolicy: policy } });
  const damaged = structuredClone(run);
  if (field === "policy") delete damaged.executionSnapshot!.targetCodePolicy;
  if (field === "marker") delete damaged.targetCodeContract;
  if (field === "version") delete damaged.targetCodeContractVersion;
  h.store.setItem("rvh.dev.training_runs", JSON.stringify([damaged]));
  const before = h.store.getItem("rvh.dev.training_runs"); let calls = 0;
  await expect(executeTrainingRun({ repository: setup(h.store).repository, initial: run, profile, providerConfig: config, model, judges: [], targets, language: "en", settings,
    dependencies: { runAutomaticRvLiteSession: async () => { calls++; throw new Error("unexpected dispatch"); },
      runAutomaticPostRevealReview: async () => { calls++; throw new Error("unexpected dispatch"); } } })).rejects.toThrow(/contract/);
  expect(calls).toBe(0); expect(h.store.getItem("rvh.dev.training_runs")).toBe(before);
});
