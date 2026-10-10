import { aggregateJudgeScores } from "../domain/scoring";
import { runBlindJudging, selectMissingJudgeSelections, type JudgeSelection } from "../judge/engine";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import { resolveGenerationSettings } from "../providers/capabilities";
import { runAutomaticRcpSession, type AutomaticRcpRunInput, type AutomaticRcpRunResult, type SessionProgress } from "../sessions/controller";
import { runAutomaticRvLiteSession, type AutomaticRvLiteRunInput } from "../sessions/rvLiteController";
import { createSessionReplay, type SessionReplay } from "../sessions/resumeReplay";
import type { AppRepository } from "../storage/repository";
import { createId } from "../storage/repository";
import { buildResearchLockPlan, stableStringify } from "./planner";
import { runResearchPreflight, type ResearchPreflightInventory } from "./preflight";
import { computeConditionStatistics, computePairwiseStatistics } from "./statistics";
import type { ResearchConfig, ResearchPreflightResult, ResearchProjectRecord, ResearchResults, UnblindedSessionResult, ResearchViewerOutputPolicy } from "./types";
import { aiIsBeDisplayName, humanIsBeDisplayName } from "../domain/isBeIdentity";
import { modelRouteKey } from "../modelRoutes";
import { viewerNotesSnapshotSignature } from "./viewerNotesPolicy";
import { fieldGuideSnapshotSignature } from "./fieldGuidePolicy";
import { resolveResearchProtocol } from "./protocolPolicy";
import { buildAutomaticTargetReveal } from "../targets/service";
import { VIEWER_OUTPUT_INITIAL_TOKENS, VIEWER_OUTPUT_RECOVERY_TOKENS } from "../sessions/viewerOutputRecovery";

type ResearchRepository = AppRepository;

export async function createAndLockResearch(
  repository: ResearchRepository,
  config: ResearchConfig,
  inventory: ResearchPreflightInventory,
): Promise<{ project: ResearchProjectRecord; preflight: ResearchPreflightResult }> {
  const lockedConfig = freezeResearchViewerOutputPolicy(config);
  const preflight = runResearchPreflight(lockedConfig, inventory);
  if (!preflight.ok) throw new Error("Research Preflight contains blocking failures.");
  const project = await repository.createResearchProject(lockedConfig);
  await repository.setResearchProjectState(project.id, "Preflight");
  const plan = await buildResearchLockPlan(project.id, lockedConfig);
  await repository.lockResearchProject(project.id, plan);
  const locked = await repository.getResearchProject(project.id);
  if (!locked || locked.state !== "Locked") throw new Error("Experiment Lock did not persist correctly.");
  return { project: locked, preflight };
}

export function freezeResearchViewerOutputPolicy(config: ResearchConfig): ResearchConfig {
  return {
    ...config,
    conditions: config.conditions.map((condition) => {
      if (condition.viewerOutputPolicy) return condition;
      const configured = Math.max(1, Math.floor(condition.requestedSettings.maxOutputTokens ?? config.viewerControl?.maxOutputTokens ?? VIEWER_OUTPUT_INITIAL_TOKENS));
      const recovery = Math.max(configured, VIEWER_OUTPUT_RECOVERY_TOKENS);
      const policy: ResearchViewerOutputPolicy = { version: 1, initialTokens: configured, recoveryTokens: recovery, preserveConfiguredBudget: false };
      return { ...condition, viewerOutputPolicy: policy };
    }),
  };
}

function newResearchSessionIdentity(project: ResearchProjectRecord, assignment: { anonymousSessionId: string }): { id: string; sessionCode: string } {
  const id = createId("session_research");
  const compact = id.replace(/[^A-Za-z0-9]/g, "").slice(-10).toUpperCase() || assignment.anonymousSessionId.replace(/[^A-Za-z0-9]/g, "").slice(-10).toUpperCase();
  const prefix = project.config.sessionPolicy?.sessionCodePrefix?.trim() || "RES";
  return { id, sessionCode: `${prefix}-${compact}` };
}

