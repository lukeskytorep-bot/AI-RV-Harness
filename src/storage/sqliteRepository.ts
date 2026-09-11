import Database from "@tauri-apps/plugin-sql";
import type { CreateProfileInput, Profile, ProfileAiConfigurationInput, UpdateProfileInput } from "../types";
import type { CustomProtocolVersion, SaveCustomProtocolVersionInput } from "../protocols/types";
import type { CreateWorkspaceSourceInput, WorkspaceSource } from "../sources/types";
import type { AppRepository } from "./repository";
import { createId, nowIso } from "./repository";
import { createDatabaseSnapshotNative, executeDatabaseTransaction, executeDatabaseWrite, initializeDatabaseNative, selectDatabaseReadonly, type DatabaseTransactionStatement } from "./databaseNative";
import { SqliteWriteCoordinator } from "./sqliteWriteCoordinator";
import { SqliteProfilesRepository } from "./sqlite/profilesRepository";
import { SqliteTargetsRepository } from "./sqlite/targetsRepository";
import { SqliteSettingsModelsRepository } from "./sqlite/settingsModelsRepository";
import { SqliteWorkspacesConversationsRepository } from "./sqlite/workspacesConversationsRepository";
import { SqliteSessionsRepository } from "./sqlite/sessionsRepository";
import { SqliteTrainingRepository } from "./sqlite/trainingRepository";
import { SqliteAiCenterRepository } from "./sqlite/aiCenterRepository";
import { SqliteMonitorRepository } from "./sqlite/monitorRepository";
import { SqliteJudgeRepository } from "./sqlite/judgeRepository";
import { SqliteResearchRepository } from "./sqlite/researchRepository";
import { SqliteExportRepository } from "./sqlite/exportRepository";
import { SqliteControlledPurge } from "./sqlite/controlledPurge";

type WorkspaceSourceRow = { id: string; workspace_id: string; source_type: "text" | "markdown" | "pdf" | "docx"; display_name: string; content_text: string | null; content_hash: string | null; metadata_json: string; created_at: string };
type CustomProtocolRow = {
  protocol_id: string;
  version_id: string;
  display_name: string;
  version: string;
  language: "pl" | "en";
  content: string;
  ordered_steps_json: string;
  content_hash: string;
  source_metadata_json: string;
  created_at: string;
};

export class SqliteRepository implements AppRepository {
  private readonly writes = new SqliteWriteCoordinator();
  private readonly profilesRepository: SqliteProfilesRepository;
  private readonly targetsRepository: SqliteTargetsRepository;
  private readonly settingsModelsRepository: SqliteSettingsModelsRepository;
  private readonly workspacesConversationsRepository: SqliteWorkspacesConversationsRepository;
  private readonly researchRepository: SqliteResearchRepository;
  private readonly sessionsRepository: SqliteSessionsRepository;
  private readonly trainingRepository: SqliteTrainingRepository;
  private readonly aiCenterRepository: SqliteAiCenterRepository;
  private readonly monitorRepository: SqliteMonitorRepository;
  private readonly judgeRepository: SqliteJudgeRepository;
  private readonly exportRepository: SqliteExportRepository;
  private readonly controlledPurge: SqliteControlledPurge;

