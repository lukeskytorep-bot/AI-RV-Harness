import type { CreateProfileInput, Profile, ProfileAiConfigurationInput, UpdateProfileInput, Workspace } from "../types";
import type { CreateJudgeRunInput, FrozenJudgeResultInput, FrozenJudgeScoreInput, JudgeScoreRecord } from "../judge/types";
import { computeJudgeTotal } from "../domain/scoring";
import type { CustomProtocolVersion, SaveCustomProtocolVersionInput } from "../protocols/types";
import type { BlindingMappingRecord, ResearchAssignmentRecord, ResearchConditionRecord, ResearchConfig, ResearchLockPlan, ResearchProjectRecord, ResearchResults, ResearchState } from "../research/types";
import type { CreateWorkspaceSourceInput, WorkspaceSource } from "../sources/types";
import type { AppRepository } from "./repository";
import { createId, nowIso } from "./repository";
import { BrowserProfilesRepository } from "./browser/profilesRepository";
import { BrowserTargetsRepository } from "./browser/targetsRepository";
import { BrowserSettingsModelsRepository } from "./browser/settingsModelsRepository";
import { BrowserWorkspacesConversationsRepository } from "./browser/workspacesConversationsRepository";
import { BrowserSessionsRepository } from "./browser/sessionsRepository";
import { BrowserTrainingRepository } from "./browser/trainingRepository";
import { BrowserAiCenterRepository } from "./browser/aiCenterRepository";
import { BrowserMonitorRepository } from "./browser/monitorRepository";