export async function executeResearchSessions(input: {
  repository: ResearchRepository;
  projectId: string;
  signal?: AbortSignal;
  sessionRunner?: (input: AutomaticRcpRunInput) => Promise<AutomaticRcpRunResult>;
  rvLiteSessionRunner?: (input: AutomaticRvLiteRunInput) => ReturnType<typeof runAutomaticRvLiteSession>;
  sessionReplayFactory?: typeof createSessionReplay;
  onProgress?: (progress: { completed: number; total: number; anonymousSessionId: string; session?: SessionProgress }) => void;
}): Promise<void> {
  const project = await requireProject(input.repository, input.projectId);
  if (!["Locked", "Running", "Interrupted"].includes(project.state)) throw new Error(`Research sessions cannot run from state ${project.state}.`);
  let protocol;
  try {
    protocol = resolveResearchProtocol(project.config.protocol, project.config.sessionLanguage);
  } catch (cause) {
    await input.repository.setResearchProjectState(project.id, "Interrupted");
    throw cause;
  }
  const [assignments, mappings, conditions, targets, providers, models, profiles] = await Promise.all([
    input.repository.listResearchAssignments(project.id),
    input.repository.listBlindingMappings(project.id),
    input.repository.listResearchConditions(project.id),
    input.repository.listTargets(),
    input.repository.listProviderConfigs(),
    input.repository.listProviderModels(),
    typeof input.repository.listProfiles === "function" ? input.repository.listProfiles() : Promise.resolve([]),
  ]);
  const mappingByAnonymous = new Map(mappings.map((mapping) => [mapping.anonymousSessionId, mapping]));
  const conditionById = new Map(conditions.map((condition) => [condition.id, condition]));
  const lockedConditionByKey = new Map(project.config.conditions.map((condition) => [condition.key, condition]));
  if (conditions.length !== project.config.conditions.length) {
    await input.repository.setResearchProjectState(project.id, "Interrupted");
    throw new Error("Locked Research condition set is incomplete; Research stopped before Resume could continue.");
  }
  for (const stored of conditions) {
    const locked = lockedConditionByKey.get(stored.conditionKey);
    if (!locked || viewerNotesSnapshotSignature(stored.config.viewerNotes) !== viewerNotesSnapshotSignature(locked.viewerNotes)) {
      await input.repository.setResearchProjectState(project.id, "Interrupted");
      throw new Error("Viewer Notes snapshot drift detected after Experiment Lock; Research stopped instead of loading current notes.");
    }
    if (fieldGuideSnapshotSignature(stored.config.fieldGuide) !== fieldGuideSnapshotSignature(locked.fieldGuide)) {
      await input.repository.setResearchProjectState(project.id, "Interrupted");
      throw new Error("Field Guide snapshot drift detected inside the frozen Research records; Research stopped instead of loading the active guide.");
    }
    if (stableStringify(stored.config.systemPrompt ?? null) !== stableStringify(locked.systemPrompt ?? null)) {
      await input.repository.setResearchProjectState(project.id, "Interrupted");
      throw new Error("Frozen Viewer prompt composition drift detected after Experiment Lock.");
    }
    if (stableStringify(stored.config.viewerOutputPolicy ?? null) !== stableStringify(locked.viewerOutputPolicy ?? null)) {
      await input.repository.setResearchProjectState(project.id, "Interrupted");
      throw new Error("Frozen Viewer output policy drift detected after Experiment Lock.");
    }
  }
  const targetById = new Map(targets.map((target) => [target.id, target]));
  const providerById = new Map(providers.map((provider) => [provider.id, provider]));
  const modelByKey = new Map(models.map((model) => [modelRouteKey(model.providerConfigId, model.modelId), model]));
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  let completed = assignments.filter((assignment) => assignment.status === "SessionComplete" || assignment.status === "Judged").length;
  await input.repository.setResearchProjectState(project.id, "Running");

  for (const assignment of assignments.sort((a, b) => a.executionOrder - b.executionOrder)) {
    if (assignment.status === "SessionComplete" || assignment.status === "Judged") continue;
    if (input.signal?.aborted) {
      await input.repository.setResearchProjectState(project.id, "Interrupted");
      return;
    }
    const mapping = mappingByAnonymous.get(assignment.anonymousSessionId);
    const conditionRecord = mapping ? conditionById.get(mapping.conditionId) : undefined;
    const condition = conditionRecord?.config;
    const target = targetById.get(assignment.targetId);
    if (!mapping || !condition || !target) throw new Error("Locked Research plan is incomplete.");
    const provider = providerById.get(condition.providerConfigId);
    const model = modelByKey.get(modelRouteKey(condition.providerConfigId, condition.modelId));
    const sessionProfile = profileById.get(condition.profileId);
    if (!provider || !model) throw new Error("A locked Viewer route is no longer present in the current model registry.");
    if (!condition.capabilitySnapshot || capabilityMethodSignature(condition.capabilitySnapshot) !== capabilityMethodSignature(model.capabilities)) {
      await input.repository.setResearchProjectState(project.id, "Interrupted");
      throw new Error("Provider capability metadata changed since Experiment Lock; Research stopped instead of assuming the condition is unchanged.");
    }
    const currentEffective = resolveGenerationSettings(model.capabilities, condition.requestedSettings);
    if (!condition.effectiveSettings || stableStringify(currentEffective) !== stableStringify(condition.effectiveSettings)) {
      await input.repository.setResearchProjectState(project.id, "Interrupted");
      throw new Error("Requested/effective settings no longer match Experiment Lock.");
    }
    let linkedSessionId: string | undefined = assignment.sessionId;
    const onSessionCreated = async (sessionId: string) => {
      linkedSessionId = sessionId;
      await input.repository.updateResearchAssignment(assignment.id, sessionId, "Running");
    };
    const onProgress = (session: SessionProgress) => input.onProgress?.({ completed, total: assignments.length, anonymousSessionId: assignment.anonymousSessionId, session });

    let runRepository = input.repository;
    let runChat: SessionReplay["chat"] | undefined;
    let resumeSession: Awaited<ReturnType<ResearchRepository["getRvSession"]>> | undefined;
    let resumeContinuationRoute;
    let sessionLanguage = project.config.sessionLanguage;
    let requestedSettings = condition.requestedSettings;
    let rvSystemPrompt = condition.systemPrompt;
    let researchConditionInstruction = condition.conditionInstruction;
    let viewerNotes = condition.viewerNotes;
    let capturedAutomaticReveal;
    let sessionIdentity: { id: string; sessionCode: string } | undefined;
    let initializationExistingSession: Awaited<ReturnType<ResearchRepository["getRvSession"]>> | undefined;

    if (!assignment.sessionId || assignment.status === "RestartApproved") {
      sessionIdentity = newResearchSessionIdentity(project, assignment);
      const initialized = await input.repository.initializeResearchSession(assignment.id, {
        id: sessionIdentity.id,
        workspaceId: project.workspaceId,
        profileId: condition.profileId,
        sessionCode: sessionIdentity.sessionCode,
        runType: "automatic",
        targetId: target.id,
        researchProjectId: project.id,
      });
      linkedSessionId = initialized.id;
      initializationExistingSession = initialized;
    }

    if (assignment.sessionId) {
      const [session, snapshot] = await Promise.all([
        input.repository.getRvSession(assignment.sessionId),
        input.repository.getSessionSnapshot(assignment.sessionId),
      ]);
      if (!session && snapshot) {
        await input.repository.setResearchProjectState(project.id, "Interrupted");
        throw new Error(`Research Resume cannot recover ${assignment.anonymousSessionId}: Session Snapshot exists without its RV session row.`);
      }
      if (!snapshot && (assignment.status === "ResumeApproved" || assignment.status === "Initializing")) {
        if (!session) {
          await input.repository.setResearchProjectState(project.id, "Interrupted");
          throw new Error(`Research initialization ${assignment.anonymousSessionId} lost its RV session row.`);
        }
        initializationExistingSession = session;
        sessionIdentity = { id: session.id, sessionCode: session.sessionCode };
      } else if (!session || !snapshot) {
        await input.repository.setResearchProjectState(project.id, "Interrupted");
        throw new Error(`Research Resume cannot recover ${assignment.anonymousSessionId} because its durable initialization is incomplete.`);
      }
      if (snapshot) validateResearchResumeSnapshot({ project, assignment, condition, provider, model, protocol, session: session!, snapshot });
      if (snapshot && session!.state === "Revealed") {
        await ensurePersistedResearchReveal({ repository: input.repository, projectId: project.id, sessionId: session.id, targetId: target.id, profileId: condition.profileId });
        await input.repository.updateResearchAssignment(assignment.id, session.id, "SessionComplete");
        completed += 1;
        input.onProgress?.({ completed, total: assignments.length, anonymousSessionId: assignment.anonymousSessionId });
        continue;
      }
      if (snapshot && assignment.status === "Initializing") {
        await input.repository.updateResearchAssignment(assignment.id, session!.id, "Running");
      } else if (snapshot && assignment.status !== "ResumeApproved") {
        await input.repository.setResearchProjectState(project.id, "Interrupted");
        throw new Error(`Incomplete paid session ${assignment.anonymousSessionId} requires explicit Resume approval; it will not be rerun or restarted silently.`);
      }
      if (snapshot) {
      const events = await input.repository.listSessionEvents(session!.id);
      const replay = await (input.sessionReplayFactory ?? createSessionReplay)({ repository: input.repository, session: session!, events });
      runRepository = replay.repository;
      runChat = replay.chat;
      resumeSession = session;
      resumeContinuationRoute = snapshot.continuationRoute;
      sessionLanguage = snapshot.sessionLanguage;
      requestedSettings = snapshot.generationSettings.requested;
      rvSystemPrompt = snapshot.rvSystemPrompt ? {
        id: snapshot.rvSystemPrompt.id,
        version: snapshot.rvSystemPrompt.version,
        content: snapshot.rvSystemPrompt.fullContent,
        contentSha256: snapshot.rvSystemPrompt.contentSha256,
        ...(snapshot.rvSystemPrompt.fieldGuide ? { fieldGuide: snapshot.rvSystemPrompt.fieldGuide } : {}),
      } : undefined;
      researchConditionInstruction = snapshot.researchConditionInstruction ? {
        id: snapshot.researchConditionInstruction.id,
        version: snapshot.researchConditionInstruction.version,
        content: snapshot.researchConditionInstruction.fullContent,
        contentSha256: snapshot.researchConditionInstruction.contentSha256,
      } : undefined;
      viewerNotes = snapshot.viewerNotes;
      capturedAutomaticReveal = await buildAutomaticTargetReveal(target, snapshot.sessionLanguage);
      if (snapshot.automaticRevealHash && capturedAutomaticReveal.hash !== snapshot.automaticRevealHash) {
        await input.repository.setResearchProjectState(project.id, "Interrupted");
        throw new Error("Research Resume refused target/reveal drift from the frozen Session Snapshot.");
      }
      }
    }

    const common = {
      repository: runRepository,
      workspaceId: project.workspaceId,
      profileId: condition.profileId,
      providerConfig: provider,
      model,
      sessionLanguage,
      requestedSettings,
      ...(condition.viewerOutputPolicy ? { viewerOutputPolicy: condition.viewerOutputPolicy } : {}),
      maxRetries: project.config.sessionPolicy?.maxRetries,
      requestTimeoutMs: project.config.sessionPolicy?.requestTimeoutMs,
      operationKind: "research_viewer" as const,
      streamWorkflowContext: "research" as const,
      sessionCodePrefix: project.config.sessionPolicy?.sessionCodePrefix,
      automaticTarget: target,
      researchProjectId: project.id,
      ...(capturedAutomaticReveal ? { capturedAutomaticReveal } : {}),
      ...(rvSystemPrompt ? { rvSystemPrompt } : {}),
      ...(researchConditionInstruction ? { researchConditionInstruction } : {}),
      ...(viewerNotes ? { viewerNotes } : {}),
      ...(resumeSession ? { resumeSession, ...(resumeContinuationRoute ? { resumeContinuationRoute } : {}) } : {}),
      ...(!resumeSession && sessionIdentity ? { sessionIdentity } : {}),
      ...(initializationExistingSession ? { initializationExistingSession } : {}),
      ...(runChat ? { chat: runChat } : {}),
      signal: input.signal,
      onSessionCreated,
      onProgress,
    };
    const result = protocol.id === "full-rcp"
      ? await (input.sessionRunner ?? runAutomaticRcpSession)({
          ...common,
          aiIsBeDisplayName: sessionProfile ? aiIsBeDisplayName(sessionProfile) : "AI IS-BE",
          humanIsBeDisplayName: sessionProfile ? humanIsBeDisplayName(sessionProfile) : "Human IS-BE",
          protocol,
        })
      : await (input.rvLiteSessionRunner ?? runAutomaticRvLiteSession)({
          ...common,
          profileName: sessionProfile ? aiIsBeDisplayName(sessionProfile) : "AI IS-BE",
          humanIsBeDisplayName: sessionProfile ? humanIsBeDisplayName(sessionProfile) : "Human IS-BE",
          protocol,
        });
    if (result.state !== "Revealed") {
      await input.repository.updateResearchAssignment(assignment.id, linkedSessionId ?? result.sessionId, "Interrupted");
      await input.repository.setResearchProjectState(project.id, "Interrupted");
      return;
    }
    if (resumeSession) {
      await ensurePersistedResearchReveal({ repository: input.repository, projectId: project.id, sessionId: result.sessionId, targetId: target.id, profileId: condition.profileId });
    }
    await input.repository.updateResearchAssignment(assignment.id, result.sessionId, "SessionComplete");
    completed += 1;
    input.onProgress?.({ completed, total: assignments.length, anonymousSessionId: assignment.anonymousSessionId });
  }
  await input.repository.setResearchProjectState(project.id, "SessionsComplete");
}