  private constructor(private readonly db: Database) {
    this.profilesRepository = new SqliteProfilesRepository({
      select: <T>(query: string, bindValues?: unknown[]) => selectDatabaseReadonly<T>(query, bindValues ?? []),
      executeWrite: (query: string, bindValues?: unknown[]) => this.executeWrite(query, bindValues),
    });
    this.targetsRepository = new SqliteTargetsRepository({
      select: <T>(query: string, bindValues?: unknown[]) => selectDatabaseReadonly<T>(query, bindValues ?? []),
      executeWrite: (query: string, bindValues?: unknown[]) => this.executeWrite(query, bindValues),
    });
    this.settingsModelsRepository = new SqliteSettingsModelsRepository({
      select: <T>(query: string, bindValues?: unknown[]) => selectDatabaseReadonly<T>(query, bindValues ?? []),
      executeWrite: (query: string, bindValues?: unknown[]) => this.executeWrite(query, bindValues),
      executeTransaction: (statements) => this.executeTransaction(statements),
    });
    this.workspacesConversationsRepository = new SqliteWorkspacesConversationsRepository({
      select: <T>(query: string, bindValues?: unknown[]) => selectDatabaseReadonly<T>(query, bindValues ?? []),
      executeWrite: (query: string, bindValues?: unknown[]) => this.executeWrite(query, bindValues),
    });
    this.researchRepository = new SqliteResearchRepository({
      select: <T>(query: string, bindValues?: unknown[]) => selectDatabaseReadonly<T>(query, bindValues ?? []),
      executeWrite: (query: string, bindValues?: unknown[]) => this.executeWrite(query, bindValues),
      executeTransaction: (statements) => this.executeTransaction(statements),
    });
    this.sessionsRepository = new SqliteSessionsRepository({
      select: <T>(query: string, bindValues?: unknown[]) => selectDatabaseReadonly<T>(query, bindValues ?? []),
      executeWrite: (query: string, bindValues?: unknown[]) => this.executeWrite(query, bindValues),
      isResearchScoresFrozen: (projectId) => this.researchRepository.isScoresFrozen(projectId),
    });
    this.trainingRepository = new SqliteTrainingRepository({
      select: <T>(query: string, bindValues?: unknown[]) => selectDatabaseReadonly<T>(query, bindValues ?? []),
      executeWrite: (query: string, bindValues?: unknown[]) => this.executeWrite(query, bindValues),
    });
    this.aiCenterRepository = new SqliteAiCenterRepository({
      select: <T>(query: string, bindValues?: unknown[]) => selectDatabaseReadonly<T>(query, bindValues ?? []),
      executeWrite: (query: string, bindValues?: unknown[]) => this.executeWrite(query, bindValues),
      executeTransaction: (statements) => this.executeTransaction(statements),
    });
    this.monitorRepository = new SqliteMonitorRepository({
      select: <T>(query: string, bindValues?: unknown[]) => selectDatabaseReadonly<T>(query, bindValues ?? []),
      executeWrite: (query: string, bindValues?: unknown[]) => this.executeWrite(query, bindValues),
    });
    this.judgeRepository = new SqliteJudgeRepository({
      select: <T>(query: string, bindValues?: unknown[]) => selectDatabaseReadonly<T>(query, bindValues ?? []),
      executeTransaction: (statements) => this.executeTransaction(statements),
    });
    this.exportRepository = new SqliteExportRepository({
      executeWrite: (query: string, bindValues?: unknown[]) => this.executeWrite(query, bindValues),
    });
    this.controlledPurge = new SqliteControlledPurge({
      select: <T>(query: string, bindValues?: unknown[]) => selectDatabaseReadonly<T>(query, bindValues ?? []),
    });
  }

  static async connect(): Promise<SqliteRepository> {
    const db = await Database.load("sqlite:rv_harness.db");
    const repository = new SqliteRepository(db);
    // WAL keeps readers responsive while the single coordinated writer persists evidence.
    await repository.writes.run(() => initializeDatabaseNative());
    return repository;
  }

  private executeWrite(query: string, bindValues?: unknown[]) {
    return this.writes.run(() => executeDatabaseWrite(query, bindValues ?? []));
  }

  private executeTransaction(statements: DatabaseTransactionStatement[]) {
    return this.writes.run(() => executeDatabaseTransaction(statements));
  }

  async createDatabaseSnapshot(destinationPath: string): Promise<void> {
    await this.writes.run(() => createDatabaseSnapshotNative(destinationPath));
  }

