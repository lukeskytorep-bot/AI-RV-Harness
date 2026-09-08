import Database from "@tauri-apps/plugin-sql";
import type { CreateProfileInput, Profile, ProfileAiConfigurationInput, UpdateProfileInput } from "../types";
import type { CreateJudgeRunInput, FrozenJudgeResultInput, FrozenJudgeScoreInput, JudgeNarrative, JudgeScoreRecord } from "../judge/types";
import { computeJudgeTotal } from "../domain/scoring";
import type { CustomProtocolVersion, SaveCustomProtocolVersionInput } from "../protocols/types";
import type { BlindingMappingRecord, ResearchAssignmentRecord, ResearchConditionRecord, ResearchConfig, ResearchLockPlan, ResearchProjectRecord, ResearchResults, ResearchState, ResearchTemplateType } from "../research/types";
import type { CreateWorkspaceSourceInput, WorkspaceSource } from "../sources/types";
import type { AppRepository } from "./repository";
import { createId, nowIso } from "./repository";
import { executeDatabaseTransaction, type DatabaseTransactionStatement } from "./databaseNative";
import { SqliteWriteCoordinator } from "./sqliteWriteCoordinator";
import { SqliteProfilesRepository } from "./sqlite/profilesRepository";
import { SqliteTargetsRepository } from "./sqlite/targetsRepository";
import { SqliteSettingsModelsRepository } from "./sqlite/settingsModelsRepository";
import { SqliteWorkspacesConversationsRepository } from "./sqlite/workspacesConversationsRepository";
import { SqliteSessionsRepository } from "./sqlite/sessionsRepository";
import { SqliteTrainingRepository } from "./sqlite/trainingRepository";
import { SqliteAiCenterRepository } from "./sqlite/aiCenterRepository";
import { SqliteMonitorRepository } from "./sqlite/monitorRepository";

type WorkspaceSourceRow = { id: string; workspace_id: string; source_type: "text" | "markdown" | "pdf" | "docx"; display_name: string; content_text: string | null; content_hash: string | null; metadata_json: string; created_at: string };
type JudgeScoreRow = {
  id: string;
  judge_run_id: string;
  judge_index: number;
  model_route: string;
  gestalt: number;
  verifiable_features: number;
  activity_function_event: number;
  confabulation_control: number;
  total: number;
  rationale_json: string;
  frozen_at: string;
  created_at: string;
};
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
type ResearchProjectRow = {
  id: string;
  workspace_id: string;
  name: string;
  template_type: ResearchTemplateType;
  state: ResearchState;
  config_json: string;
  config_hash: string | null;
  locked_at: string | null;
  scores_frozen_at: string | null;
  unblinded_at: string | null;
  created_at: string;
  updated_at: string;
};