export async function prepareInterruptedResearchRetry(repository: ResearchRepository, projectId: string): Promise<number> {
  const project = await requireProject(repository, projectId);
  if (!["Interrupted", "Running"].includes(project.state)) throw new Error("Explicit Research Resume approval is available only for an interrupted/running project with a preserved partial session.");
  const assignments = await repository.listResearchAssignments(projectId);
  const recoverable = assignments.filter((assignment) => assignment.sessionId && !["SessionComplete", "Judged", "ResumeApproved"].includes(assignment.status));
  for (const assignment of recoverable) {
    const sessionId = assignment.sessionId!;
    const session = await repository.getRvSession(sessionId);
    if (!session && assignment.status !== "Initializing") throw new Error(`Research Resume cannot approve missing session ${sessionId}.`);
    if (session && session.state !== "Revealed") {
      await repository.updateRvSessionState(sessionId, "Interrupted", "RECOVERY: partial Research session preserved; Resume of the same locked assignment/session approved by user");
    }
    await repository.updateResearchAssignment(assignment.id, sessionId, "ResumeApproved");
  }
  if (recoverable.length) await repository.setResearchProjectState(projectId, "Interrupted");
  return recoverable.length;
}

/** Explicitly abandons a partial session and permits a new attempt for the same locked assignment. */
export async function prepareInterruptedResearchRestart(repository: ResearchRepository, projectId: string, assignmentId: string): Promise<void> {
  const project = await requireProject(repository, projectId);
  if (!["Interrupted", "Running"].includes(project.state)) throw new Error("Research restart is available only for an interrupted/running project.");
  const assignment = (await repository.listResearchAssignments(projectId)).find((item) => item.id === assignmentId);
  if (!assignment?.sessionId || ["SessionComplete", "Judged"].includes(assignment.status)) throw new Error("Research restart requires a preserved incomplete session.");
  await repository.updateRvSessionState(assignment.sessionId, "Interrupted", "RESTART: preserved partial Research session abandoned by explicit user decision; new attempt may use the same locked assignment");
  await repository.updateResearchAssignment(assignment.id, undefined, "RestartApproved");
  await repository.setResearchProjectState(projectId, "Interrupted");
}

