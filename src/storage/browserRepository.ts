import type { CreateProfileInput, Profile, ProfileAiConfigurationInput, UpdateProfileInput, Workspace } from "../types";
import type { CustomProtocolVersion, SaveCustomProtocolVersionInput } from "../protocols/types";
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
import { BrowserJudgeRepository } from "./browser/judgeRepository";
import { BrowserResearchRepository } from "./browser/researchRepository";
import { BrowserExportRepository } from "./browser/exportRepository";

const PROFILES_KEY = "rvh.dev.profiles";
const WORKSPACES_KEY = "rvh.dev.workspaces";
const TARGET_USAGE_KEY = "rvh.dev.target_usage";
const CUSTOM_PROTOCOLS_KEY = "rvh.dev.custom_protocols";
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
  private readonly researchRepository = new BrowserResearchRepository();
  private readonly sessionsRepository = new BrowserSessionsRepository({
    isResearchScoresFrozen: (projectId) => this.researchRepository.isScoresFrozen(projectId),
  });
  private readonly trainingRepository = new BrowserTrainingRepository();
  private readonly aiCenterRepository = new BrowserAiCenterRepository();
  private readonly monitorRepository = new BrowserMonitorRepository({
    listRvSessions: (workspaceId) => this.sessionsRepository.listRvSessions(workspaceId),
  });
  private readonly judgeRepository = new BrowserJudgeRepository();
  private readonly exportRepository = new BrowserExportRepository();
  private readonly targetsRepository = new BrowserTargetsRepository({
    hasRecordedUse: (id) => read<Array<{ targetId: string }>>(TARGET_USAGE_KEY, []).some((item) => item.targetId === id)
      || this.sessionsRepository.hasRecordedTargetUse(id)
      || this.researchRepository.hasRecordedTargetUse(id),
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
  listArchivedTrainingRuns: AppRepository["listArchivedTrainingRuns"] = () => this.trainingRepository.listArchivedTrainingRuns();

  async archiveTrainingRun(id: string): Promise<void> {
    const run = (await this.trainingRepository.listTrainingRuns()).find((item) => item.id === id);
    if (!run) throw new Error("Active Training run not found.");
    const sessionIds = [...new Set([...(run.sessionIds ?? []), ...(run.activeTargetCheckpoint?.sessionId ? [run.activeTargetCheckpoint.sessionId] : [])])];
    const changed: string[] = [];
    try {
      for (const sessionId of sessionIds) {
        const session = await this.sessionsRepository.getRvSession(sessionId);
        if (session && !session.archivedAt) { await this.sessionsRepository.archiveRvSession(sessionId); changed.push(sessionId); }
      }
      await this.trainingRepository.archiveTrainingRun(id);
    } catch (cause) {
      for (const sessionId of changed.reverse()) await this.sessionsRepository.restoreRvSession(sessionId).catch(() => undefined);
      throw cause;
    }
  }

  async restoreTrainingRun(id: string): Promise<void> {
    const run = (await this.trainingRepository.listArchivedTrainingRuns()).find((item) => item.id === id);
    if (!run) throw new Error("Archived Training run not found.");
    const sessionIds = [...new Set([...(run.sessionIds ?? []), ...(run.activeTargetCheckpoint?.sessionId ? [run.activeTargetCheckpoint.sessionId] : [])])];
    const changed: string[] = [];
    try {
      for (const sessionId of sessionIds) {
        const session = await this.sessionsRepository.getRvSession(sessionId);
        if (session?.archivedAt) { await this.sessionsRepository.restoreRvSession(sessionId); changed.push(sessionId); }
      }
      await this.trainingRepository.restoreTrainingRun(id);
    } catch (cause) {
      for (const sessionId of changed.reverse()) await this.sessionsRepository.archiveRvSession(sessionId).catch(() => undefined);
      throw cause;
    }
  }

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

  listChatThreads: AppRepository["listChatThreads"] = (workspaceId, mode) => this.workspacesConversationsRepository.listChatThreads(workspaceId, mode);
  createChatThread: AppRepository["createChatThread"] = (workspaceId, mode, title) => this.workspacesConversationsRepository.createChatThread(workspaceId, mode, title);
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
  listArchivedTargets: AppRepository["listArchivedTargets"] = () => this.targetsRepository.listArchivedTargets();
  createTarget: AppRepository["createTarget"] = (input) => this.targetsRepository.createTarget(input);
  updateTarget: AppRepository["updateTarget"] = (id, input) => this.targetsRepository.updateTarget(id, input);
  archiveTarget: AppRepository["archiveTarget"] = (id) => this.targetsRepository.archiveTarget(id);
  restoreTarget: AppRepository["restoreTarget"] = (id) => this.targetsRepository.restoreTarget(id);
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
  listArchivedRvSessions: AppRepository["listArchivedRvSessions"] = async () => {
    const trainingSessionIds = new Set([...(await this.trainingRepository.listTrainingRuns()), ...(await this.trainingRepository.listArchivedTrainingRuns())].flatMap((run) => [...(run.sessionIds ?? []), ...(run.activeTargetCheckpoint?.sessionId ? [run.activeTargetCheckpoint.sessionId] : [])]));
    return (await this.sessionsRepository.listArchivedRvSessions()).filter((session) => !session.researchProjectId && !trainingSessionIds.has(session.id));
  };
  archiveRvSession: AppRepository["archiveRvSession"] = async (id) => {
    const session = await this.sessionsRepository.getRvSession(id);
    if (!session || session.archivedAt) throw new Error("Active RV Session not found.");
    if (session.researchProjectId) throw new Error("Research-owned sessions are archived with their Research project.");
    const trainingOwned = [...(await this.trainingRepository.listTrainingRuns()), ...(await this.trainingRepository.listArchivedTrainingRuns())].some((run) => (run.sessionIds ?? []).includes(id) || run.activeTargetCheckpoint?.sessionId === id);
    if (trainingOwned) throw new Error("Training-owned sessions are archived with their Training run.");
    await this.sessionsRepository.archiveRvSession(id);
  };
  restoreRvSession: AppRepository["restoreRvSession"] = async (id) => {
    const session = await this.sessionsRepository.getRvSession(id);
    if (!session?.archivedAt) throw new Error("Archived RV Session not found.");
    if (session.researchProjectId) throw new Error("Research-owned sessions are restored with their Research project.");
    const trainingOwned = [...(await this.trainingRepository.listTrainingRuns()), ...(await this.trainingRepository.listArchivedTrainingRuns())].some((run) => (run.sessionIds ?? []).includes(id) || run.activeTargetCheckpoint?.sessionId === id);
    if (trainingOwned) throw new Error("Training-owned sessions are restored with their Training run.");
    await this.sessionsRepository.restoreRvSession(id);
  };
  listRecentRvSessions: AppRepository["listRecentRvSessions"] = async (limit) => {
    const workspaces = await this.workspacesConversationsRepository.listWorkspaces();
    return this.sessionsRepository.listRecentRvSessions(workspaces.map((workspace) => workspace.id), limit);
  };
  addTargetClarification: AppRepository["addTargetClarification"] = (sessionId, content) => this.sessionsRepository.addTargetClarification(sessionId, content);
  listTargetClarifications: AppRepository["listTargetClarifications"] = (sessionId) => this.sessionsRepository.listTargetClarifications(sessionId);

  createMonitorRun: AppRepository["createMonitorRun"] = (input) => this.monitorRepository.createMonitorRun(input);
  appendMonitorIntervention: AppRepository["appendMonitorIntervention"] = (monitorRunId, intervention) => this.monitorRepository.appendMonitorIntervention(monitorRunId, intervention);
  listMonitorRuns: AppRepository["listMonitorRuns"] = (workspaceId) => this.monitorRepository.listMonitorRuns(workspaceId);
  listMonitorInterventions: AppRepository["listMonitorInterventions"] = (monitorRunId) => this.monitorRepository.listMonitorInterventions(monitorRunId);

  recordFrozenJudgeResult: AppRepository["recordFrozenJudgeResult"] = (run, score) => this.judgeRepository.recordFrozenJudgeResult(run, score);
  recordFrozenJudgeResults: AppRepository["recordFrozenJudgeResults"] = (results) => this.judgeRepository.recordFrozenJudgeResults(results);
  listJudgeScores: AppRepository["listJudgeScores"] = (sessionId) => this.judgeRepository.listJudgeScores(sessionId);

  createResearchProject: AppRepository["createResearchProject"] = (config) => this.researchRepository.createResearchProject(config);
  getResearchProject: AppRepository["getResearchProject"] = (id) => this.researchRepository.getResearchProject(id);
  listResearchProjects: AppRepository["listResearchProjects"] = (workspaceId) => this.researchRepository.listResearchProjects(workspaceId);
  listArchivedResearchProjects: AppRepository["listArchivedResearchProjects"] = () => this.researchRepository.listArchivedResearchProjects();

  async archiveResearchProject(id: string): Promise<void> {
    const project = (await this.researchRepository.listResearchProjects()).find((item) => item.id === id);
    if (!project) throw new Error("Active Research project not found.");
    const sessionIds = (await this.sessionsRepository.listRvSessions(project.workspaceId)).filter((session) => session.researchProjectId === id).map((session) => session.id);
    const changed: string[] = [];
    try {
      for (const sessionId of sessionIds) { await this.sessionsRepository.archiveRvSession(sessionId); changed.push(sessionId); }
      await this.researchRepository.archiveResearchProject(id);
    } catch (cause) {
      for (const sessionId of changed.reverse()) await this.sessionsRepository.restoreRvSession(sessionId).catch(() => undefined);
      throw cause;
    }
  }

  async restoreResearchProject(id: string): Promise<void> {
    const project = (await this.researchRepository.listArchivedResearchProjects()).find((item) => item.id === id);
    if (!project) throw new Error("Archived Research project not found.");
    const sessionIds = (await this.sessionsRepository.listArchivedRvSessions()).filter((session) => session.researchProjectId === id).map((session) => session.id);
    const changed: string[] = [];
    try {
      for (const sessionId of sessionIds) { await this.sessionsRepository.restoreRvSession(sessionId); changed.push(sessionId); }
      await this.researchRepository.restoreResearchProject(id);
    } catch (cause) {
      for (const sessionId of changed.reverse()) await this.sessionsRepository.archiveRvSession(sessionId).catch(() => undefined);
      throw cause;
    }
  }

  setResearchProjectState: AppRepository["setResearchProjectState"] = (id, state) => this.researchRepository.setResearchProjectState(id, state);
  lockResearchProject: AppRepository["lockResearchProject"] = (id, plan) => this.researchRepository.lockResearchProject(id, plan);
  listResearchConditions: AppRepository["listResearchConditions"] = (projectId) => this.researchRepository.listResearchConditions(projectId);
  listResearchAssignments: AppRepository["listResearchAssignments"] = (projectId) => this.researchRepository.listResearchAssignments(projectId);
  listBlindingMappings: AppRepository["listBlindingMappings"] = (projectId) => this.researchRepository.listBlindingMappings(projectId);
  updateResearchAssignment: AppRepository["updateResearchAssignment"] = (id, sessionId, status) => this.researchRepository.updateResearchAssignment(id, sessionId, status);
  saveResearchResults: AppRepository["saveResearchResults"] = (projectId, results, hash) => this.researchRepository.saveResearchResults(projectId, results, hash);
  getResearchResults: AppRepository["getResearchResults"] = (projectId) => this.researchRepository.getResearchResults(projectId);

  recordExport: AppRepository["recordExport"] = (workspaceId, researchProjectId, exportType, artifactPath, manifestHash) => this.exportRepository.recordExport(workspaceId, researchProjectId, exportType, artifactPath, manifestHash);

}
