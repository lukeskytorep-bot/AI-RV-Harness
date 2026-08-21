import { aggregateJudgeScores } from "../domain/scoring";
import { runBlindJudging, type JudgeSelection } from "../judge/engine";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import { resolveGenerationSettings } from "../providers/capabilities";
import { getFullRcp } from "../resources/protocolRegistry";
import { runAutomaticRcpSession, type AutomaticRcpRunInput, type AutomaticRcpRunResult, type SessionProgress } from "../sessions/controller";
import { runAutomaticPostRevealReview } from "../sessions/postReveal";
import type { AppRepository } from "../storage/repository";
import { buildResearchLockPlan, stableStringify } from "./planner";
import { runResearchPreflight, type ResearchPreflightInventory } from "./preflight";
import { computeConditionStatistics, computePairwiseStatistics } from "./statistics";
import type { ResearchConfig, ResearchPreflightResult, ResearchProjectRecord, ResearchResults, UnblindedSessionResult } from "./types";
import { aiIsBeDisplayName, humanIsBeDisplayName } from "../domain/isBeIdentity";

type ResearchRepository = AppRepository;

export async function createAndLockResearch(
  repository: ResearchRepository,
  config: ResearchConfig,
  inventory: ResearchPreflightInventory,
): Promise<{ project: ResearchProjectRecord; preflight: ResearchPreflightResult }> {
  const preflight = runResearchPreflight(config, inventory);
  if (!preflight.ok) throw new Error("Research Preflight contains blocking failures.");
  const project = await repository.createResearchProject(config);
  await repository.setResearchProjectState(project.id, "Preflight");
  const plan = await buildResearchLockPlan(project.id, config);
  await repository.lockResearchProject(project.id, plan);
  const locked = await repository.getResearchProject(project.id);
  if (!locked || locked.state !== "Locked") throw new Error("Experiment Lock did not persist correctly.");
  return { project: locked, preflight };
}