function validateResearchResumeSnapshot(input: {
  project: ResearchProjectRecord;
  assignment: Awaited<ReturnType<ResearchRepository["listResearchAssignments"]>>[number];
  condition: ResearchConfig["conditions"][number];
  provider: ProviderConfig;
  model: ProviderModel;
  protocol: ReturnType<typeof resolveResearchProtocol>;
  session: NonNullable<Awaited<ReturnType<ResearchRepository["getRvSession"]>>>;
  snapshot: NonNullable<Awaited<ReturnType<ResearchRepository["getSessionSnapshot"]>>>;
}): void {
  const { project, assignment, condition, provider, model, protocol, session, snapshot } = input;
  if (session.id !== assignment.sessionId || session.targetId !== assignment.targetId || session.researchProjectId !== project.id) {
    throw new Error("Research Resume refused a session whose assignment/target/project identity does not match.");
  }
  if (snapshot.sessionId !== session.id || snapshot.targetId !== assignment.targetId || snapshot.researchProjectId !== project.id) {
    throw new Error("Research Resume refused a Session Snapshot whose assignment/target/project identity does not match.");
  }
  if (snapshot.workspaceId !== project.workspaceId || snapshot.profileId !== condition.profileId) {
    throw new Error("Research Resume refused Workspace/Profile drift from the frozen Session Snapshot.");
  }
  if (snapshot.providerConfigId !== provider.id || snapshot.provider !== provider.provider || snapshot.modelId !== model.modelId || snapshot.modelRoute !== model.route) {
    throw new Error("Research Resume refused provider/model route drift from the frozen Session Snapshot.");
  }
  if (snapshot.protocol.id !== protocol.id || snapshot.protocol.version !== protocol.version || snapshot.protocol.contentSha256 !== protocol.contentSha256 || snapshot.protocol.language !== protocol.language) {
    throw new Error("Research Resume cannot reproduce the exact frozen protocol from this application build.");
  }
  if (stableStringify(snapshot.generationSettings.requested) !== stableStringify(condition.requestedSettings)
      || stableStringify(snapshot.generationSettings.effective) !== stableStringify(condition.effectiveSettings?.effective ?? {})) {
    throw new Error("Research Resume refused generation-setting drift from the locked condition.");
  }
  if (condition.viewerOutputPolicy) {
    if (!snapshot.viewerOutputPolicy || stableStringify(snapshot.viewerOutputPolicy) !== stableStringify(condition.viewerOutputPolicy)) {
      throw new Error("Research Resume refused Viewer output-policy drift from Experiment Lock.");
    }
  } else if (snapshot.viewerOutputPolicy && snapshot.viewerOutputPolicy.preserveConfiguredBudget === false) {
    throw new Error("Legacy Research Resume refused an output policy that was not part of its Experiment Lock.");
  }
  if (viewerNotesSnapshotSignature(snapshot.viewerNotes) !== viewerNotesSnapshotSignature(condition.viewerNotes)) {
    throw new Error("Research Resume refused Viewer Notes drift from the locked condition.");
  }
  const promptHash = snapshot.rvSystemPrompt?.contentSha256;
  if ((condition.systemPrompt?.contentSha256 ?? undefined) !== promptHash) throw new Error("Research Resume refused Viewer prompt drift from the locked condition.");
  const instructionHash = snapshot.researchConditionInstruction?.contentSha256;
  if ((condition.conditionInstruction?.contentSha256 ?? undefined) !== instructionHash) throw new Error("Research Resume refused condition-instruction drift from the locked condition.");
}