  async closeForRestore(): Promise<void> {
    await this.writes.idle();
    await this.db.close();
  }

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
  detachViewerNoteSourceReferences: AppRepository["detachViewerNoteSourceReferences"] = (input) => this.aiCenterRepository.detachViewerNoteSourceReferences(input);

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
    const prior = await selectDatabaseReadonly<Array<{ latest: string | null }>>("SELECT MAX(archived_at) AS latest FROM workspaces WHERE profile_id = $1", [id]);
    const latest = prior[0]?.latest ? Date.parse(prior[0].latest) : 0;
    const timestamp = new Date(Math.max(Date.now(), (Number.isFinite(latest) ? latest : 0) + 1)).toISOString();
    await this.executeTransaction([
      { query: "UPDATE workspaces SET archived_at = $1, updated_at = $1 WHERE profile_id = $2 AND archived_at IS NULL", values: [timestamp, id] },
      { query: "UPDATE profiles SET archived_at = $1, updated_at = $1 WHERE id = $2 AND archived_at IS NULL", values: [timestamp, id] },
    ]);
  }

  async restoreProfile(id: string): Promise<void> {
    const rows = await selectDatabaseReadonly<Array<{ archived_at: string }>>("SELECT archived_at FROM profiles WHERE id = $1 AND archived_at IS NOT NULL", [id]);
    const archivedAt = rows[0]?.archived_at;
    if (!archivedAt) throw new Error("Archived Profile not found.");
    const timestamp = nowIso();
    await this.executeTransaction([
      { query: "UPDATE profiles SET archived_at = NULL, updated_at = $1 WHERE id = $2", values: [timestamp, id] },
      { query: "UPDATE workspaces SET archived_at = NULL, updated_at = $1 WHERE profile_id = $2 AND archived_at = $3", values: [timestamp, id, archivedAt] },
    ]);
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

  async setProfileCredential(profileId: string, credentialId?: string, _provider?: string): Promise<void> {
    await this.profilesRepository.setProfileCredential(profileId, credentialId, _provider);
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
    const rows = await selectDatabaseReadonly<WorkspaceSourceRow[]>(
      `SELECT id, workspace_id, source_type, display_name, content_text, content_hash, metadata_json, created_at
         FROM workspace_sources WHERE workspace_id = $1 AND content_text IS NOT NULL ORDER BY created_at DESC`, [workspaceId],
    );
    return rows.map((row) => ({ id: row.id, workspaceId: row.workspace_id, sourceType: row.source_type, displayName: row.display_name, content: row.content_text ?? "", contentHash: row.content_hash ?? "", metadata: JSON.parse(row.metadata_json) as Record<string, unknown>, createdAt: row.created_at }));
  }

  async createWorkspaceSource(input: CreateWorkspaceSourceInput): Promise<WorkspaceSource> {
    const timestamp = nowIso();
    const source: WorkspaceSource = { id: input.id, workspaceId: input.workspaceId, sourceType: input.sourceType, displayName: input.displayName.trim(), content: input.content, contentHash: input.contentHash, metadata: input.metadata ?? {}, createdAt: timestamp };
    await this.executeWrite(
      `INSERT INTO workspace_sources (id, workspace_id, source_type, display_name, content_hash, metadata_json, content_text, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [source.id, source.workspaceId, source.sourceType, source.displayName, source.contentHash, JSON.stringify(source.metadata), source.content, timestamp],
    );
    return source;
  }

  async deleteWorkspaceSource(id: string): Promise<void> {
    await this.executeWrite("DELETE FROM workspace_sources WHERE id = $1", [id]);
  }

  async listActiveChatSourceIds(threadId: string): Promise<string[]> {
    const rows = await selectDatabaseReadonly<{ source_id: string }[]>("SELECT source_id FROM chat_thread_sources WHERE thread_id = $1 AND active = 1", [threadId]);
    return rows.map((row) => row.source_id);
  }

  async setChatSourceActive(threadId: string, sourceId: string, active: boolean): Promise<void> {
    await this.executeWrite(
      `INSERT INTO chat_thread_sources (thread_id, source_id, active, updated_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT(thread_id, source_id) DO UPDATE SET active = excluded.active, updated_at = excluded.updated_at`,
      [threadId, sourceId, active ? 1 : 0, nowIso()],
    );
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
  previewPermanentDelete: AppRepository["previewPermanentDelete"] = (kind, id) => this.controlledPurge.preview(kind, id);
  purgeProfile: AppRepository["purgeProfile"] = (id) => this.controlledPurge.purge("profile", id);
  purgeWorkspace: AppRepository["purgeWorkspace"] = (id) => this.controlledPurge.purge("workspace", id);
  purgeChatThread: AppRepository["purgeChatThread"] = (id) => this.controlledPurge.purge("conversation", id);
  purgeRvSession: AppRepository["purgeRvSession"] = (id) => this.controlledPurge.purge("rv_session", id);
  purgeTrainingRun: AppRepository["purgeTrainingRun"] = (id) => this.controlledPurge.purge("training", id);
  purgeResearchProject: AppRepository["purgeResearchProject"] = (id) => this.controlledPurge.purge("research", id);
  purgeTarget: AppRepository["purgeTarget"] = (id) => this.controlledPurge.purge("target", id);
  recordTargetUsage: AppRepository["recordTargetUsage"] = (input) => this.targetsRepository.recordTargetUsage(input);
  listTargetUsage: AppRepository["listTargetUsage"] = () => this.targetsRepository.listTargetUsage();

  async listCustomProtocols(language?: "pl" | "en"): Promise<CustomProtocolVersion[]> {
    const rows = language
      ? await selectDatabaseReadonly<CustomProtocolRow[]>(
          `SELECT p.id AS protocol_id, pv.id AS version_id, p.display_name, pv.version, pv.language,
                  pv.content, pv.ordered_steps_json, pv.content_hash, pv.source_metadata_json, pv.created_at
             FROM protocols p JOIN protocol_versions pv ON pv.protocol_id = p.id
            WHERE p.family = 'custom' AND pv.language = $1 ORDER BY p.display_name, pv.created_at DESC`,
          [language],
        )
      : await selectDatabaseReadonly<CustomProtocolRow[]>(
          `SELECT p.id AS protocol_id, pv.id AS version_id, p.display_name, pv.version, pv.language,
                  pv.content, pv.ordered_steps_json, pv.content_hash, pv.source_metadata_json, pv.created_at
             FROM protocols p JOIN protocol_versions pv ON pv.protocol_id = p.id
            WHERE p.family = 'custom' ORDER BY p.display_name, pv.created_at DESC`,
        );
    return rows.map((row) => {
      const metadata = JSON.parse(row.source_metadata_json) as Record<string, unknown>;
      return {
        protocolId: row.protocol_id,
        versionId: row.version_id,
        displayName: row.display_name,
        description: typeof metadata.description === "string" ? metadata.description : undefined,
        version: row.version,
        language: row.language,
        systemPrompt: row.content.trim() || undefined,
        steps: JSON.parse(row.ordered_steps_json) as string[],
        contentHash: row.content_hash,
        createdAt: row.created_at,
      };
    });
  }

  async saveCustomProtocolVersion(input: SaveCustomProtocolVersionInput): Promise<CustomProtocolVersion> {
    const existing = await selectDatabaseReadonly<{ id: string }[]>("SELECT id FROM protocols WHERE id = $1", [input.protocolId]);
    if (!existing.length) {
      await this.executeWrite(
        `INSERT INTO protocols (id, family, display_name, built_in, created_at) VALUES ($1, 'custom', $2, 0, $3)`,
        [input.protocolId, input.displayName, input.createdAt],
      );
    }
    await this.executeWrite(
      `INSERT INTO protocol_versions
       (id, protocol_id, version, language, content, ordered_steps_json, reveal_policy_json, content_hash, source_metadata_json, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [input.versionId, input.protocolId, input.version, input.language, input.systemPrompt ?? "", JSON.stringify(input.steps), JSON.stringify({ separateRevealStage: true }), input.contentHash, JSON.stringify({ description: input.description ?? "", origin: "user" }), input.createdAt],
    );
    return { ...input, steps: [...input.steps] };
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