export async function executeResearchSessions(input: {
  repository: ResearchRepository;
  projectId: string;
  signal?: AbortSignal;
  sessionRunner?: (input: AutomaticRcpRunInput) => Promise<AutomaticRcpRunResult>;
  onProgress?: (progress: { completed: number; total: number; anonymousSessionId: string; session?: SessionProgress }) => void;
}): Promise<void> {
  const project = await requireProject(input.repository, input.projectId);
  if (!["Locked", "Running", "Interrupted"].includes(project.state)) throw new Error(`Research sessions cannot run from state ${project.state}.`);
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
  const targetById = new Map(targets.map((target) => [target.id, target]));
  const providerById = new Map(providers.map((provider) => [provider.id, provider]));
  const modelByKey = new Map(models.map((model) => [`${model.providerConfigId}::${model.modelId}`, model]));
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const run = input.sessionRunner ?? runAutomaticRcpSession;
  let completed = assignments.filter((assignment) => assignment.status === "SessionComplete" || assignment.status === "Judged").length;
  await input.repository.setResearchProjectState(project.id, "Running");

  for (const assignment of assignments.sort((a, b) => a.executionOrder - b.executionOrder)) {
    if (assignment.status === "SessionComplete" || assignment.status === "Judged") continue;
    if (assignment.sessionId) {
      await input.repository.setResearchProjectState(project.id, "Interrupted");
      throw new Error(`Incomplete paid session ${assignment.anonymousSessionId} requires explicit recovery; it will not be rerun silently.`);
    }
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
    const model = modelByKey.get(`${condition.providerConfigId}::${condition.modelId}`);
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
    let linkedSessionId: string | undefined;
    const result = await run({
      repository: input.repository,
      workspaceId: project.workspaceId,
      profileId: condition.profileId,
      aiIsBeDisplayName: sessionProfile ? aiIsBeDisplayName(sessionProfile) : "AI IS-BE",
      humanIsBeDisplayName: sessionProfile ? humanIsBeDisplayName(sessionProfile) : "Human IS-BE",
      providerConfig: provider,
      model,
      protocol: getFullRcp(project.config.sessionLanguage),
      sessionLanguage: project.config.sessionLanguage,
      requestedSettings: condition.requestedSettings,
      maxRetries: project.config.sessionPolicy?.maxRetries,
      requestTimeoutMs: project.config.sessionPolicy?.requestTimeoutMs,
      sessionCodePrefix: project.config.sessionPolicy?.sessionCodePrefix,
      ...(project.config.sessionPolicy?.maxSessionCostUsd && project.config.sessionPolicy.maxSessionCostUsd > 0 ? { maxSessionCostUsd: project.config.sessionPolicy.maxSessionCostUsd } : {}),
      automaticTarget: target,
      researchProjectId: project.id,
      ...(condition.systemPrompt ? { rvSystemPrompt: condition.systemPrompt } : {}),
      ...(condition.conditionInstruction ? { researchConditionInstruction: condition.conditionInstruction } : {}),
      signal: input.signal,
      onSessionCreated: async (sessionId) => {
        linkedSessionId = sessionId;
        await input.repository.updateResearchAssignment(assignment.id, sessionId, "Running");
      },
      onProgress: (session) => input.onProgress?.({ completed, total: assignments.length, anonymousSessionId: assignment.anonymousSessionId, session }),
    });
    if (result.state !== "Revealed") {
      await input.repository.updateResearchAssignment(assignment.id, linkedSessionId ?? result.sessionId, "Interrupted");
      await input.repository.setResearchProjectState(project.id, "Interrupted");
      return;
    }
    if (!input.sessionRunner) {
      await runAutomaticPostRevealReview({
        repository: input.repository,
        sessionId: result.sessionId,
        viewer: { providerConfig: provider, model },
        timeoutMs: project.config.sessionPolicy?.requestTimeoutMs,
      });
    }
    await input.repository.updateResearchAssignment(assignment.id, result.sessionId, "SessionComplete");
    completed += 1;
    input.onProgress?.({ completed, total: assignments.length, anonymousSessionId: assignment.anonymousSessionId });
  }
  await input.repository.setResearchProjectState(project.id, "SessionsComplete");
}

export async function prepareInterruptedResearchRetry(repository: ResearchRepository, projectId: string): Promise<number> {
  const project = await requireProject(repository, projectId);
  if (project.state !== "Interrupted") throw new Error("Explicit Research recovery is available only for an Interrupted project.");
  const assignments = await repository.listResearchAssignments(projectId);
  const recoverable = assignments.filter((assignment) => assignment.sessionId && !["SessionComplete", "Judged"].includes(assignment.status));
  for (const assignment of recoverable) {
    const sessionId = assignment.sessionId!;
    await repository.updateRvSessionState(sessionId, "Interrupted", "RECOVERY: partial Research session preserved; explicit retry approved by user");
    await repository.updateResearchAssignment(assignment.id, undefined, "RetryApproved");
  }
  return recoverable.length;
}

export async function judgeResearch(input: {
  repository: ResearchRepository;
  projectId: string;
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
    if (existing.length === judgeSelections.length) {
      if (assignment.status !== "Judged") await input.repository.updateResearchAssignment(assignment.id, assignment.sessionId, "Judged");
      completed += assignment.status === "Judged" ? 0 : 1;
      continue;
    }
    if (existing.length > judgeSelections.length) throw new Error("Stored Judge count exceeds the locked Research design.");
    await runBlindJudging({
      repository: input.repository,
      sessionId: assignment.sessionId,
      language: project.config.sessionLanguage,
      judges: judgeSelections.slice(existing.length),
      anonymousSessionId: assignment.anonymousSessionId,
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
  if (project.state !== "ScoresFrozen") throw new Error("Blinding Key cannot be used until every Judge score is frozen.");
  await verifyAllResearchScoresFrozen(repository, projectId, project.config.judges.length);

  // This is the explicit evidence boundary: state is marked Unblinded before the key is read.
  await repository.setResearchProjectState(projectId, "Unblinded");
  project = await requireProject(repository, projectId);
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