async function ensurePersistedResearchReveal(input: {
  repository: ResearchRepository;
  projectId: string;
  sessionId: string;
  targetId: string;
  profileId: string;
}): Promise<void> {
  const session = await input.repository.getRvSession(input.sessionId);
  if (!session || session.state !== "Revealed" || !session.preRevealSealedAt) throw new Error("Research cannot complete an assignment before the session is durably sealed and Revealed.");
  const reveal = await input.repository.getReveal(input.sessionId);
  if (!reveal) throw new Error("Research cannot complete an assignment because its durable Reveal record is missing.");
  let events = await input.repository.listSessionEvents(input.sessionId);
  if (!events.some((event) => event.eventType === "REVEAL_ACCEPTED" && (event.metadata?.targetId === input.targetId || event.metadata?.source === "automatic_target"))) {
    await input.repository.appendSessionEvent(input.sessionId, { eventType: "REVEAL_ACCEPTED", role: "controller", metadata: { source: "automatic_target", targetId: input.targetId, recoveredFinalization: true } });
    events = await input.repository.listSessionEvents(input.sessionId);
  }
  let usage = await input.repository.listTargetUsage();
  if (!usage.some((record) => record.sessionId === input.sessionId && record.targetId === input.targetId)) {
    await input.repository.recordTargetUsage({ targetId: input.targetId, profileId: input.profileId, researchProjectId: input.projectId, sessionId: input.sessionId });
    usage = await input.repository.listTargetUsage();
  }
  if (!events.some((event) => event.eventType === "REVEAL_ACCEPTED" && (event.metadata?.targetId === input.targetId || event.metadata?.source === "automatic_target"))) throw new Error("Research Reveal finalization did not persist REVEAL_ACCEPTED.");
  if (!usage.some((record) => record.sessionId === input.sessionId && record.targetId === input.targetId)) throw new Error("Research Reveal finalization did not persist target usage.");
}