function mapResearchProject(row: ResearchProjectRow): ResearchProjectRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    templateType: row.template_type,
    state: row.state,
    config: JSON.parse(row.config_json) as ResearchConfig,
    configHash: row.config_hash ?? undefined,
    lockedAt: row.locked_at ?? undefined,
    scoresFrozenAt: row.scores_frozen_at ?? undefined,
    unblindedAt: row.unblinded_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteRepository implements AppRepository {
  private readonly writes = new SqliteWriteCoordinator();
  private readonly profilesRepository: SqliteProfilesRepository;
  private readonly targetsRepository: SqliteTargetsRepository;
  private readonly settingsModelsRepository: SqliteSettingsModelsRepository;
  private readonly workspacesConversationsRepository: SqliteWorkspacesConversationsRepository;
  private readonly sessionsRepository: SqliteSessionsRepository;
  private readonly trainingRepository: SqliteTrainingRepository;
  private readonly aiCenterRepository: SqliteAiCenterRepository;
  private readonly monitorRepository: SqliteMonitorRepository;

  private constructor(private readonly db: Database) {
    this.profilesRepository = new SqliteProfilesRepository({
      select: <T>(query: string, bindValues?: unknown[]) => this.db.select<T>(query, bindValues),
      executeWrite: (query: string, bindValues?: unknown[]) => this.executeWrite(query, bindValues),
    });
    this.targetsRepository = new SqliteTargetsRepository({
      select: <T>(query: string, bindValues?: unknown[]) => this.db.select<T>(query, bindValues),
      executeWrite: (query: string, bindValues?: unknown[]) => this.executeWrite(query, bindValues),
    });
    this.settingsModelsRepository = new SqliteSettingsModelsRepository({
      select: <T>(query: string, bindValues?: unknown[]) => this.db.select<T>(query, bindValues),
      executeWrite: (query: string, bindValues?: unknown[]) => this.executeWrite(query, bindValues),
      executeTransaction: (statements) => this.executeTransaction(statements),
    });
    this.workspacesConversationsRepository = new SqliteWorkspacesConversationsRepository({
      select: <T>(query: string, bindValues?: unknown[]) => this.db.select<T>(query, bindValues),
      executeWrite: (query: string, bindValues?: unknown[]) => this.executeWrite(query, bindValues),
      executeTransaction: (statements) => this.executeTransaction(statements),
    });
    this.sessionsRepository = new SqliteSessionsRepository({
      select: <T>(query: string, bindValues?: unknown[]) => this.db.select<T>(query, bindValues),
      executeWrite: (query: string, bindValues?: unknown[]) => this.executeWrite(query, bindValues),
      isResearchScoresFrozen: async (projectId) => Boolean((await this.db.select<Array<{ scores_frozen_at: string | null }>>(
        "SELECT scores_frozen_at FROM research_projects WHERE id = $1",
        [projectId],
      ))[0]?.scores_frozen_at),
    });
    this.trainingRepository = new SqliteTrainingRepository({
      select: <T>(query: string, bindValues?: unknown[]) => this.db.select<T>(query, bindValues),
      executeWrite: (query: string, bindValues?: unknown[]) => this.executeWrite(query, bindValues),
    });
    this.aiCenterRepository = new SqliteAiCenterRepository({
      select: <T>(query: string, bindValues?: unknown[]) => this.db.select<T>(query, bindValues),
      executeWrite: (query: string, bindValues?: unknown[]) => this.executeWrite(query, bindValues),
      executeTransaction: (statements) => this.executeTransaction(statements),
    });
    this.monitorRepository = new SqliteMonitorRepository({
      select: <T>(query: string, bindValues?: unknown[]) => this.db.select<T>(query, bindValues),
      executeWrite: (query: string, bindValues?: unknown[]) => this.executeWrite(query, bindValues),
    });
  }

  static async connect(): Promise<SqliteRepository> {
    const db = await Database.load("sqlite:rv_harness.db");
    const repository = new SqliteRepository(db);
    // WAL keeps readers responsive while the single coordinated writer persists evidence.
    await repository.writes.run(() => db.select("PRAGMA journal_mode = WAL"));
    return repository;
  }

  private executeWrite(query: string, bindValues?: unknown[]) {
    return this.writes.run(() => this.db.execute(query, bindValues));
  }

  private executeTransaction(statements: DatabaseTransactionStatement[]) {
    return this.writes.run(() => executeDatabaseTransaction(statements));
  }

  async createDatabaseSnapshot(destinationPath: string): Promise<void> {
    await this.executeWrite("VACUUM INTO $1", [destinationPath]);
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

  createTrainingRun: AppRepository["createTrainingRun"] = (input) => this.trainingRepository.createTrainingRun(input);
  updateTrainingRun: AppRepository["updateTrainingRun"] = (id, input) => this.trainingRepository.updateTrainingRun(id, input);
  listTrainingRuns: AppRepository["listTrainingRuns"] = () => this.trainingRepository.listTrainingRuns();

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
    const prior = await this.db.select<Array<{ latest: string | null }>>("SELECT MAX(archived_at) AS latest FROM workspaces WHERE profile_id = $1", [id]);
    const latest = prior[0]?.latest ? Date.parse(prior[0].latest) : 0;
    const timestamp = new Date(Math.max(Date.now(), (Number.isFinite(latest) ? latest : 0) + 1)).toISOString();
    await this.executeTransaction([
      { query: "UPDATE workspaces SET archived_at = $1, updated_at = $1 WHERE profile_id = $2 AND archived_at IS NULL", values: [timestamp, id] },
      { query: "UPDATE profiles SET archived_at = $1, updated_at = $1 WHERE id = $2 AND archived_at IS NULL", values: [timestamp, id] },
    ]);
  }

  async restoreProfile(id: string): Promise<void> {
    const rows = await this.db.select<Array<{ archived_at: string }>>("SELECT archived_at FROM profiles WHERE id = $1 AND archived_at IS NOT NULL", [id]);
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
    const rows = await this.db.select<WorkspaceSourceRow[]>(
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
    const rows = await this.db.select<{ source_id: string }[]>("SELECT source_id FROM chat_thread_sources WHERE thread_id = $1 AND active = 1", [threadId]);
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
  createTarget: AppRepository["createTarget"] = (input) => this.targetsRepository.createTarget(input);
  updateTarget: AppRepository["updateTarget"] = (id, input) => this.targetsRepository.updateTarget(id, input);
  deleteTarget: AppRepository["deleteTarget"] = (id) => this.targetsRepository.deleteTarget(id);
  recordTargetUsage: AppRepository["recordTargetUsage"] = (input) => this.targetsRepository.recordTargetUsage(input);
  listTargetUsage: AppRepository["listTargetUsage"] = () => this.targetsRepository.listTargetUsage();

  async listCustomProtocols(language?: "pl" | "en"): Promise<CustomProtocolVersion[]> {
    const rows = language
      ? await this.db.select<CustomProtocolRow[]>(
          `SELECT p.id AS protocol_id, pv.id AS version_id, p.display_name, pv.version, pv.language,
                  pv.content, pv.ordered_steps_json, pv.content_hash, pv.source_metadata_json, pv.created_at
             FROM protocols p JOIN protocol_versions pv ON pv.protocol_id = p.id
            WHERE p.family = 'custom' AND pv.language = $1 ORDER BY p.display_name, pv.created_at DESC`,
          [language],
        )
      : await this.db.select<CustomProtocolRow[]>(
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
    const existing = await this.db.select<{ id: string }[]>("SELECT id FROM protocols WHERE id = $1", [input.protocolId]);
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
    const timestamp = nowIso();
    const statements: DatabaseTransactionStatement[] = [];
    const records = results.map(({ run, score }) => {
      const total = computeJudgeTotal(score);
      statements.push({
        query: `INSERT INTO judge_runs
         (id, session_id, judge_index, model_route, rubric_version, anonymous_session_id, packet_hash, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        values: [run.id, run.sessionId, run.judgeIndex, run.modelRoute, run.rubricVersion, run.anonymousSessionId, run.packetHash, timestamp],
      });
      statements.push({
        query: `INSERT INTO judge_scores
         (id, judge_run_id, gestalt, verifiable_features, activity_function_event, confabulation_control,
          total, rationale_json, frozen_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
        values: [score.id, score.judgeRunId, score.gestalt, score.verifiableFeatures, score.activityFunctionEvent, score.confabulationControl, total, JSON.stringify(score.narrative), timestamp],
      });
      return { ...score, judgeIndex: run.judgeIndex, modelRoute: run.modelRoute, total, frozenAt: timestamp, createdAt: timestamp };
    });
    await this.executeTransaction(statements);
    return records;
  }

  async listJudgeScores(sessionId: string): Promise<JudgeScoreRecord[]> {
    const rows = await this.db.select<JudgeScoreRow[]>(
      `SELECT s.id, s.judge_run_id, r.judge_index, r.model_route, s.gestalt, s.verifiable_features,
              s.activity_function_event, s.confabulation_control, s.total, s.rationale_json,
              s.frozen_at, s.created_at
         FROM judge_scores s JOIN judge_runs r ON r.id = s.judge_run_id
        WHERE r.session_id = $1 ORDER BY r.judge_index`,
      [sessionId],
    );
    return rows.map((row) => ({
      id: row.id,
      judgeRunId: row.judge_run_id,
      judgeIndex: row.judge_index,
      modelRoute: row.model_route,
      gestalt: row.gestalt,
      verifiableFeatures: row.verifiable_features,
      activityFunctionEvent: row.activity_function_event,
      confabulationControl: row.confabulation_control,
      total: row.total,
      narrative: JSON.parse(row.rationale_json) as JudgeNarrative,
      frozenAt: row.frozen_at,
      createdAt: row.created_at,
    }));
  }

  async createResearchProject(config: ResearchConfig): Promise<ResearchProjectRecord> {
    const timestamp = nowIso();
    const project: ResearchProjectRecord = {
      id: createId("research"), workspaceId: config.workspaceId, name: config.name.trim(), templateType: config.templateType,
      state: "Draft", config: structuredClone(config), createdAt: timestamp, updatedAt: timestamp,
    };
    await this.executeWrite(
      `INSERT INTO research_projects (id, workspace_id, name, template_type, state, config_json, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Draft', $5, $6, $6)`,
      [project.id, project.workspaceId, project.name, project.templateType, JSON.stringify(project.config), timestamp],
    );
    return project;
  }

  async getResearchProject(id: string): Promise<ResearchProjectRecord | null> {
    const rows = await this.db.select<ResearchProjectRow[]>(
      `SELECT id, workspace_id, name, template_type, state, config_json, config_hash, locked_at,
              scores_frozen_at, unblinded_at, created_at, updated_at FROM research_projects WHERE id = $1 LIMIT 1`, [id],
    );
    return rows[0] ? mapResearchProject(rows[0]) : null;
  }

  async listResearchProjects(workspaceId?: string): Promise<ResearchProjectRecord[]> {
    const rows = workspaceId
      ? await this.db.select<ResearchProjectRow[]>(`SELECT id, workspace_id, name, template_type, state, config_json, config_hash, locked_at, scores_frozen_at, unblinded_at, created_at, updated_at FROM research_projects WHERE workspace_id = $1 ORDER BY created_at DESC`, [workspaceId])
      : await this.db.select<ResearchProjectRow[]>(`SELECT id, workspace_id, name, template_type, state, config_json, config_hash, locked_at, scores_frozen_at, unblinded_at, created_at, updated_at FROM research_projects ORDER BY created_at DESC`);
    return rows.map(mapResearchProject);
  }

  async setResearchProjectState(id: string, state: ResearchState): Promise<void> {
    const timestamp = nowIso();
    await this.executeWrite(
      `UPDATE research_projects SET state = $1, updated_at = $2,
         scores_frozen_at = CASE WHEN $1 = 'ScoresFrozen' THEN COALESCE(scores_frozen_at, $2) ELSE scores_frozen_at END,
         unblinded_at = CASE WHEN $1 = 'Unblinded' THEN COALESCE(unblinded_at, $2) ELSE unblinded_at END
       WHERE id = $3`,
      [state, timestamp, id],
    );
  }

  async lockResearchProject(id: string, plan: ResearchLockPlan): Promise<void> {
    const timestamp = nowIso();
    const projectState = await this.db.select<{ state: ResearchState }[]>("SELECT state FROM research_projects WHERE id = $1", [id]);
    if (!projectState[0] || !["Draft", "Preflight"].includes(projectState[0].state)) throw new Error("Research project cannot be locked from its current state.");
    const statements: DatabaseTransactionStatement[] = plan.conditions.map((condition) => ({
      query: "INSERT INTO research_conditions (id, research_project_id, condition_key, condition_config_json) VALUES ($1, $2, $3, $4)",
      values: [condition.id, id, condition.conditionKey, JSON.stringify(condition.config)],
    }));
    statements.push(...plan.assignments.map((assignment) => ({
      query: `INSERT INTO research_assignments (id, research_project_id, anonymous_session_id, session_id, target_id, execution_order, judge_order, status)
           VALUES ($1, $2, $3, NULL, $4, $5, $6, $7)`,
      values: [assignment.id, id, assignment.anonymousSessionId, assignment.targetId, assignment.executionOrder, assignment.judgeOrder, assignment.status],
    })));
    statements.push(...plan.mappings.map((mapping) => ({
      query: `INSERT INTO blinding_mappings (id, research_project_id, anonymous_session_id, condition_id, pair_key, pair_order, mapping_hash, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      values: [mapping.id, id, mapping.anonymousSessionId, mapping.conditionId, mapping.pairKey, mapping.pairOrder ?? null, mapping.mappingHash, mapping.createdAt],
    })));
    statements.push({
      query: "UPDATE research_projects SET state = 'Locked', config_hash = $1, locked_at = $2, updated_at = $2 WHERE id = $3 AND state IN ('Draft','Preflight')",
      values: [plan.configHash, timestamp, id],
    });
    await this.executeTransaction(statements);
  }

  async listResearchConditions(projectId: string): Promise<ResearchConditionRecord[]> {
    const rows = await this.db.select<Array<{ id: string; research_project_id: string; condition_key: string; condition_config_json: string }>>(
      `SELECT id, research_project_id, condition_key, condition_config_json FROM research_conditions WHERE research_project_id = $1 ORDER BY condition_key`, [projectId],
    );
    return rows.map((row) => ({ id: row.id, researchProjectId: row.research_project_id, conditionKey: row.condition_key, config: JSON.parse(row.condition_config_json) as ResearchConditionRecord["config"] }));
  }

  async listResearchAssignments(projectId: string): Promise<ResearchAssignmentRecord[]> {
    const rows = await this.db.select<Array<{ id: string; research_project_id: string; anonymous_session_id: string; session_id: string | null; target_id: string | null; execution_order: number; judge_order: number | null; status: string }>>(
      `SELECT id, research_project_id, anonymous_session_id, session_id, target_id, execution_order, judge_order, status FROM research_assignments WHERE research_project_id = $1 ORDER BY execution_order`, [projectId],
    );
    return rows.map((row) => {
      if (!row.target_id || row.judge_order === null) throw new Error("Locked Research assignment is incomplete.");
      return { id: row.id, researchProjectId: row.research_project_id, anonymousSessionId: row.anonymous_session_id, sessionId: row.session_id ?? undefined, targetId: row.target_id, executionOrder: row.execution_order, judgeOrder: row.judge_order, status: row.status };
    });
  }

  async listBlindingMappings(projectId: string): Promise<BlindingMappingRecord[]> {
    const rows = await this.db.select<Array<{ id: string; research_project_id: string; anonymous_session_id: string; condition_id: string; pair_key: string | null; pair_order: string | null; mapping_hash: string; created_at: string }>>(
      `SELECT id, research_project_id, anonymous_session_id, condition_id, pair_key, pair_order, mapping_hash, created_at FROM blinding_mappings WHERE research_project_id = $1`, [projectId],
    );
    return rows.map((row) => ({ id: row.id, researchProjectId: row.research_project_id, anonymousSessionId: row.anonymous_session_id, conditionId: row.condition_id, pairKey: row.pair_key ?? "", pairOrder: row.pair_order ?? undefined, mappingHash: row.mapping_hash, createdAt: row.created_at }));
  }

  async updateResearchAssignment(id: string, sessionId: string | undefined, status: string): Promise<void> {
    await this.executeWrite("UPDATE research_assignments SET session_id = $1, status = $2 WHERE id = $3", [sessionId ?? null, status, id]);
  }

  async saveResearchResults(projectId: string, results: ResearchResults, hash: string): Promise<void> {
    const existing = await this.db.select<{ id: string }[]>("SELECT id FROM research_results WHERE research_project_id = $1 LIMIT 1", [projectId]);
    if (existing.length) throw new Error("Research results are immutable once written.");
    await this.executeWrite(
      `INSERT INTO research_results (id, research_project_id, results_json, results_hash, created_at) VALUES ($1, $2, $3, $4, $5)`,
      [createId("research_results"), projectId, JSON.stringify(results), hash, nowIso()],
    );
  }

  async getResearchResults(projectId: string): Promise<ResearchResults | null> {
    const rows = await this.db.select<{ results_json: string }[]>("SELECT results_json FROM research_results WHERE research_project_id = $1 ORDER BY created_at DESC LIMIT 1", [projectId]);
    return rows[0] ? JSON.parse(rows[0].results_json) as ResearchResults : null;
  }

  async recordExport(workspaceId: string, researchProjectId: string | undefined, exportType: string, artifactPath: string, manifestHash: string): Promise<void> {
    await this.executeWrite(
      `INSERT INTO exports (id, workspace_id, research_project_id, export_type, artifact_path, manifest_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [createId("export"), workspaceId, researchProjectId ?? null, exportType, artifactPath, manifestHash, nowIso()],
    );
  }
}