const PROFILES_KEY = "rvh.dev.profiles";
const WORKSPACES_KEY = "rvh.dev.workspaces";
const JUDGE_RUNS_KEY = "rvh.dev.judge_runs";
const JUDGE_SCORES_KEY = "rvh.dev.judge_scores";
const TARGET_USAGE_KEY = "rvh.dev.target_usage";
const CUSTOM_PROTOCOLS_KEY = "rvh.dev.custom_protocols";
const RESEARCH_PROJECTS_KEY = "rvh.dev.research_projects";
const RESEARCH_CONDITIONS_KEY = "rvh.dev.research_conditions";
const RESEARCH_ASSIGNMENTS_KEY = "rvh.dev.research_assignments";
const BLINDING_MAPPINGS_KEY = "rvh.dev.blinding_mappings";
const RESEARCH_RESULTS_KEY = "rvh.dev.research_results";
const WORKSPACE_SOURCES_KEY = "rvh.dev.workspace_sources";
const CHAT_SOURCE_SELECTION_KEY = "rvh.dev.chat_source_selection";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export class BrowserRepository implements AppRepository {
  private readonly profilesRepository = new BrowserProfilesRepository();
  private readonly workspacesConversationsRepository = new BrowserWorkspacesConversationsRepository();
  private readonly sessionsRepository = new BrowserSessionsRepository({
    isResearchScoresFrozen: (projectId) => Boolean(read<ResearchProjectRecord[]>(RESEARCH_PROJECTS_KEY, []).find((item) => item.id === projectId)?.scoresFrozenAt),
  });
  private readonly trainingRepository = new BrowserTrainingRepository();
  private readonly aiCenterRepository = new BrowserAiCenterRepository();
  private readonly monitorRepository = new BrowserMonitorRepository({
    listRvSessions: (workspaceId) => this.sessionsRepository.listRvSessions(workspaceId),
  });
  private readonly targetsRepository = new BrowserTargetsRepository({
    hasRecordedUse: (id) => read<Array<{ targetId: string }>>(TARGET_USAGE_KEY, []).some((item) => item.targetId === id)
      || this.sessionsRepository.hasRecordedTargetUse(id)
      || read<ResearchAssignmentRecord[]>(RESEARCH_ASSIGNMENTS_KEY, []).some((item) => item.targetId === id),
  });
  private readonly settingsModelsRepository = new BrowserSettingsModelsRepository({
    clearProfileReferences: (removed, timestamp) => {
      write(PROFILES_KEY, read<Profile[]>(PROFILES_KEY, []).map((profile) => {
        const ownsRemovedCredential = profile.credentialId === removed.credentialId;
        const usesRemovedMonitor = profile.defaultMonitorProviderConfigId === removed.id;
        const usesRemovedJudge = profile.defaultJudgeProviderConfigId === removed.id;
        if (!ownsRemovedCredential && !usesRemovedMonitor && !usesRemovedJudge) return profile;
        return {
          ...profile,
          ...(ownsRemovedCredential ? {
            credentialId: undefined,
            credentialProvider: undefined,
            defaultViewerModelId: undefined,
            defaultViewerReasoningEffort: undefined,
            defaultViewerTemperature: undefined,
          } : {}),
          ...(usesRemovedMonitor ? { defaultMonitorProviderConfigId: undefined, defaultMonitorModelId: undefined } : {}),
          ...(usesRemovedJudge ? { defaultJudgeProviderConfigId: undefined, defaultJudgeModelId: undefined } : {}),
          updatedAt: timestamp,
        };
      }));
    },
  });

  ensureAiIdentity: AppRepository["ensureAiIdentity"] = (input) => this.aiCenterRepository.ensureAiIdentity(input);
  listAiIdentities: AppRepository["listAiIdentities"] = (profileId) => this.aiCenterRepository.listAiIdentities(profileId);
  getViewerNoteBundle: AppRepository["getViewerNoteBundle"] = (aiIdentityId) => this.aiCenterRepository.getViewerNoteBundle(aiIdentityId);
  listViewerNoteVersions: AppRepository["listViewerNoteVersions"] = (aiIdentityId) => this.aiCenterRepository.listViewerNoteVersions(aiIdentityId);
  listViewerNoteActivationEvents: AppRepository["listViewerNoteActivationEvents"] = (aiIdentityId) => this.aiCenterRepository.listViewerNoteActivationEvents(aiIdentityId);
  listViewerNoteReflectionRuns: AppRepository["listViewerNoteReflectionRuns"] = (aiIdentityId) => this.aiCenterRepository.listViewerNoteReflectionRuns(aiIdentityId);
  setViewerNoteCapacity: AppRepository["setViewerNoteCapacity"] = (aiIdentityId, capacityTokens) => this.aiCenterRepository.setViewerNoteCapacity(aiIdentityId, capacityTokens);
  setViewerNotesDefaultEnabled: AppRepository["setViewerNotesDefaultEnabled"] = (aiIdentityId, enabled) => this.aiCenterRepository.setViewerNotesDefaultEnabled(aiIdentityId, enabled);
  beginViewerNoteReflection: AppRepository["beginViewerNoteReflection"] = (input) => this.aiCenterRepository.beginViewerNoteReflection(input);
  failViewerNoteReflection: AppRepository["failViewerNoteReflection"] = (runId, status, failureMessage, providerRequestId, rawFinalResponseSha256, attemptCount) => this.aiCenterRepository.failViewerNoteReflection(runId, status, failureMessage, providerRequestId, rawFinalResponseSha256, attemptCount);
  commitViewerNoteReflection: AppRepository["commitViewerNoteReflection"] = (input) => this.aiCenterRepository.commitViewerNoteReflection(input);
  restoreViewerNoteVersion: AppRepository["restoreViewerNoteVersion"] = (aiIdentityId, versionId, workspaceId) => this.aiCenterRepository.restoreViewerNoteVersion(aiIdentityId, versionId, workspaceId);

  createTrainingRun: AppRepository["createTrainingRun"] = (input) => this.trainingRepository.createTrainingRun(input);
  updateTrainingRun: AppRepository["updateTrainingRun"] = (id, input) => this.trainingRepository.updateTrainingRun(id, input);
  listTrainingRuns: AppRepository["listTrainingRuns"] = () => this.trainingRepository.listTrainingRuns();

  async createDatabaseSnapshot(_destinationPath: string): Promise<void> {
    throw new Error("Backup snapshots are available in the desktop app.");
  }

  async closeForRestore(): Promise<void> {
    throw new Error("Restore is available in the desktop app.");
  }

  async listProfiles(): Promise<Profile[]> {
    return this.profilesRepository.listProfiles();
  }

  async listArchivedProfiles(): Promise<Profile[]> {
    return this.profilesRepository.listArchivedProfiles();
  }

  async createProfile(input: CreateProfileInput): Promise<Profile> {
    return this.profilesRepository.createProfile(input);
  }

  async updateProfile(id: string, input: UpdateProfileInput): Promise<void> {
    await this.profilesRepository.updateProfile(id, input);
  }

  async archiveProfile(id: string): Promise<void> {
    const priorWorkspaceArchives = read<Workspace[]>(WORKSPACES_KEY, []).filter((workspace) => workspace.profileId === id && workspace.archivedAt).map((workspace) => Date.parse(workspace.archivedAt!)).filter(Number.isFinite);
    const timestamp = new Date(Math.max(Date.now(), (priorWorkspaceArchives.length ? Math.max(...priorWorkspaceArchives) : 0) + 1)).toISOString();
    write(PROFILES_KEY, read<Profile[]>(PROFILES_KEY, []).map((profile) => profile.id === id ? { ...profile, archivedAt: timestamp, updatedAt: timestamp } : profile));
    write(WORKSPACES_KEY, read<Workspace[]>(WORKSPACES_KEY, []).map((workspace) => workspace.profileId === id ? { ...workspace, archivedAt: timestamp, updatedAt: timestamp } : workspace));
  }

  async restoreProfile(id: string): Promise<void> {
    const profiles = read<Profile[]>(PROFILES_KEY, []);
    const profile = profiles.find((item) => item.id === id && item.archivedAt);
    if (!profile) throw new Error("Archived Profile not found.");
    const archivedAt = profile.archivedAt;
    const timestamp = nowIso();
    write(PROFILES_KEY, profiles.map((item) => item.id === id ? { ...item, archivedAt: undefined, updatedAt: timestamp } : item));
    write(WORKSPACES_KEY, read<Workspace[]>(WORKSPACES_KEY, []).map((workspace) => workspace.profileId === id && workspace.archivedAt === archivedAt ? { ...workspace, archivedAt: undefined, updatedAt: timestamp } : workspace));
  }

  async setProfileAiConfiguration(profileId: string, input: ProfileAiConfigurationInput): Promise<void> {
    await this.profilesRepository.setProfileAiConfiguration(profileId, input);
  }

  async setProfileMonitorSystemPrompt(profileId: string, prompt: string): Promise<void> {
    await this.profilesRepository.setProfileMonitorSystemPrompt(profileId, prompt);
  }

  listWorkspaces: AppRepository["listWorkspaces"] = (profileId) => this.workspacesConversationsRepository.listWorkspaces(profileId);
  listArchivedWorkspaces: AppRepository["listArchivedWorkspaces"] = () => this.workspacesConversationsRepository.listArchivedWorkspaces();
  createWorkspace: AppRepository["createWorkspace"] = (input) => this.workspacesConversationsRepository.createWorkspace(input);
  renameWorkspace: AppRepository["renameWorkspace"] = (id, name) => this.workspacesConversationsRepository.renameWorkspace(id, name);
  archiveWorkspace: AppRepository["archiveWorkspace"] = (id) => this.workspacesConversationsRepository.archiveWorkspace(id);
  restoreWorkspace: AppRepository["restoreWorkspace"] = (id, name) => this.workspacesConversationsRepository.restoreWorkspace(id, name);
  touchWorkspace: AppRepository["touchWorkspace"] = (id) => this.workspacesConversationsRepository.touchWorkspace(id);

  async setProfileCredential(profileId: string, credentialId?: string, provider?: string): Promise<void> {
    await this.profilesRepository.setProfileCredential(profileId, credentialId, provider);
  }

  listChatThreadGroups: AppRepository["listChatThreadGroups"] = (workspaceId, mode) => this.workspacesConversationsRepository.listChatThreadGroups(workspaceId, mode);
  createChatThreadGroup: AppRepository["createChatThreadGroup"] = (workspaceId, mode, title) => this.workspacesConversationsRepository.createChatThreadGroup(workspaceId, mode, title);
  renameChatThreadGroup: AppRepository["renameChatThreadGroup"] = (groupId, title) => this.workspacesConversationsRepository.renameChatThreadGroup(groupId, title);
  archiveChatThreadGroup: AppRepository["archiveChatThreadGroup"] = (groupId) => this.workspacesConversationsRepository.archiveChatThreadGroup(groupId);
  listArchivedChatThreadGroups: AppRepository["listArchivedChatThreadGroups"] = () => this.workspacesConversationsRepository.listArchivedChatThreadGroups();
  restoreChatThreadGroup: AppRepository["restoreChatThreadGroup"] = (groupId) => this.workspacesConversationsRepository.restoreChatThreadGroup(groupId);
  listChatThreads: AppRepository["listChatThreads"] = (workspaceId, mode) => this.workspacesConversationsRepository.listChatThreads(workspaceId, mode);
  createChatThread: AppRepository["createChatThread"] = (workspaceId, mode, title, threadGroupId) => this.workspacesConversationsRepository.createChatThread(workspaceId, mode, title, threadGroupId);
  getOrCreateChatThread: AppRepository["getOrCreateChatThread"] = (workspaceId, mode) => this.workspacesConversationsRepository.getOrCreateChatThread(workspaceId, mode);
  touchChatThread: AppRepository["touchChatThread"] = (threadId) => this.workspacesConversationsRepository.touchChatThread(threadId);
  renameChatThread: AppRepository["renameChatThread"] = (threadId, title) => this.workspacesConversationsRepository.renameChatThread(threadId, title);
  archiveChatThread: AppRepository["archiveChatThread"] = (threadId) => this.workspacesConversationsRepository.archiveChatThread(threadId);
  listArchivedChatThreads: AppRepository["listArchivedChatThreads"] = () => this.workspacesConversationsRepository.listArchivedChatThreads();
  restoreChatThread: AppRepository["restoreChatThread"] = (threadId) => this.workspacesConversationsRepository.restoreChatThread(threadId);
  setChatThreadFormalRvState: AppRepository["setChatThreadFormalRvState"] = (threadId, state) => this.workspacesConversationsRepository.setChatThreadFormalRvState(threadId, state);
  listChatMessages: AppRepository["listChatMessages"] = (threadId) => this.workspacesConversationsRepository.listChatMessages(threadId);
  appendChatMessage: AppRepository["appendChatMessage"] = (threadId, role, content) => this.workspacesConversationsRepository.appendChatMessage(threadId, role, content);

  async listWorkspaceSources(workspaceId: string): Promise<WorkspaceSource[]> {
    return read<WorkspaceSource[]>(WORKSPACE_SOURCES_KEY, []).filter((source) => source.workspaceId === workspaceId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createWorkspaceSource(input: CreateWorkspaceSourceInput): Promise<WorkspaceSource> {
    const source: WorkspaceSource = { id: input.id, workspaceId: input.workspaceId, sourceType: input.sourceType, displayName: input.displayName.trim(), content: input.content, contentHash: input.contentHash, metadata: input.metadata ?? {}, createdAt: nowIso() };
    write(WORKSPACE_SOURCES_KEY, [source, ...read<WorkspaceSource[]>(WORKSPACE_SOURCES_KEY, [])]);
    return source;
  }

  async deleteWorkspaceSource(id: string): Promise<void> {
    write(WORKSPACE_SOURCES_KEY, read<WorkspaceSource[]>(WORKSPACE_SOURCES_KEY, []).filter((source) => source.id !== id));
    const selections = read<Record<string, string[]>>(CHAT_SOURCE_SELECTION_KEY, {});
    for (const key of Object.keys(selections)) selections[key] = selections[key].filter((sourceId) => sourceId !== id);
    write(CHAT_SOURCE_SELECTION_KEY, selections);
  }

  async listActiveChatSourceIds(threadId: string): Promise<string[]> {
    return read<Record<string, string[]>>(CHAT_SOURCE_SELECTION_KEY, {})[threadId] ?? [];
  }

  async setChatSourceActive(threadId: string, sourceId: string, active: boolean): Promise<void> {
    const all = read<Record<string, string[]>>(CHAT_SOURCE_SELECTION_KEY, {});
    const current = all[threadId] ?? [];
    all[threadId] = active ? [...new Set([...current, sourceId])] : current.filter((id) => id !== sourceId);
    write(CHAT_SOURCE_SELECTION_KEY, all);
  }

  loadSettings: AppRepository["loadSettings"] = () => this.settingsModelsRepository.loadSettings();
  saveSettings: AppRepository["saveSettings"] = (settings) => this.settingsModelsRepository.saveSettings(settings);
  listProviderConfigs: AppRepository["listProviderConfigs"] = () => this.settingsModelsRepository.listProviderConfigs();
  createProviderConfig: AppRepository["createProviderConfig"] = (input) => this.settingsModelsRepository.createProviderConfig(input);
  updateProviderCredentialMetadata: AppRepository["updateProviderCredentialMetadata"] = (id, credentialHint, fingerprint) => this.settingsModelsRepository.updateProviderCredentialMetadata(id, credentialHint, fingerprint);
  deleteProviderConfig: AppRepository["deleteProviderConfig"] = (id) => this.settingsModelsRepository.deleteProviderConfig(id);
  updateProviderConnectionStatus: AppRepository["updateProviderConnectionStatus"] = (id, status, error) => this.settingsModelsRepository.updateProviderConnectionStatus(id, status, error);
  listProviderModels: AppRepository["listProviderModels"] = (providerConfigId) => this.settingsModelsRepository.listProviderModels(providerConfigId);
  replaceProviderModels: AppRepository["replaceProviderModels"] = (providerConfigId, models) => this.settingsModelsRepository.replaceProviderModels(providerConfigId, models);
  setProviderModelFavorite: AppRepository["setProviderModelFavorite"] = (providerConfigId, modelId, favorite) => this.settingsModelsRepository.setProviderModelFavorite(providerConfigId, modelId, favorite);
  clearProviderModelCache: AppRepository["clearProviderModelCache"] = () => this.settingsModelsRepository.clearProviderModelCache();

  listTargets: AppRepository["listTargets"] = (collection) => this.targetsRepository.listTargets(collection);
  createTarget: AppRepository["createTarget"] = (input) => this.targetsRepository.createTarget(input);
  updateTarget: AppRepository["updateTarget"] = (id, input) => this.targetsRepository.updateTarget(id, input);
  deleteTarget: AppRepository["deleteTarget"] = (id) => this.targetsRepository.deleteTarget(id);
  recordTargetUsage: AppRepository["recordTargetUsage"] = (input) => this.targetsRepository.recordTargetUsage(input);
  listTargetUsage: AppRepository["listTargetUsage"] = () => this.targetsRepository.listTargetUsage();

  async listCustomProtocols(language?: "pl" | "en"): Promise<CustomProtocolVersion[]> {
    return read<CustomProtocolVersion[]>(CUSTOM_PROTOCOLS_KEY, []).filter((protocol) => !language || protocol.language === language).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async saveCustomProtocolVersion(input: SaveCustomProtocolVersionInput): Promise<CustomProtocolVersion> {
    const all = read<CustomProtocolVersion[]>(CUSTOM_PROTOCOLS_KEY, []);
    const record: CustomProtocolVersion = { ...input, steps: [...input.steps] };
    write(CUSTOM_PROTOCOLS_KEY, [record, ...all]);
    return record;
  }

  createRvSession: AppRepository["createRvSession"] = (input) => this.sessionsRepository.createRvSession(input);
  updateRvSessionState: AppRepository["updateRvSessionState"] = (id, state, stopReason) => this.sessionsRepository.updateRvSessionState(id, state, stopReason);
  appendSessionEvent: AppRepository["appendSessionEvent"] = (sessionId, event) => this.sessionsRepository.appendSessionEvent(sessionId, event);
  listSessionEvents: AppRepository["listSessionEvents"] = (sessionId) => this.sessionsRepository.listSessionEvents(sessionId);
  updatePreRevealTranscript: AppRepository["updatePreRevealTranscript"] = (sessionId, transcript) => this.sessionsRepository.updatePreRevealTranscript(sessionId, transcript);
  appendPostRevealTurn: AppRepository["appendPostRevealTurn"] = (sessionId, role, content) => this.sessionsRepository.appendPostRevealTurn(sessionId, role, content);
  saveSessionSnapshot: AppRepository["saveSessionSnapshot"] = (sessionId, snapshot, hash) => this.sessionsRepository.saveSessionSnapshot(sessionId, snapshot, hash);
  getSessionSnapshot: AppRepository["getSessionSnapshot"] = (sessionId) => this.sessionsRepository.getSessionSnapshot(sessionId);
  sealPreReveal: AppRepository["sealPreReveal"] = (sessionId, transcript, hash) => this.sessionsRepository.sealPreReveal(sessionId, transcript, hash);
  acceptReveal: AppRepository["acceptReveal"] = (sessionId, reveal) => this.sessionsRepository.acceptReveal(sessionId, reveal);
  getReveal: AppRepository["getReveal"] = (sessionId) => this.sessionsRepository.getReveal(sessionId);
  getViewerEvidence: AppRepository["getViewerEvidence"] = (sessionId) => this.sessionsRepository.getViewerEvidence(sessionId);
  listRvSessions: AppRepository["listRvSessions"] = (workspaceId) => this.sessionsRepository.listRvSessions(workspaceId);
  addTargetClarification: AppRepository["addTargetClarification"] = (sessionId, content) => this.sessionsRepository.addTargetClarification(sessionId, content);
  listTargetClarifications: AppRepository["listTargetClarifications"] = (sessionId) => this.sessionsRepository.listTargetClarifications(sessionId);

  createMonitorRun: AppRepository["createMonitorRun"] = (input) => this.monitorRepository.createMonitorRun(input);
  appendMonitorIntervention: AppRepository["appendMonitorIntervention"] = (monitorRunId, intervention) => this.monitorRepository.appendMonitorIntervention(monitorRunId, intervention);
  listMonitorRuns: AppRepository["listMonitorRuns"] = (workspaceId) => this.monitorRepository.listMonitorRuns(workspaceId);
  listMonitorInterventions: AppRepository["listMonitorInterventions"] = (monitorRunId) => this.monitorRepository.listMonitorInterventions(monitorRunId);

  async recordFrozenJudgeResult(run: CreateJudgeRunInput, score: FrozenJudgeScoreInput): Promise<JudgeScoreRecord> {
    return (await this.recordFrozenJudgeResults([{ run, score }]))[0];
  }

  async recordFrozenJudgeResults(results: FrozenJudgeResultInput[]): Promise<JudgeScoreRecord[]> {
    if (!results.length) return [];
    const runs = read<CreateJudgeRunInput[]>(JUDGE_RUNS_KEY, []);
    const seen = new Set(runs.map((item) => `${item.sessionId}::${item.judgeIndex}`));
    for (const { run } of results) {
      const key = `${run.sessionId}::${run.judgeIndex}`;
      if (seen.has(key)) throw new Error("Judge index is already recorded for this session.");
      seen.add(key);
    }
    const timestamp = nowIso();
    const records = results.map(({ run, score }) => ({
      ...score,
      judgeIndex: run.judgeIndex,
      modelRoute: run.modelRoute,
      total: computeJudgeTotal(score),
      frozenAt: timestamp,
      createdAt: timestamp,
    }));
    write(JUDGE_RUNS_KEY, [...runs, ...results.map(({ run }) => structuredClone(run))]);
    write(JUDGE_SCORES_KEY, [...read<JudgeScoreRecord[]>(JUDGE_SCORES_KEY, []), ...structuredClone(records)]);
    return records;
  }

  async listJudgeScores(sessionId: string): Promise<JudgeScoreRecord[]> {
    const runIds = new Set(read<CreateJudgeRunInput[]>(JUDGE_RUNS_KEY, []).filter((run) => run.sessionId === sessionId).map((run) => run.id));
    return read<JudgeScoreRecord[]>(JUDGE_SCORES_KEY, []).filter((score) => runIds.has(score.judgeRunId)).sort((a, b) => a.judgeIndex - b.judgeIndex);
  }

  async createResearchProject(config: ResearchConfig): Promise<ResearchProjectRecord> {
    const timestamp = nowIso();
    const project: ResearchProjectRecord = { id: createId("research"), workspaceId: config.workspaceId, name: config.name.trim(), templateType: config.templateType, state: "Draft", config: structuredClone(config), createdAt: timestamp, updatedAt: timestamp };
    write(RESEARCH_PROJECTS_KEY, [project, ...read<ResearchProjectRecord[]>(RESEARCH_PROJECTS_KEY, [])]);
    return project;
  }

  async getResearchProject(id: string): Promise<ResearchProjectRecord | null> {
    return read<ResearchProjectRecord[]>(RESEARCH_PROJECTS_KEY, []).find((project) => project.id === id) ?? null;
  }

  async listResearchProjects(workspaceId?: string): Promise<ResearchProjectRecord[]> {
    return read<ResearchProjectRecord[]>(RESEARCH_PROJECTS_KEY, []).filter((project) => !workspaceId || project.workspaceId === workspaceId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async setResearchProjectState(id: string, state: ResearchState): Promise<void> {
    const timestamp = nowIso();
    write(RESEARCH_PROJECTS_KEY, read<ResearchProjectRecord[]>(RESEARCH_PROJECTS_KEY, []).map((project) => project.id === id ? {
      ...project, state, updatedAt: timestamp,
      ...(state === "ScoresFrozen" && !project.scoresFrozenAt ? { scoresFrozenAt: timestamp } : {}),
      ...(state === "Unblinded" && !project.unblindedAt ? { unblindedAt: timestamp } : {}),
    } : project));
  }

  async lockResearchProject(id: string, plan: ResearchLockPlan): Promise<void> {
    const projects = read<ResearchProjectRecord[]>(RESEARCH_PROJECTS_KEY, []);
    const project = projects.find((item) => item.id === id);
    if (!project || !["Draft", "Preflight"].includes(project.state)) throw new Error("Research project cannot be locked from its current state.");
    const timestamp = nowIso();
    write(RESEARCH_CONDITIONS_KEY, [...read<ResearchConditionRecord[]>(RESEARCH_CONDITIONS_KEY, []), ...structuredClone(plan.conditions)]);
    write(RESEARCH_ASSIGNMENTS_KEY, [...read<ResearchAssignmentRecord[]>(RESEARCH_ASSIGNMENTS_KEY, []), ...structuredClone(plan.assignments)]);
    write(BLINDING_MAPPINGS_KEY, [...read<BlindingMappingRecord[]>(BLINDING_MAPPINGS_KEY, []), ...structuredClone(plan.mappings)]);
    write(RESEARCH_PROJECTS_KEY, projects.map((item) => item.id === id ? { ...item, state: "Locked", configHash: plan.configHash, lockedAt: timestamp, updatedAt: timestamp } : item));
  }

  async listResearchConditions(projectId: string): Promise<ResearchConditionRecord[]> {
    return read<ResearchConditionRecord[]>(RESEARCH_CONDITIONS_KEY, []).filter((item) => item.researchProjectId === projectId);
  }

  async listResearchAssignments(projectId: string): Promise<ResearchAssignmentRecord[]> {
    return read<ResearchAssignmentRecord[]>(RESEARCH_ASSIGNMENTS_KEY, []).filter((item) => item.researchProjectId === projectId).sort((a, b) => a.executionOrder - b.executionOrder);
  }

  async listBlindingMappings(projectId: string): Promise<BlindingMappingRecord[]> {
    return read<BlindingMappingRecord[]>(BLINDING_MAPPINGS_KEY, []).filter((item) => item.researchProjectId === projectId);
  }

  async updateResearchAssignment(id: string, sessionId: string | undefined, status: string): Promise<void> {
    write(RESEARCH_ASSIGNMENTS_KEY, read<ResearchAssignmentRecord[]>(RESEARCH_ASSIGNMENTS_KEY, []).map((item) => item.id === id ? { ...item, sessionId, status } : item));
  }

  async saveResearchResults(projectId: string, results: ResearchResults, hash: string): Promise<void> {
    const all = read<Array<{ id: string; projectId: string; results: ResearchResults; hash: string; createdAt: string }>>(RESEARCH_RESULTS_KEY, []);
    if (all.some((item) => item.projectId === projectId)) throw new Error("Research results are immutable once written.");
    write(RESEARCH_RESULTS_KEY, [...all, { id: createId("research_results"), projectId, results: structuredClone(results), hash, createdAt: nowIso() }]);
  }

  async getResearchResults(projectId: string): Promise<ResearchResults | null> {
    return read<Array<{ projectId: string; results: ResearchResults }>>(RESEARCH_RESULTS_KEY, []).find((item) => item.projectId === projectId)?.results ?? null;
  }

  async recordExport(workspaceId: string, researchProjectId: string | undefined, exportType: string, artifactPath: string, manifestHash: string): Promise<void> {
    const key = "rvh.dev.exports";
    const all = read<Array<{ id: string; workspaceId: string; researchProjectId?: string; exportType: string; artifactPath: string; manifestHash: string; createdAt: string }>>(key, []);
    write(key, [...all, { id: createId("export"), workspaceId, researchProjectId, exportType, artifactPath, manifestHash, createdAt: nowIso() }]);
  }
}