export async function judgeResearch(input: {
  repository: ResearchRepository;
  projectId: string;
  signal?: AbortSignal;
  onProgress?: (progress: { completed: number; total: number; anonymousSessionId: string }) => void;
}): Promise<void> {
  const project = await requireProject(input.repository, input.projectId);
  if (!["SessionsComplete", "Judging"].includes(project.state)) throw new Error(`Research judging cannot run from state ${project.state}.`);
  if (project.config.judges.length === 0) throw new Error("This Research project is configured for Save only / external evaluation.");
  const [assignments, providers, models] = await Promise.all([
    input.repository.listResearchAssignments(project.id),
    input.repository.listProviderConfigs(),
    input.repository.listProviderModels(),
  ]);
  const judgeSelections = resolveJudgeSelections(project.config, providers, models);
  await input.repository.setResearchProjectState(project.id, "Judging");
  let completed = assignments.filter((assignment) => assignment.status === "Judged").length;

  // Deliberately do not read Blinding Mappings or Research Conditions in this function.
  for (const assignment of assignments.sort((a, b) => a.judgeOrder - b.judgeOrder)) {
    if (!assignment.sessionId) throw new Error("A Research assignment has no completed session.");
    const existing = await input.repository.listJudgeScores(assignment.sessionId);
    const missingJudges = selectMissingJudgeSelections(existing, judgeSelections);
    if (!missingJudges.length) {
      if (assignment.status !== "Judged") await input.repository.updateResearchAssignment(assignment.id, assignment.sessionId, "Judged");
      completed += assignment.status === "Judged" ? 0 : 1;
      continue;
    }
    await runBlindJudging({
      repository: input.repository,
      sessionId: assignment.sessionId,
      language: project.config.sessionLanguage,
      judges: missingJudges,
      anonymousSessionId: assignment.anonymousSessionId,
      maxRetries: project.config.sessionPolicy?.maxRetries,
      timeoutMs: project.config.sessionPolicy?.requestTimeoutMs,
      signal: input.signal,
      streamWorkflowContext: "research",
    });
    const frozen = await input.repository.listJudgeScores(assignment.sessionId);
    if (frozen.length !== judgeSelections.length || frozen.some((score) => !score.frozenAt)) throw new Error("Judge score freeze verification failed.");
    await input.repository.updateResearchAssignment(assignment.id, assignment.sessionId, "Judged");
    completed += 1;
    input.onProgress?.({ completed, total: assignments.length, anonymousSessionId: assignment.anonymousSessionId });
  }
  await verifyAllResearchScoresFrozen(input.repository, project.id, project.config.judges.length);
  await input.repository.setResearchProjectState(project.id, "ScoresFrozen");
}

export async function unblindAndComputeResearch(repository: ResearchRepository, projectId: string): Promise<ResearchResults> {
  let project = await requireProject(repository, projectId);
  const existingResults = await repository.getResearchResults(projectId);
  if (project.state === "Complete" && existingResults) return existingResults;
  if (project.state === "Unblinded" && existingResults) {
    await repository.setResearchProjectState(projectId, "Complete");
    return existingResults;
  }
  if (project.state !== "ScoresFrozen" && project.state !== "Unblinded") {
    throw new Error("Blinding Key cannot be used until every Judge score is frozen.");
  }
  await verifyAllResearchScoresFrozen(repository, projectId, project.config.judges.length);

  // This is the explicit evidence boundary: state is marked Unblinded before the key is read.
  // If computation or persistence fails after this point, a later call may safely resume from
  // Unblinded because the key has already been exposed and every frozen score is re-verified.
  if (project.state === "ScoresFrozen") {
    await repository.setResearchProjectState(projectId, "Unblinded");
    project = await requireProject(repository, projectId);
  }
  const [assignments, mappings, conditions] = await Promise.all([
    repository.listResearchAssignments(projectId),
    repository.listBlindingMappings(projectId),
    repository.listResearchConditions(projectId),
  ]);
  const mappingByAnonymous = new Map(mappings.map((mapping) => [mapping.anonymousSessionId, mapping]));
  const conditionById = new Map(conditions.map((condition) => [condition.id, condition]));
  const sessions: UnblindedSessionResult[] = [];
  for (const assignment of assignments) {
    if (!assignment.sessionId) throw new Error("Cannot compute results for an assignment without a session.");
    const mapping = mappingByAnonymous.get(assignment.anonymousSessionId);
    const condition = mapping ? conditionById.get(mapping.conditionId) : undefined;
    if (!mapping || !condition) throw new Error("Blinding Key is incomplete.");
    const scores = await repository.listJudgeScores(assignment.sessionId);
    const aggregate = aggregateJudgeScores(scores);
    sessions.push({
      anonymousSessionId: assignment.anonymousSessionId,
      sessionId: assignment.sessionId,
      targetId: assignment.targetId,
      pairKey: mapping.pairKey,
      conditionKey: condition.conditionKey,
      conditionLabel: condition.config.label,
      gestalt: aggregate.mean.gestalt,
      verifiableFeatures: aggregate.mean.verifiableFeatures,
      activityFunctionEvent: aggregate.mean.activityFunctionEvent,
      confabulationControl: aggregate.mean.confabulationControl,
      total: aggregate.mean.total,
      judgeCount: aggregate.judgeCount,
      judgeTotalRange: aggregate.totalRange,
      judgeTotalStdDev: aggregate.totalStdDev,
      ...(condition.config.fieldGuide ? {
        fieldGuideVersionId: condition.config.fieldGuide.versionId,
        fieldGuideVersionNumber: condition.config.fieldGuide.versionNumber,
        fieldGuideContentSha256: condition.config.fieldGuide.contentSha256,
      } : {}),
    });
  }
  const results: ResearchResults = {
    schemaVersion: 1,
    projectId,
    templateType: project.templateType,
    sessions,
    conditions: computeConditionStatistics(sessions),
    pairwise: computePairwiseStatistics(sessions),
    computedAt: new Date().toISOString(),
  };
  await repository.saveResearchResults(projectId, results, await sha256Text(stableStringify(results)));
  await repository.setResearchProjectState(projectId, "Complete");
  return results;
}

async function requireProject(repository: ResearchRepository, projectId: string): Promise<ResearchProjectRecord> {
  const project = await repository.getResearchProject(projectId);
  if (!project) throw new Error("Research project not found.");
  return project;
}

function resolveJudgeSelections(config: ResearchConfig, providers: ProviderConfig[], models: ProviderModel[]): JudgeSelection[] {
  return config.judges.map((judge) => {
    const providerConfig = providers.find((provider) => provider.id === judge.providerConfigId);
    const model = models.find((item) => item.providerConfigId === judge.providerConfigId && item.modelId === judge.modelId);
    if (!providerConfig || !model) throw new Error("A locked Judge route is no longer available.");
    return { providerConfig, model };
  });
}

async function verifyAllResearchScoresFrozen(repository: ResearchRepository, projectId: string, judgeCount: number): Promise<void> {
  const assignments = await repository.listResearchAssignments(projectId);
  for (const assignment of assignments) {
    if (!assignment.sessionId) throw new Error("Research has an assignment without a completed session.");
    const scores = await repository.listJudgeScores(assignment.sessionId);
    if (scores.length !== judgeCount || scores.some((score) => !score.frozenAt)) throw new Error("Not all locked Judge scores are frozen.");
  }
}

async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function capabilityMethodSignature(capabilities: ProviderModel["capabilities"]): string {
  return stableStringify({
    contextTokens: capabilities.contextTokens,
    maxOutputTokens: capabilities.maxOutputTokens,
    inputModalities: capabilities.inputModalities,
    outputModalities: capabilities.outputModalities,
    reasoning: capabilities.reasoning,
    temperature: capabilities.temperature,
    supportedParameters: capabilities.supportedParameters,
    source: capabilities.source,
  });
}
