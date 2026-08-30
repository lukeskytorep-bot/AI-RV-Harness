import Database from "@tauri-apps/plugin-sql";
import type { AppSettings, ChatMessage, ChatMode, ChatThread, ChatThreadGroup, CreateProfileInput, CreateWorkspaceInput, Profile, ProfileAiConfigurationInput, UpdateProfileInput, Workspace } from "../types";
import type { CreateProviderConfigInput, ProviderConfig, ProviderKind, ProviderModel } from "../providers/types";
import type { CreateRvSessionInput, RevealInput, RvSession, RvSessionState, SessionEventInput, SessionEventRecord, SessionSnapshot, TargetClarificationRecord } from "../sessions/types";
import type { CreateMonitorRunInput, MonitorInterventionInput, MonitorInterventionRecord, MonitorRunRecord } from "../monitor/types";
import type { CreateJudgeRunInput, FrozenJudgeResultInput, FrozenJudgeScoreInput, JudgeNarrative, JudgeScoreRecord } from "../judge/types";
import { computeJudgeTotal } from "../domain/scoring";
import type { CreateTargetInput, TargetRecord, TargetUsageInput, TargetUsageRecord, UpdateTargetInput } from "../targets/types";
import type { CustomProtocolVersion, SaveCustomProtocolVersionInput } from "../protocols/types";
import type { BlindingMappingRecord, ResearchAssignmentRecord, ResearchConditionRecord, ResearchConfig, ResearchLockPlan, ResearchProjectRecord, ResearchResults, ResearchState, ResearchTemplateType } from "../research/types";
import type { CreateWorkspaceSourceInput, WorkspaceSource } from "../sources/types";
import type { AppRepository } from "./repository";
import { createId, nowIso } from "./repository";
import { serializePostRevealTurn } from "../sessions/postRevealTranscript";
import { verifySealedViewerEvidence } from "../sessions/evidence";
import type { ReasoningEffort } from "../providers/types";
import { executeDatabaseTransaction, type DatabaseTransactionStatement } from "./databaseNative";
import { SqliteWriteCoordinator } from "./sqliteWriteCoordinator";
import { applyReasoningRegistryToProviderModel } from "../providers/modelReasoningRegistry";
import type { CreateTrainingRunInput, TrainingRunRecord, UpdateTrainingRunInput } from "../training/types";
import type { AiIdentity, BeginViewerNoteReflectionInput, CommitViewerNoteReflectionInput, EnsureAiIdentityInput, ViewerNoteActivationEvent, ViewerNoteBundle, ViewerNoteCapacity, ViewerNoteReflectionResult, ViewerNoteReflectionRun, ViewerNoteSettings, ViewerNoteVersion } from "../aiCenter/types";

type ProfileRow = {
  id: string;
  display_name: string;
  human_display_name: string | null;
  note: string | null;
  credential_id: string | null;
  credential_provider: string | null;
  default_viewer_model_id: string | null;
  default_viewer_reasoning_effort: ReasoningEffort | null;
  default_viewer_temperature: number | null;
  default_viewer_system_prompt: string | null;
  default_monitor_system_prompt: string | null;
  default_monitor_provider_config_id: string | null;
  default_monitor_model_id: string | null;
  default_judge_provider_config_id: string | null;
  default_judge_model_id: string | null;
  created_at: string;
  updated_at: string;
};

type WorkspaceRow = {
  id: string;
  profile_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  last_opened_at: string;
};

type ProviderConfigRow = {
  id: string;
  provider: ProviderKind;
  label: string;
  credential_id: string;
  credential_hint: string | null;
  credential_fingerprint: string | null;
  base_url: string | null;
  enabled: number;
  last_tested_at: string | null;
  last_status: "ok" | "error" | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

type ProviderModelRow = {
  provider_config_id: string;
  provider: ProviderKind;
  model_id: string;
  display_name: string;
  route: string;
  capability_json: string;
  pricing_json: string;
  recommended: number;
  favorite: number;
  raw_metadata_json: string;
  refreshed_at: string;
};

type RvSessionRow = {
  id: string;
  workspace_id: string;
  profile_id: string;
  session_code: string;
  state: RvSessionState;
  run_type: RvSession["runType"];
  pre_reveal_transcript: string;
  pre_reveal_hash: string | null;
  pre_reveal_sealed_at: string | null;
  post_reveal_transcript: string;
  target_id: string | null;
  research_project_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type ChatThreadGroupRow = { id: string; workspace_id: string; mode: ChatMode; title: string; created_at: string; updated_at: string; archived_at: string | null };
type ChatThreadRow = { id: string; workspace_id: string; mode: ChatMode; thread_group_id: string | null; title: string; formal_rv_state: ChatThread["formalRvState"] | null; created_at: string; updated_at: string; archived_at: string | null };
type ChatMessageRow = { id: string; thread_id: string; role: "user" | "assistant"; content: string; created_at: string };
type WorkspaceSourceRow = { id: string; workspace_id: string; source_type: "text" | "markdown" | "pdf" | "docx"; display_name: string; content_text: string | null; content_hash: string | null; metadata_json: string; created_at: string };
type RevealRow = { reveal_source: RevealInput["source"]; reveal_text: string | null; artifact_manifest_json: string; reveal_hash: string };
type SessionEventRow = { id: string; session_id: string; sequence_number: number; event_type: string; role: SessionEventRecord["role"] | null; content: string | null; metadata_json: string; created_at: string };
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
type TargetRow = {
  id: string;
  collection: TargetRecord["collection"];
  title: string;
  reveal_text: string | null;
  reveal_artifact_path: string | null;
  reveal_artifact_manifest_json: string;
  tags_json: string;
  source_metadata_json: string;
  content_hash: string | null;
  created_at: string;
  updated_at: string;
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

type AiIdentityRow = {
  id: string; profile_id: string; credential_fingerprint: string; credential_display: string; provider_config_id: string;
  provider: ProviderKind; normalized_base_url: string; model_id: string; model_route: string; model_display_name: string;
  role: AiIdentity["role"]; route_status: AiIdentity["routeStatus"]; first_used_at: string; last_used_at: string; created_at: string; updated_at: string;
};
type ViewerNoteSettingsRow = { ai_identity_id: string; note_type: "viewer_self_notes"; capacity_tokens: ViewerNoteCapacity; default_enabled: number; active_version_id: string | null; experimental_status: "experimental"; updated_at: string };
type ViewerNoteVersionRow = {
  id: string; ai_identity_id: string; version_number: number; content: string; content_sha256: string; estimated_tokens: number;
  estimator_version: "conservative-char-v1"; capacity_tokens_at_creation: ViewerNoteCapacity; source_session_id: string; source_workspace_id: string;
  protocol_id: string; session_run_type: string; change_summary: string; base_version_id: string | null; base_content_sha256: string | null;
  reflection_run_id: string; reflection_packet_sha256: string; model_route_snapshot: string; generation_settings_json: string;
  upstream_provider_snapshot: string | null; created_at: string;
};
type ViewerNoteReflectionRunRow = {
  id: string; ai_identity_id: string; note_type: "viewer_self_notes"; source_session_id: string; source_workspace_id: string;
  base_version_id: string | null; base_content_sha256: string | null; reflection_packet_sha256: string; packet_json: string;
  attempt_count: number; status: ViewerNoteReflectionRun["status"]; provider_request_id: string | null; raw_final_response_sha256: string | null;
  change_summary: string | null; failure_message: string | null; created_at: string; completed_at: string | null;
};
type ViewerNoteActivationRow = { id: string; ai_identity_id: string; from_version_id: string | null; to_version_id: string; activation_source: ViewerNoteActivationEvent["activationSource"]; workspace_id: string | null; source_session_id: string | null; created_at: string };

function mapAiIdentity(row: AiIdentityRow): AiIdentity {
  return { id: row.id, profileId: row.profile_id, credentialFingerprint: row.credential_fingerprint, credentialDisplay: row.credential_display,
    providerConfigId: row.provider_config_id, provider: row.provider, ...(row.normalized_base_url ? { normalizedBaseUrl: row.normalized_base_url } : {}),
    modelId: row.model_id, modelRoute: row.model_route, modelDisplayName: row.model_display_name, role: row.role, routeStatus: row.route_status,
    firstUsedAt: row.first_used_at, lastUsedAt: row.last_used_at, createdAt: row.created_at, updatedAt: row.updated_at };
}
function mapViewerNoteSettings(row: ViewerNoteSettingsRow): ViewerNoteSettings {
  return { aiIdentityId: row.ai_identity_id, noteType: row.note_type, capacityTokens: Number(row.capacity_tokens) as ViewerNoteCapacity,
    defaultEnabled: row.default_enabled === 1, ...(row.active_version_id ? { activeVersionId: row.active_version_id } : {}), experimentalStatus: row.experimental_status, updatedAt: row.updated_at };
}
function mapViewerNoteVersion(row: ViewerNoteVersionRow): ViewerNoteVersion {
  return { id: row.id, aiIdentityId: row.ai_identity_id, versionNumber: Number(row.version_number), content: row.content, contentSha256: row.content_sha256,
    estimatedTokens: Number(row.estimated_tokens), estimatorVersion: row.estimator_version, capacityTokensAtCreation: Number(row.capacity_tokens_at_creation) as ViewerNoteCapacity,
    sourceSessionId: row.source_session_id, sourceWorkspaceId: row.source_workspace_id, protocolId: row.protocol_id, sessionRunType: row.session_run_type,
    changeSummary: row.change_summary, ...(row.base_version_id ? { baseVersionId: row.base_version_id } : {}), ...(row.base_content_sha256 ? { baseContentSha256: row.base_content_sha256 } : {}),
    reflectionRunId: row.reflection_run_id, reflectionPacketSha256: row.reflection_packet_sha256, modelRouteSnapshot: row.model_route_snapshot,
    generationSettingsSnapshot: JSON.parse(row.generation_settings_json), ...(row.upstream_provider_snapshot ? { upstreamProviderSnapshot: row.upstream_provider_snapshot } : {}), createdAt: row.created_at };
}
function mapViewerNoteReflectionRun(row: ViewerNoteReflectionRunRow): ViewerNoteReflectionRun {
  return { id: row.id, aiIdentityId: row.ai_identity_id, noteType: row.note_type, sourceSessionId: row.source_session_id, sourceWorkspaceId: row.source_workspace_id,
    ...(row.base_version_id ? { baseVersionId: row.base_version_id } : {}), ...(row.base_content_sha256 ? { baseContentSha256: row.base_content_sha256 } : {}),
    reflectionPacketSha256: row.reflection_packet_sha256, packetJson: row.packet_json, attemptCount: Number(row.attempt_count), status: row.status,
    ...(row.provider_request_id ? { providerRequestId: row.provider_request_id } : {}), ...(row.raw_final_response_sha256 ? { rawFinalResponseSha256: row.raw_final_response_sha256 } : {}),
    ...(row.change_summary ? { changeSummary: row.change_summary } : {}), ...(row.failure_message ? { failureMessage: row.failure_message } : {}), createdAt: row.created_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}) };
}
function mapViewerNoteActivation(row: ViewerNoteActivationRow): ViewerNoteActivationEvent {
  return { id: row.id, aiIdentityId: row.ai_identity_id, ...(row.from_version_id ? { fromVersionId: row.from_version_id } : {}), toVersionId: row.to_version_id,
    activationSource: row.activation_source, ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}), ...(row.source_session_id ? { sourceSessionId: row.source_session_id } : {}), createdAt: row.created_at };
}

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

function mapProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    name: row.display_name,
    humanName: row.human_display_name ?? undefined,
    note: row.note ?? undefined,
    credentialId: row.credential_id ?? undefined,
    credentialProvider: row.credential_provider ?? undefined,
    defaultViewerModelId: row.default_viewer_model_id ?? undefined,
    defaultViewerReasoningEffort: row.default_viewer_reasoning_effort ?? undefined,
    defaultViewerTemperature: row.default_viewer_temperature ?? undefined,
    defaultViewerSystemPrompt: row.default_viewer_system_prompt ?? undefined,
    defaultMonitorSystemPrompt: row.default_monitor_system_prompt ?? undefined,
    defaultMonitorProviderConfigId: row.default_monitor_provider_config_id ?? undefined,
    defaultMonitorModelId: row.default_monitor_model_id ?? undefined,
    defaultJudgeProviderConfigId: row.default_judge_provider_config_id ?? undefined,
    defaultJudgeModelId: row.default_judge_model_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    description: row.description ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastOpenedAt: row.last_opened_at,
  };
}

function mapProviderConfig(row: ProviderConfigRow): ProviderConfig {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    credentialId: row.credential_id,
    credentialHint: row.credential_hint ?? undefined,
    credentialFingerprint: row.credential_fingerprint ?? undefined,
    baseUrl: row.base_url ?? undefined,
    enabled: row.enabled === 1,
    lastTestedAt: row.last_tested_at ?? undefined,
    lastStatus: row.last_status ?? undefined,
    lastError: row.last_error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProviderModel(row: ProviderModelRow): ProviderModel {
  return applyReasoningRegistryToProviderModel({
    providerConfigId: row.provider_config_id,
    provider: row.provider,
    modelId: row.model_id,
    displayName: row.display_name,
    route: row.route,
    capabilities: JSON.parse(row.capability_json) as ProviderModel["capabilities"],
    pricing: JSON.parse(row.pricing_json) as ProviderModel["pricing"],
    recommended: row.recommended === 1,
    favorite: row.favorite === 1,
    rawMetadata: JSON.parse(row.raw_metadata_json) as ProviderModel["rawMetadata"],
    refreshedAt: row.refreshed_at,
  });
}

function mapRvSession(row: RvSessionRow): RvSession {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    profileId: row.profile_id,
    sessionCode: row.session_code,
    state: row.state,
    runType: row.run_type,
    preRevealTranscript: row.pre_reveal_transcript,
    preRevealHash: row.pre_reveal_hash ?? undefined,
    preRevealSealedAt: row.pre_reveal_sealed_at ?? undefined,
    postRevealTranscript: row.post_reveal_transcript,
    targetId: row.target_id ?? undefined,
    researchProjectId: row.research_project_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
  };
}

function mapChatThread(row: ChatThreadRow): ChatThread {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    mode: row.mode,
    ...(row.thread_group_id ? { threadGroupId: row.thread_group_id } : {}),
    title: row.title,
    ...(row.formal_rv_state ? { formalRvState: row.formal_rv_state } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.archived_at ? { archivedAt: row.archived_at } : {}),
  };
}

function mapChatThreadGroup(row: ChatThreadGroupRow): ChatThreadGroup {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    mode: row.mode,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.archived_at ? { archivedAt: row.archived_at } : {}),
  };
}

export class SqliteRepository implements AppRepository {
  private readonly writes = new SqliteWriteCoordinator();

  private constructor(private readonly db: Database) {}

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

  async ensureAiIdentity(input: EnsureAiIdentityInput): Promise<AiIdentity> {
    const normalizedBaseUrl = input.baseUrl?.trim().replace(/\/+$/, "").toLowerCase() ?? "";
    const rows = await this.db.select<AiIdentityRow[]>(
      `SELECT * FROM ai_identities WHERE profile_id = $1 AND credential_fingerprint = $2 AND provider = $3
       AND normalized_base_url = $4 AND model_route = $5 AND role = $6 LIMIT 1`,
      [input.profileId, input.credentialFingerprint, input.provider, normalizedBaseUrl, input.modelRoute, input.role],
    );
    const timestamp = nowIso();
    if (rows[0]) {
      await this.executeWrite(`UPDATE ai_identities SET credential_display = $1, provider_config_id = $2, model_id = $3,
        model_display_name = $4, route_status = 'available', last_used_at = $5, updated_at = $5 WHERE id = $6`,
      [input.credentialDisplay, input.providerConfigId, input.modelId, input.modelDisplayName, timestamp, rows[0].id]);
      return { ...mapAiIdentity(rows[0]), credentialDisplay: input.credentialDisplay, providerConfigId: input.providerConfigId, modelId: input.modelId, modelDisplayName: input.modelDisplayName, routeStatus: "available", lastUsedAt: timestamp, updatedAt: timestamp };
    }
    const identity: AiIdentity = { id: createId("ai_identity"), profileId: input.profileId, credentialFingerprint: input.credentialFingerprint,
      credentialDisplay: input.credentialDisplay, providerConfigId: input.providerConfigId, provider: input.provider,
      ...(normalizedBaseUrl ? { normalizedBaseUrl } : {}), modelId: input.modelId, modelRoute: input.modelRoute, modelDisplayName: input.modelDisplayName,
      role: input.role, routeStatus: "available", firstUsedAt: timestamp, lastUsedAt: timestamp, createdAt: timestamp, updatedAt: timestamp };
    const statements: DatabaseTransactionStatement[] = [{ query: `INSERT INTO ai_identities
      (id, profile_id, credential_fingerprint, credential_display, provider_config_id, provider, normalized_base_url, model_id, model_route,
       model_display_name, role, route_status, first_used_at, last_used_at, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'available',$12,$12,$12,$12)`,
      values: [identity.id, identity.profileId, identity.credentialFingerprint, identity.credentialDisplay, identity.providerConfigId, identity.provider,
        normalizedBaseUrl, identity.modelId, identity.modelRoute, identity.modelDisplayName, identity.role, timestamp] }];
    if (input.role === "viewer") statements.push({ query: `INSERT INTO ai_note_settings
      (ai_identity_id, note_type, capacity_tokens, default_enabled, experimental_status, updated_at)
      VALUES ($1,'viewer_self_notes',1024,1,'experimental',$2)`, values: [identity.id, timestamp] });
    await this.executeTransaction(statements);
    return identity;
  }

  async listAiIdentities(profileId: string): Promise<AiIdentity[]> {
    const rows = await this.db.select<AiIdentityRow[]>("SELECT * FROM ai_identities WHERE profile_id = $1 ORDER BY last_used_at DESC", [profileId]);
    return rows.map(mapAiIdentity);
  }

  async getViewerNoteBundle(aiIdentityId: string): Promise<ViewerNoteBundle | null> {
    const identities = await this.db.select<AiIdentityRow[]>("SELECT * FROM ai_identities WHERE id = $1 LIMIT 1", [aiIdentityId]);
    if (!identities[0]) return null;
    const settingsRows = await this.db.select<ViewerNoteSettingsRow[]>("SELECT * FROM ai_note_settings WHERE ai_identity_id = $1 LIMIT 1", [aiIdentityId]);
    if (!settingsRows[0]) return null;
    const settings = mapViewerNoteSettings(settingsRows[0]);
    const versions = await this.listViewerNoteVersions(aiIdentityId);
    return { identity: mapAiIdentity(identities[0]), settings, activeVersion: versions.find((item) => item.id === settings.activeVersionId), versions,
      activationEvents: await this.listViewerNoteActivationEvents(aiIdentityId), reflectionRuns: await this.listViewerNoteReflectionRuns(aiIdentityId) };
  }

  async listViewerNoteVersions(aiIdentityId: string): Promise<ViewerNoteVersion[]> {
    const rows = await this.db.select<ViewerNoteVersionRow[]>("SELECT * FROM ai_note_versions WHERE ai_identity_id = $1 ORDER BY version_number DESC", [aiIdentityId]);
    return rows.map(mapViewerNoteVersion);
  }

  async listViewerNoteActivationEvents(aiIdentityId: string): Promise<ViewerNoteActivationEvent[]> {
    const rows = await this.db.select<ViewerNoteActivationRow[]>("SELECT * FROM ai_note_activation_events WHERE ai_identity_id = $1 ORDER BY created_at DESC", [aiIdentityId]);
    return rows.map(mapViewerNoteActivation);
  }

  async listViewerNoteReflectionRuns(aiIdentityId: string): Promise<ViewerNoteReflectionRun[]> {
    const rows = await this.db.select<ViewerNoteReflectionRunRow[]>("SELECT * FROM ai_note_reflection_runs WHERE ai_identity_id = $1 ORDER BY created_at DESC", [aiIdentityId]);
    return rows.map(mapViewerNoteReflectionRun);
  }

  async setViewerNoteCapacity(aiIdentityId: string, capacityTokens: ViewerNoteCapacity): Promise<void> {
    const rows = await this.db.select<Array<{ estimated_tokens: number | null }>>(`SELECT v.estimated_tokens FROM ai_note_settings s
      LEFT JOIN ai_note_versions v ON v.id = s.active_version_id WHERE s.ai_identity_id = $1`, [aiIdentityId]);
    if (!rows.length) throw new Error("Viewer Notes settings not found.");
    if (rows[0].estimated_tokens !== null && Number(rows[0].estimated_tokens) > capacityTokens) throw new Error(`Capacity cannot be reduced below the active notes size (${rows[0].estimated_tokens} estimated tokens).`);
    await this.executeWrite("UPDATE ai_note_settings SET capacity_tokens = $1, updated_at = $2 WHERE ai_identity_id = $3", [capacityTokens, nowIso(), aiIdentityId]);
  }

  async setViewerNotesDefaultEnabled(aiIdentityId: string, enabled: boolean): Promise<void> {
    await this.executeWrite("UPDATE ai_note_settings SET default_enabled = $1, updated_at = $2 WHERE ai_identity_id = $3", [enabled ? 1 : 0, nowIso(), aiIdentityId]);
  }

  async beginViewerNoteReflection(input: BeginViewerNoteReflectionInput): Promise<ViewerNoteReflectionRun> {
    const existing = await this.db.select<ViewerNoteReflectionRunRow[]>("SELECT * FROM ai_note_reflection_runs WHERE id = $1 OR (ai_identity_id = $2 AND source_session_id = $3) LIMIT 1", [input.id, input.aiIdentityId, input.sourceSessionId]);
    if (existing[0]) return mapViewerNoteReflectionRun(existing[0]);
    const createdAt = nowIso();
    await this.executeWrite(`INSERT INTO ai_note_reflection_runs
      (id, ai_identity_id, note_type, source_session_id, source_workspace_id, base_version_id, base_content_sha256,
       reflection_packet_sha256, packet_json, attempt_count, status, created_at)
      VALUES ($1,$2,'viewer_self_notes',$3,$4,$5,$6,$7,$8,0,'PENDING',$9)`,
    [input.id, input.aiIdentityId, input.sourceSessionId, input.sourceWorkspaceId, input.baseVersionId ?? null, input.baseContentSha256 ?? null, input.reflectionPacketSha256, input.packetJson, createdAt]);
    return { ...input, noteType: "viewer_self_notes", attemptCount: 0, status: "PENDING", createdAt };
  }

  async failViewerNoteReflection(runId: string, status: Exclude<ViewerNoteReflectionRun["status"], "PENDING" | "UPDATE" | "NO_CHANGE" | "STALE_BASE">, failureMessage: string, providerRequestId?: string, rawFinalResponseSha256?: string): Promise<void> {
    await this.executeWrite(`UPDATE ai_note_reflection_runs SET status = $1, failure_message = $2, attempt_count = attempt_count + 1,
      provider_request_id = COALESCE($3, provider_request_id), raw_final_response_sha256 = COALESCE($4, raw_final_response_sha256), completed_at = $5 WHERE id = $6`,
    [status, failureMessage, providerRequestId ?? null, rawFinalResponseSha256 ?? null, nowIso(), runId]);
  }

  async commitViewerNoteReflection(input: CommitViewerNoteReflectionInput): Promise<ViewerNoteReflectionResult> {
    const existingRuns = await this.db.select<ViewerNoteReflectionRunRow[]>("SELECT * FROM ai_note_reflection_runs WHERE id = $1 LIMIT 1", [input.runId]);
    const run = existingRuns[0];
    if (!run) throw new Error("Viewer Notes reflection run not found.");
    if (run.status === "UPDATE") {
      const versions = await this.db.select<ViewerNoteVersionRow[]>("SELECT * FROM ai_note_versions WHERE reflection_run_id = $1 LIMIT 1", [input.runId]);
      return { status: "UPDATE", ...(versions[0] ? { version: mapViewerNoteVersion(versions[0]) } : {}) };
    }
    if (run.status === "NO_CHANGE") return { status: "NO_CHANGE" };
    const completedAt = nowIso();
    if (input.decision === "NO_CHANGE") {
      await this.executeWrite(`UPDATE ai_note_reflection_runs SET status = 'NO_CHANGE', attempt_count = attempt_count + 1, change_summary = $1,
        provider_request_id = $2, raw_final_response_sha256 = $3, completed_at = $4 WHERE id = $5`,
      [input.changeSummary, input.providerRequestId ?? null, input.rawFinalResponseSha256, completedAt, input.runId]);
      return { status: "NO_CHANGE" };
    }
    if (!input.notes || !input.contentSha256 || input.estimatedTokens === undefined) throw new Error("Complete Viewer Notes are required for UPDATE.");
    const numberRows = await this.db.select<Array<{ next_number: number }>>("SELECT COALESCE(MAX(version_number),0)+1 AS next_number FROM ai_note_versions WHERE ai_identity_id = $1", [input.aiIdentityId]);
    const versionId = createId("ai_note_version");
    const activationId = createId("ai_note_activation");
    const activationSource = input.baseVersionId ? "model_update" : "initial_version";
    try {
      await this.executeTransaction([
        { query: `INSERT INTO ai_note_versions
          (id, ai_identity_id, version_number, content, content_sha256, estimated_tokens, estimator_version, capacity_tokens_at_creation,
           source_session_id, source_workspace_id, protocol_id, session_run_type, change_summary, base_version_id, base_content_sha256,
           reflection_run_id, reflection_packet_sha256, model_route_snapshot, generation_settings_json, created_at)
          VALUES ($1,$2,$3,$4,$5,$6,'conservative-char-v1',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
          values: [versionId, input.aiIdentityId, Number(numberRows[0]?.next_number ?? 1), input.notes, input.contentSha256, input.estimatedTokens, input.capacityTokens,
            input.sourceSessionId, input.sourceWorkspaceId, input.protocolId, input.sessionRunType, input.changeSummary, input.baseVersionId ?? null,
            input.baseContentSha256 ?? null, input.runId, input.reflectionPacketSha256, input.modelRouteSnapshot, JSON.stringify(input.generationSettingsSnapshot), completedAt] },
        { query: `INSERT INTO ai_note_activation_events
          (id, ai_identity_id, from_version_id, to_version_id, activation_source, workspace_id, source_session_id, created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, values: [activationId, input.aiIdentityId, input.baseVersionId ?? null, versionId, activationSource, input.sourceWorkspaceId, input.sourceSessionId, completedAt] },
        { query: "UPDATE ai_note_settings SET active_version_id = $1, updated_at = $2 WHERE ai_identity_id = $3", values: [versionId, completedAt, input.aiIdentityId] },
        { query: `UPDATE ai_note_reflection_runs SET status = 'UPDATE', attempt_count = attempt_count + 1, change_summary = $1,
          provider_request_id = $2, raw_final_response_sha256 = $3, completed_at = $4 WHERE id = $5`, values: [input.changeSummary, input.providerRequestId ?? null, input.rawFinalResponseSha256, completedAt, input.runId] },
      ]);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (message.includes("STALE_BASE")) {
        await this.executeWrite("UPDATE ai_note_reflection_runs SET status = 'STALE_BASE', failure_message = $1, completed_at = $2 WHERE id = $3", ["Active Viewer Notes changed while reflection was running.", completedAt, input.runId]);
        return { status: "STALE_BASE" };
      }
      throw cause;
    }
    const versionRows = await this.db.select<ViewerNoteVersionRow[]>("SELECT * FROM ai_note_versions WHERE id = $1", [versionId]);
    return { status: "UPDATE", version: mapViewerNoteVersion(versionRows[0]) };
  }

  async restoreViewerNoteVersion(aiIdentityId: string, versionId: string, workspaceId?: string): Promise<void> {
    const rows = await this.db.select<Array<{ active_version_id: string | null; capacity_tokens: number; estimated_tokens: number }>>(`SELECT s.active_version_id, s.capacity_tokens, v.estimated_tokens
      FROM ai_note_settings s JOIN ai_note_versions v ON v.id = $1 AND v.ai_identity_id = s.ai_identity_id WHERE s.ai_identity_id = $2`, [versionId, aiIdentityId]);
    if (!rows[0]) throw new Error("Viewer Notes version not found.");
    if (Number(rows[0].estimated_tokens) > Number(rows[0].capacity_tokens)) throw new Error("The selected version does not fit the current capacity.");
    const timestamp = nowIso();
    await this.executeTransaction([
      { query: "UPDATE ai_note_settings SET active_version_id = $1, updated_at = $2 WHERE ai_identity_id = $3", values: [versionId, timestamp, aiIdentityId] },
      { query: `INSERT INTO ai_note_activation_events (id, ai_identity_id, from_version_id, to_version_id, activation_source, workspace_id, created_at)
        VALUES ($1,$2,$3,$4,'human_restore',$5,$6)`, values: [createId("ai_note_activation"), aiIdentityId, rows[0].active_version_id, versionId, workspaceId ?? null, timestamp] },
    ]);
  }

  async createTrainingRun(input: CreateTrainingRunInput): Promise<TrainingRunRecord> {
    const timestamp = nowIso();
    const rows = await this.db.select<Array<{ next_number: number }>>("SELECT COALESCE(MAX(run_number), 0) + 1 AS next_number FROM training_runs");
    const run: TrainingRunRecord = { ...input, id: createId("training"), runNumber: Number(rows[0]?.next_number ?? 1), completedTargetIds: [], sessionIds: [], currentIndex: 0, errors: [], createdAt: timestamp, updatedAt: timestamp };
    await this.executeWrite(
      `INSERT INTO training_runs (id, run_number, status, record_json, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)`,
      [run.id, run.runNumber, run.status, JSON.stringify(run), timestamp],
    );
    return run;
  }

  async updateTrainingRun(id: string, input: UpdateTrainingRunInput): Promise<void> {
    const rows = await this.db.select<Array<{ record_json: string }>>("SELECT record_json FROM training_runs WHERE id = $1", [id]);
    if (!rows[0]) throw new Error("Training run not found.");
    const current = JSON.parse(rows[0].record_json) as TrainingRunRecord;
    const updated: TrainingRunRecord = { ...current, ...input, errors: input.error ? [...current.errors, input.error] : current.errors, updatedAt: nowIso() };
    await this.executeWrite("UPDATE training_runs SET status = $1, record_json = $2, updated_at = $3 WHERE id = $4", [updated.status, JSON.stringify(updated), updated.updatedAt, id]);
  }

  async listTrainingRuns(): Promise<TrainingRunRecord[]> {
    const rows = await this.db.select<Array<{ record_json: string }>>("SELECT record_json FROM training_runs ORDER BY run_number DESC");
    return rows.map((row) => {
      const run = JSON.parse(row.record_json) as TrainingRunRecord;
      return { ...run, sessionIds: run.sessionIds ?? [] };
    });
  }

  async listProfiles(): Promise<Profile[]> {
    const rows = await this.db.select<ProfileRow[]>(
      `SELECT p.id, p.display_name, p.human_display_name, p.note, p.credential_id,
              c.provider AS credential_provider,
              p.default_viewer_model_id,
              p.default_viewer_reasoning_effort,
              p.default_viewer_temperature,
              p.default_viewer_system_prompt,
              p.default_monitor_system_prompt,
              p.default_monitor_provider_config_id,
              p.default_monitor_model_id,
              p.default_judge_provider_config_id,
              p.default_judge_model_id,
              p.created_at, p.updated_at
         FROM profiles p
         LEFT JOIN credentials_metadata c ON c.id = p.credential_id
        WHERE p.archived_at IS NULL
        ORDER BY p.updated_at DESC`,
    );
    return rows.map(mapProfile);
  }

  async createProfile(input: CreateProfileInput): Promise<Profile> {
    const timestamp = nowIso();
    const ai = input.aiConfiguration;
    const profile: Profile = {
      id: createId("profile"),
      name: input.name.trim(),
      humanName: input.humanName?.trim() || undefined,
      note: input.note?.trim() || undefined,
      credentialId: ai?.credentialId,
      credentialProvider: ai?.credentialProvider,
      defaultViewerModelId: ai?.defaultViewerModelId,
      defaultViewerReasoningEffort: ai?.defaultViewerReasoningEffort,
      defaultViewerTemperature: ai?.defaultViewerTemperature,
      defaultViewerSystemPrompt: ai?.defaultViewerSystemPrompt?.trim() || undefined,
      defaultMonitorSystemPrompt: ai?.defaultMonitorSystemPrompt?.trim() || undefined,
      defaultMonitorProviderConfigId: ai?.defaultMonitorProviderConfigId,
      defaultMonitorModelId: ai?.defaultMonitorModelId,
      defaultJudgeProviderConfigId: ai?.defaultJudgeProviderConfigId,
      defaultJudgeModelId: ai?.defaultJudgeModelId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.executeWrite(
      `INSERT INTO profiles (
         id, display_name, human_display_name, note, credential_id,
         default_viewer_model_id, default_viewer_reasoning_effort,
         default_viewer_temperature, default_viewer_system_prompt, default_monitor_system_prompt,
         default_monitor_provider_config_id, default_monitor_model_id,
         default_judge_provider_config_id, default_judge_model_id,
         created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        profile.id,
        profile.name,
        profile.humanName ?? null,
        profile.note ?? null,
        profile.credentialId ?? null,
        profile.defaultViewerModelId ?? null,
        profile.defaultViewerReasoningEffort ?? null,
        profile.defaultViewerTemperature ?? null,
        profile.defaultViewerSystemPrompt ?? null,
        profile.defaultMonitorSystemPrompt ?? null,
        profile.defaultMonitorProviderConfigId ?? null,
        profile.defaultMonitorModelId ?? null,
        profile.defaultJudgeProviderConfigId ?? null,
        profile.defaultJudgeModelId ?? null,
        timestamp,
        timestamp,
      ],
    );
    return profile;
  }

  async updateProfile(id: string, input: UpdateProfileInput): Promise<void> {
    const name = input.name.trim();
    await this.executeWrite(
      "UPDATE profiles SET display_name = $1, human_display_name = $2, note = $3, updated_at = $4 WHERE id = $5 AND archived_at IS NULL",
      [name, input.humanName?.trim() || null, input.note?.trim() || null, nowIso(), id],
    );
  }

  async archiveProfile(id: string): Promise<void> {
    const timestamp = nowIso();
    await this.executeTransaction([
      { query: "UPDATE workspaces SET archived_at = $1, updated_at = $1 WHERE profile_id = $2 AND archived_at IS NULL", values: [timestamp, id] },
      { query: "UPDATE profiles SET archived_at = $1, updated_at = $1 WHERE id = $2 AND archived_at IS NULL", values: [timestamp, id] },
    ]);
  }

  async setProfileAiConfiguration(profileId: string, input: ProfileAiConfigurationInput): Promise<void> {
    await this.executeWrite(
      `UPDATE profiles
          SET credential_id = $1,
              default_viewer_model_id = $2,
              default_viewer_reasoning_effort = $3,
              default_viewer_temperature = $4,
              default_viewer_system_prompt = $5,
              default_monitor_system_prompt = $6,
              default_monitor_provider_config_id = $7,
              default_monitor_model_id = $8,
              default_judge_provider_config_id = $9,
              default_judge_model_id = $10,
              updated_at = $11
        WHERE id = $12 AND archived_at IS NULL`,
      [
        input.credentialId ?? null,
        input.defaultViewerModelId ?? null,
        input.defaultViewerReasoningEffort ?? null,
        input.defaultViewerTemperature ?? null,
        input.defaultViewerSystemPrompt?.trim() || null,
        input.defaultMonitorSystemPrompt?.trim() || null,
        input.defaultMonitorProviderConfigId ?? null,
        input.defaultMonitorModelId ?? null,
        input.defaultJudgeProviderConfigId ?? null,
        input.defaultJudgeModelId ?? null,
        nowIso(),
        profileId,
      ],
    );
  }

  async listWorkspaces(profileId?: string): Promise<Workspace[]> {
    const rows = profileId
      ? await this.db.select<WorkspaceRow[]>(
          `SELECT id, profile_id, name, description, created_at, updated_at, last_opened_at
             FROM workspaces
            WHERE profile_id = $1 AND archived_at IS NULL
            ORDER BY last_opened_at DESC`,
          [profileId],
        )
      : await this.db.select<WorkspaceRow[]>(
          `SELECT id, profile_id, name, description, created_at, updated_at, last_opened_at
             FROM workspaces
            WHERE archived_at IS NULL
            ORDER BY last_opened_at DESC`,
        );
    return rows.map(mapWorkspace);
  }

  async createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
    const timestamp = nowIso();
    const workspace: Workspace = {
      id: createId("workspace"),
      profileId: input.profileId,
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastOpenedAt: timestamp,
    };
    await this.executeWrite(
      `INSERT INTO workspaces (id, profile_id, name, description, created_at, updated_at, last_opened_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        workspace.id,
        workspace.profileId,
        workspace.name,
        workspace.description ?? null,
        timestamp,
        timestamp,
        timestamp,
      ],
    );
    return workspace;
  }

  async touchWorkspace(id: string): Promise<void> {
    const timestamp = nowIso();
    await this.executeWrite(
      "UPDATE workspaces SET updated_at = $1, last_opened_at = $1 WHERE id = $2",
      [timestamp, id],
    );
  }

  async setProfileCredential(profileId: string, credentialId?: string, _provider?: string): Promise<void> {
    await this.executeWrite(
      `UPDATE profiles
          SET credential_id = $1,
              default_viewer_model_id = NULL,
              default_viewer_reasoning_effort = NULL,
              default_viewer_temperature = NULL,
              updated_at = $2
        WHERE id = $3`,
      [credentialId ?? null, nowIso(), profileId],
    );
  }

  async listChatThreadGroups(workspaceId: string, mode: ChatMode): Promise<ChatThreadGroup[]> {
    const rows = await this.db.select<ChatThreadGroupRow[]>(
      `SELECT id, workspace_id, mode, title, created_at, updated_at, archived_at
         FROM chat_thread_groups
        WHERE workspace_id = $1 AND mode = $2 AND archived_at IS NULL
        ORDER BY updated_at DESC, created_at DESC`,
      [workspaceId, mode],
    );
    return rows.map(mapChatThreadGroup);
  }

  async createChatThreadGroup(workspaceId: string, mode: ChatMode, title?: string): Promise<ChatThreadGroup> {
    const existing = await this.listChatThreadGroups(workspaceId, mode);
    const timestamp = nowIso();
    const group: ChatThreadGroup = {
      id: createId("thread_group"),
      workspaceId,
      mode,
      title: title?.trim().slice(0, 160) || `Thread ${existing.length + 1}`,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.executeWrite(
      `INSERT INTO chat_thread_groups (id, workspace_id, mode, title, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $5)`,
      [group.id, group.workspaceId, group.mode, group.title, timestamp],
    );
    return group;
  }

  async renameChatThreadGroup(groupId: string, title: string): Promise<void> {
    const clean = title.trim();
    if (!clean) throw new Error("Thread title is required.");
    await this.executeWrite("UPDATE chat_thread_groups SET title = $1, updated_at = $2 WHERE id = $3", [clean.slice(0, 160), nowIso(), groupId]);
  }

  async archiveChatThreadGroup(groupId: string): Promise<void> {
    const timestamp = nowIso();
    await this.executeTransaction([
      { query: "UPDATE chat_thread_groups SET archived_at = $1, updated_at = $1 WHERE id = $2 AND archived_at IS NULL", values: [timestamp, groupId] },
      { query: "UPDATE chat_threads SET archived_at = $1, updated_at = $1 WHERE thread_group_id = $2 AND archived_at IS NULL", values: [timestamp, groupId] },
    ]);
  }

  async listChatThreads(workspaceId: string, mode: ChatMode): Promise<ChatThread[]> {
    const rows = await this.db.select<ChatThreadRow[]>(
      `SELECT id, workspace_id, mode, thread_group_id, title, formal_rv_state, created_at, updated_at, archived_at
         FROM chat_threads
        WHERE workspace_id = $1 AND mode = $2 AND archived_at IS NULL
        ORDER BY updated_at DESC, created_at DESC`,
      [workspaceId, mode],
    );
    return rows.map(mapChatThread);
  }

  async createChatThread(workspaceId: string, mode: ChatMode, title?: string, threadGroupId?: string): Promise<ChatThread> {
    const timestamp = nowIso();
    const thread: ChatThread = {
      id: createId("thread"), workspaceId, mode, threadGroupId,
      title: title?.trim().slice(0, 160) || (mode === "conversation" ? "Conversation" : "Manual RV Session"),
      createdAt: timestamp, updatedAt: timestamp,
    };
    await this.executeWrite(
      `INSERT INTO chat_threads (id, workspace_id, mode, thread_group_id, title, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6)`,
      [thread.id, thread.workspaceId, thread.mode, thread.threadGroupId ?? null, thread.title, timestamp],
    );
    return thread;
  }

  async getOrCreateChatThread(workspaceId: string, mode: ChatMode): Promise<ChatThread> {
    const existing = (await this.listChatThreads(workspaceId, mode))[0];
    if (!existing) return this.createChatThread(workspaceId, mode);
    await this.touchChatThread(existing.id);
    return { ...existing, updatedAt: nowIso() };
  }

  async touchChatThread(threadId: string): Promise<void> {
    await this.executeWrite("UPDATE chat_threads SET updated_at = $1 WHERE id = $2 AND archived_at IS NULL", [nowIso(), threadId]);
  }

  async renameChatThread(threadId: string, title: string): Promise<void> {
    const clean = title.trim();
    if (!clean) throw new Error("Thread title is required.");
    await this.executeWrite("UPDATE chat_threads SET title = $1, updated_at = $2 WHERE id = $3", [clean.slice(0, 160), nowIso(), threadId]);
  }

  async archiveChatThread(threadId: string): Promise<void> {
    const rows = await this.db.select<Array<{ id: string }>>("SELECT id FROM chat_threads WHERE id = $1 AND archived_at IS NULL LIMIT 1", [threadId]);
    if (!rows[0]) throw new Error("Chat thread not found.");
    const timestamp = nowIso();
    await this.executeWrite("UPDATE chat_threads SET archived_at = $1, updated_at = $1 WHERE id = $2 AND archived_at IS NULL", [timestamp, threadId]);
  }

  async setChatThreadFormalRvState(threadId: string, state?: ChatThread["formalRvState"]): Promise<void> {
    await this.executeWrite("UPDATE chat_threads SET formal_rv_state = $1, updated_at = $2 WHERE id = $3 AND mode = 'manual_rv'", [state ?? null, nowIso(), threadId]);
  }

  async listChatMessages(threadId: string): Promise<ChatMessage[]> {
    const rows = await this.db.select<ChatMessageRow[]>(
      `SELECT id, thread_id, role, content, created_at FROM chat_messages
        WHERE thread_id = $1 AND role IN ('user','assistant') ORDER BY created_at`,
      [threadId],
    );
    return rows.map((row) => ({ id: row.id, threadId: row.thread_id, role: row.role, content: row.content, createdAt: row.created_at }));
  }

  async appendChatMessage(threadId: string, role: ChatMessage["role"], content: string): Promise<ChatMessage> {
    const timestamp = nowIso();
    const message: ChatMessage = { id: createId("message"), threadId, role, content, createdAt: timestamp };
    await this.executeWrite(
      `INSERT INTO chat_messages (id, thread_id, role, content, created_at) VALUES ($1, $2, $3, $4, $5)`,
      [message.id, threadId, role, content, timestamp],
    );
    await this.executeWrite("UPDATE chat_threads SET updated_at = $1 WHERE id = $2", [timestamp, threadId]);
    return message;
  }

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

  async loadSettings(): Promise<Partial<AppSettings>> {
    const rows = await this.db.select<{ key: string; value: string }[]>("SELECT key, value FROM app_settings");
    const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    return {
      ...(values.interfaceLanguage ? { interfaceLanguage: values.interfaceLanguage as AppSettings["interfaceLanguage"] } : {}),
      ...(values.sessionLanguage ? { sessionLanguage: values.sessionLanguage as AppSettings["sessionLanguage"] } : {}),
      ...(values.theme ? { theme: values.theme as AppSettings["theme"] } : {}),
      ...(values.requestTimeoutMs ? { requestTimeoutMs: Number(values.requestTimeoutMs) } : {}),
      ...(values.maxRetries ? { maxRetries: Number(values.maxRetries) } : {}),
      ...(values.defaultMaxOutputTokens ? { defaultMaxOutputTokens: Number(values.defaultMaxOutputTokens) } : {}),
      ...(values.maxSessionCostUsd ? { maxSessionCostUsd: Number(values.maxSessionCostUsd) } : {}),
      ...(values.defaultRevealSource ? { defaultRevealSource: values.defaultRevealSource as AppSettings["defaultRevealSource"] } : {}),
      ...(values.targetRepeatPolicy ? { targetRepeatPolicy: values.targetRepeatPolicy as AppSettings["targetRepeatPolicy"] } : {}),
      ...(values.sessionCodePrefix ? { sessionCodePrefix: values.sessionCodePrefix } : {}),
      ...(values.textScale ? { textScale: values.textScale as AppSettings["textScale"] } : {}),
      ...(values.animations ? { animations: values.animations === "true" } : {}),
      ...(values.trainingDirectory !== undefined ? { trainingDirectory: values.trainingDirectory } : {}),
      ...(values.telepathicStarterPackVersion !== undefined ? { telepathicStarterPackVersion: values.telepathicStarterPackVersion } : {}),
    };
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    const timestamp = nowIso();
    await this.executeTransaction(Object.entries(settings).filter(([, value]) => value !== undefined).map(([key, value]) => ({
      query: `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, $3)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      values: [key, String(value), timestamp],
    })));
  }

  async listProviderConfigs(): Promise<ProviderConfig[]> {
    const rows = await this.db.select<ProviderConfigRow[]>(
      `SELECT pc.id, pc.provider, pc.label, pc.credential_id, pc.credential_hint,
              cm.fingerprint AS credential_fingerprint,
              pc.base_url, pc.enabled, pc.last_tested_at, pc.last_status, pc.last_error,
              pc.created_at, pc.updated_at
         FROM provider_configs pc
         LEFT JOIN credentials_metadata cm ON cm.id = pc.credential_id
        ORDER BY pc.updated_at DESC`,
    );
    return rows.map(mapProviderConfig);
  }

  async createProviderConfig(input: CreateProviderConfigInput): Promise<ProviderConfig> {
    const timestamp = nowIso();
    const config: ProviderConfig = {
      id: input.id,
      provider: input.provider,
      label: input.label.trim(),
      credentialId: input.credentialId,
      credentialHint: input.credentialHint,
      credentialFingerprint: input.fingerprint,
      baseUrl: input.baseUrl?.trim() || undefined,
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.executeTransaction([
      {
        query: `INSERT INTO credentials_metadata (id, provider, label, fingerprint, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $5)`,
        values: [input.credentialId, input.provider, config.label, input.fingerprint ?? null, timestamp],
      },
      {
        query: `INSERT INTO provider_configs
                (id, provider, label, credential_id, credential_hint, base_url, enabled, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $7)`,
        values: [config.id, config.provider, config.label, config.credentialId, config.credentialHint ?? null, config.baseUrl ?? null, timestamp],
      },
    ]);
    return config;
  }

  async updateProviderCredentialMetadata(id: string, credentialHint: string, fingerprint: string): Promise<void> {
    const rows = await this.db.select<{ credential_id: string }[]>("SELECT credential_id FROM provider_configs WHERE id = $1 LIMIT 1", [id]);
    const credentialId = rows[0]?.credential_id;
    if (!credentialId) throw new Error("Provider connection not found.");
    const timestamp = nowIso();
    await this.executeTransaction([
      {
        query:
        `UPDATE provider_configs
            SET credential_hint = $1, last_status = NULL, last_error = NULL, last_tested_at = NULL, updated_at = $2
          WHERE id = $3`,
        values: [credentialHint, timestamp, id],
      },
      {
        query: "UPDATE credentials_metadata SET fingerprint = $1, updated_at = $2 WHERE id = $3",
        values: [fingerprint, timestamp, credentialId],
      },
    ]);
  }

  async deleteProviderConfig(id: string): Promise<void> {
    const rows = await this.db.select<{ credential_id: string }[]>("SELECT credential_id FROM provider_configs WHERE id = $1", [id]);
    const credentialId = rows[0]?.credential_id;
    const statements: DatabaseTransactionStatement[] = [];
    if (credentialId) {
      statements.push({
        query: `UPDATE profiles
              SET credential_id = CASE WHEN credential_id = $1 THEN NULL ELSE credential_id END,
                  default_viewer_model_id = CASE WHEN credential_id = $1 THEN NULL ELSE default_viewer_model_id END,
                  default_viewer_reasoning_effort = CASE WHEN credential_id = $1 THEN NULL ELSE default_viewer_reasoning_effort END,
                  default_viewer_temperature = CASE WHEN credential_id = $1 THEN NULL ELSE default_viewer_temperature END,
                  default_monitor_provider_config_id = CASE WHEN default_monitor_provider_config_id = $2 THEN NULL ELSE default_monitor_provider_config_id END,
                  default_monitor_model_id = CASE WHEN default_monitor_provider_config_id = $2 THEN NULL ELSE default_monitor_model_id END,
                  default_judge_provider_config_id = CASE WHEN default_judge_provider_config_id = $2 THEN NULL ELSE default_judge_provider_config_id END,
                  default_judge_model_id = CASE WHEN default_judge_provider_config_id = $2 THEN NULL ELSE default_judge_model_id END,
                  updated_at = $3
            WHERE credential_id = $1 OR default_monitor_provider_config_id = $2 OR default_judge_provider_config_id = $2`,
        values: [credentialId, id, nowIso()],
      });
    }
    statements.push({ query: "DELETE FROM provider_configs WHERE id = $1", values: [id] });
    if (credentialId) statements.push({ query: "DELETE FROM credentials_metadata WHERE id = $1", values: [credentialId] });
    await this.executeTransaction(statements);
  }

  async updateProviderConnectionStatus(id: string, status: "ok" | "error", error?: string): Promise<void> {
    const timestamp = nowIso();
    await this.executeWrite(
      `UPDATE provider_configs
          SET last_tested_at = $1, last_status = $2, last_error = $3, updated_at = $1
        WHERE id = $4`,
      [timestamp, status, error ?? null, id],
    );
  }

  async listProviderModels(providerConfigId?: string): Promise<ProviderModel[]> {
    const rows = providerConfigId
      ? await this.db.select<ProviderModelRow[]>(
          `SELECT provider_config_id, provider, model_id, display_name, route, capability_json,
                  pricing_json, recommended, favorite, raw_metadata_json, refreshed_at
             FROM model_registry WHERE provider_config_id = $1 ORDER BY display_name`,
          [providerConfigId],
        )
      : await this.db.select<ProviderModelRow[]>(
          `SELECT provider_config_id, provider, model_id, display_name, route, capability_json,
                  pricing_json, recommended, favorite, raw_metadata_json, refreshed_at
             FROM model_registry ORDER BY display_name`,
        );
    return rows.map(mapProviderModel);
  }

  async replaceProviderModels(providerConfigId: string, models: ProviderModel[]): Promise<void> {
    const favorites = new Set((await this.db.select<{ model_id: string }[]>(
      "SELECT model_id FROM model_registry WHERE provider_config_id = $1 AND favorite = 1",
      [providerConfigId],
    )).map((row) => row.model_id));
    const statements: DatabaseTransactionStatement[] = [
      { query: "DELETE FROM model_registry WHERE provider_config_id = $1", values: [providerConfigId] },
    ];
    for (const model of models) {
      statements.push({
        query: `INSERT INTO model_registry
                (provider_config_id, provider, model_id, display_name, route, capability_json, pricing_json,
                 recommended, favorite, raw_metadata_json, refreshed_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        values: [
          model.providerConfigId,
          model.provider,
          model.modelId,
          model.displayName,
          model.route,
          JSON.stringify(model.capabilities),
          JSON.stringify(model.pricing),
          model.recommended ? 1 : 0,
          (model.favorite || favorites.has(model.modelId)) ? 1 : 0,
          JSON.stringify(model.rawMetadata),
          model.refreshedAt,
        ],
      });
    }
    await this.executeTransaction(statements);
  }

  async setProviderModelFavorite(providerConfigId: string, modelId: string, favorite: boolean): Promise<void> {
    await this.executeWrite(
      "UPDATE model_registry SET favorite = $1 WHERE provider_config_id = $2 AND model_id = $3",
      [favorite ? 1 : 0, providerConfigId, modelId],
    );
  }

  async clearProviderModelCache(): Promise<void> {
    await this.executeWrite("DELETE FROM model_registry");
  }

  async listTargets(collection?: TargetRecord["collection"]): Promise<TargetRecord[]> {
    const rows = collection
      ? await this.db.select<TargetRow[]>(
          `SELECT id, collection, title, reveal_text, reveal_artifact_path, reveal_artifact_manifest_json, tags_json, source_metadata_json,
                  content_hash, created_at, updated_at FROM targets WHERE collection = $1 AND retired_at IS NULL ORDER BY updated_at DESC`,
          [collection],
        )
      : await this.db.select<TargetRow[]>(
          `SELECT id, collection, title, reveal_text, reveal_artifact_path, reveal_artifact_manifest_json, tags_json, source_metadata_json,
                  content_hash, created_at, updated_at FROM targets WHERE retired_at IS NULL ORDER BY collection, updated_at DESC`,
        );
    return rows.map((row) => ({
      id: row.id,
      collection: row.collection,
      title: row.title,
      revealText: row.reveal_text ?? undefined,
      revealArtifactPath: row.reveal_artifact_path ?? undefined,
      revealArtifacts: JSON.parse(row.reveal_artifact_manifest_json) as NonNullable<TargetRecord["revealArtifacts"]>,
      tags: JSON.parse(row.tags_json) as string[],
      sourceMetadata: JSON.parse(row.source_metadata_json) as Record<string, unknown>,
      contentHash: row.content_hash ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async createTarget(input: CreateTargetInput): Promise<TargetRecord> {
    const timestamp = nowIso();
    const target: TargetRecord = {
      id: input.id,
      collection: input.collection,
      title: input.title.trim(),
      revealText: input.revealText?.trim() || undefined,
      revealArtifactPath: input.revealArtifactPath,
      revealArtifacts: input.revealArtifacts ?? [],
      tags: input.tags ?? [],
      sourceMetadata: input.sourceMetadata ?? {},
      contentHash: input.contentHash,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.executeWrite(
      `INSERT INTO targets
       (id, collection, title, reveal_text, reveal_artifact_path, reveal_artifact_manifest_json, tags_json, source_metadata_json, content_hash, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
      [target.id, target.collection, target.title, target.revealText ?? null, target.revealArtifactPath ?? null, JSON.stringify(target.revealArtifacts ?? []), JSON.stringify(target.tags), JSON.stringify(target.sourceMetadata), target.contentHash ?? null, timestamp],
    );
    return target;
  }

  async updateTarget(id: string, input: UpdateTargetInput): Promise<TargetRecord> {
    const timestamp = nowIso();
    await this.executeWrite(
      `UPDATE targets
          SET title = $1, reveal_text = $2, tags_json = $3, content_hash = $4, updated_at = $5
        WHERE id = $6 AND collection = 'user'`,
      [input.title.trim(), input.revealText?.trim() || null, JSON.stringify(input.tags), input.contentHash, timestamp, id],
    );
    const target = (await this.listTargets("user")).find((item) => item.id === id);
    if (!target) throw new Error("User target not found.");
    return target;
  }

  async deleteTarget(id: string): Promise<void> {
    const result = await this.executeWrite("DELETE FROM targets WHERE id = $1 AND collection = 'user'", [id]);
    if (result.rowsAffected !== 1) throw new Error("User target not found or cannot be deleted.");
  }

  async recordTargetUsage(input: TargetUsageInput): Promise<void> {
    await this.executeWrite(
      `INSERT INTO target_usage (id, target_id, profile_id, research_project_id, session_id, used_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [createId("target_usage"), input.targetId, input.profileId ?? null, input.researchProjectId ?? null, input.sessionId ?? null, nowIso()],
    );
  }

  async listTargetUsage(): Promise<TargetUsageRecord[]> {
    const rows = await this.db.select<Array<{ id: string; target_id: string; profile_id: string | null; research_project_id: string | null; session_id: string | null; used_at: string }>>(
      "SELECT id, target_id, profile_id, research_project_id, session_id, used_at FROM target_usage ORDER BY used_at DESC",
    );
    return rows.map((row) => ({ id: row.id, targetId: row.target_id, profileId: row.profile_id ?? undefined, researchProjectId: row.research_project_id ?? undefined, sessionId: row.session_id ?? undefined, usedAt: row.used_at }));
  }

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

  async createRvSession(input: CreateRvSessionInput): Promise<RvSession> {
    const timestamp = nowIso();
    const session: RvSession = {
      id: input.id,
      workspaceId: input.workspaceId,
      profileId: input.profileId,
      sessionCode: input.sessionCode,
      state: "Draft",
      runType: input.runType,
      preRevealTranscript: "",
      postRevealTranscript: "",
      targetId: input.targetId,
      researchProjectId: input.researchProjectId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.executeWrite(
      `INSERT INTO rv_sessions
       (id, workspace_id, profile_id, session_code, state, run_type, pre_reveal_transcript,
        post_reveal_transcript, target_id, research_project_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Draft', $5, '', '', $6, $7, $8, $8)`,
      [session.id, session.workspaceId, session.profileId, session.sessionCode, session.runType, session.targetId ?? null, session.researchProjectId ?? null, timestamp],
    );
    return session;
  }

  async updateRvSessionState(id: string, state: RvSessionState, stopReason?: string): Promise<void> {
    const timestamp = nowIso();
    await this.executeWrite(
      `UPDATE rv_sessions SET state = $1, updated_at = $2,
       completed_at = CASE WHEN $1 = 'Completed' THEN $2 ELSE completed_at END WHERE id = $3`,
      [state, timestamp, id],
    );
    if (stopReason) await this.appendSessionEvent(id, { eventType: "SESSION_STOPPED", role: "controller", content: stopReason });
  }

  async appendPostRevealTurn(sessionId: string, role: "user" | "assistant" | "monitor", content: string): Promise<string> {
    const rows = await this.db.select<Array<{ state: RvSessionState; post_reveal_transcript: string; research_project_id: string | null }>>(
      "SELECT state, post_reveal_transcript, research_project_id FROM rv_sessions WHERE id = $1",
      [sessionId],
    );
    const session = rows[0];
    if (!session) throw new Error("RV session not found.");
    if (session.state !== "Revealed" && session.state !== "Completed") throw new Error("Post-reveal discussion requires Reveal.");
    if (session.research_project_id) {
      const projects = await this.db.select<Array<{ scores_frozen_at: string | null }>>(
        "SELECT scores_frozen_at FROM research_projects WHERE id = $1",
        [session.research_project_id],
      );
      if (!projects[0]?.scores_frozen_at) throw new Error("Research post-reveal discussion requires frozen scores.");
    }
    const next = `${session.post_reveal_transcript}${serializePostRevealTurn(role, content)}`;
    await this.executeWrite("UPDATE rv_sessions SET post_reveal_transcript = $1, updated_at = $2 WHERE id = $3", [next, nowIso(), sessionId]);
    await this.appendSessionEvent(sessionId, { eventType: `POST_REVEAL_${role.toUpperCase()}`, role, content: content.trim() });
    return next;
  }

  async appendSessionEvent(sessionId: string, event: SessionEventInput): Promise<void> {
    const timestamp = nowIso();
    await this.executeWrite(
      `INSERT INTO session_events
       (id, session_id, sequence_number, event_type, role, content, metadata_json, created_at)
       SELECT $1, $2, COALESCE(MAX(sequence_number), 0) + 1, $3, $4, $5, $6, $7
         FROM session_events WHERE session_id = $2`,
      [createId("event"), sessionId, event.eventType, event.role ?? null, event.content ?? null, JSON.stringify(event.metadata ?? {}), timestamp],
    );
  }

  async listSessionEvents(sessionId: string): Promise<SessionEventRecord[]> {
    const rows = await this.db.select<SessionEventRow[]>(
      `SELECT id, session_id, sequence_number, event_type, role, content, metadata_json, created_at
         FROM session_events WHERE session_id = $1 ORDER BY sequence_number`,
      [sessionId],
    );
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      sequenceNumber: Number(row.sequence_number),
      eventType: row.event_type,
      ...(row.role ? { role: row.role } : {}),
      ...(row.content !== null ? { content: row.content } : {}),
      metadata: JSON.parse(row.metadata_json || "{}") as Record<string, unknown>,
      createdAt: row.created_at,
    }));
  }

  async updatePreRevealTranscript(sessionId: string, transcript: string): Promise<void> {
    await this.executeWrite(
      "UPDATE rv_sessions SET pre_reveal_transcript = $1, updated_at = $2 WHERE id = $3",
      [transcript, nowIso(), sessionId],
    );
  }

  async saveSessionSnapshot(sessionId: string, snapshot: SessionSnapshot, hash: string): Promise<void> {
    await this.executeWrite(
      `INSERT INTO session_snapshots (id, session_id, snapshot_json, snapshot_hash, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [createId("snapshot"), sessionId, JSON.stringify(snapshot), hash, nowIso()],
    );
  }

  async getSessionSnapshot(sessionId: string): Promise<SessionSnapshot | null> {
    const rows = await this.db.select<{ snapshot_json: string }[]>("SELECT snapshot_json FROM session_snapshots WHERE session_id = $1 LIMIT 1", [sessionId]);
    return rows[0] ? JSON.parse(rows[0].snapshot_json) as SessionSnapshot : null;
  }

  async sealPreReveal(sessionId: string, transcript: string, hash: string): Promise<void> {
    const timestamp = nowIso();
    await this.executeWrite(
      `UPDATE rv_sessions SET pre_reveal_transcript = $1, pre_reveal_hash = $2,
       pre_reveal_sealed_at = $3, state = 'AwaitingReveal', updated_at = $3 WHERE id = $4`,
      [transcript, hash, timestamp, sessionId],
    );
  }

  async acceptReveal(sessionId: string, reveal: RevealInput): Promise<void> {
    const timestamp = nowIso();
    await this.executeWrite(
      `INSERT INTO reveals (id, session_id, reveal_source, reveal_text, artifact_manifest_json, reveal_hash, accepted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [createId("reveal"), sessionId, reveal.source, reveal.text ?? null, JSON.stringify(reveal.artifactManifest ?? []), reveal.hash, timestamp],
    );
  }

  async getReveal(sessionId: string): Promise<RevealInput | null> {
    const rows = await this.db.select<RevealRow[]>(
      `SELECT reveal_source, reveal_text, artifact_manifest_json, reveal_hash
         FROM reveals WHERE session_id = $1 LIMIT 1`,
      [sessionId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      source: row.reveal_source,
      ...(row.reveal_text !== null ? { text: row.reveal_text } : {}),
      artifactManifest: JSON.parse(row.artifact_manifest_json) as NonNullable<RevealInput["artifactManifest"]>,
      hash: row.reveal_hash,
    };
  }

  async getViewerEvidence(sessionId: string): Promise<string> {
    const rows = await this.db.select<Array<{ pre_reveal_transcript: string; pre_reveal_hash: string | null; pre_reveal_sealed_at: string | null }>>(
      `SELECT pre_reveal_transcript, pre_reveal_hash, pre_reveal_sealed_at
         FROM rv_sessions WHERE id = $1 LIMIT 1`,
      [sessionId],
    );
    const row = rows[0];
    if (!row?.pre_reveal_sealed_at || !row.pre_reveal_hash) return "";
    return verifySealedViewerEvidence(row.pre_reveal_transcript, row.pre_reveal_hash);
  }

  async listRvSessions(workspaceId: string): Promise<RvSession[]> {
    const rows = await this.db.select<RvSessionRow[]>(
      `SELECT id, workspace_id, profile_id, session_code, state, run_type, pre_reveal_transcript,
              pre_reveal_hash, pre_reveal_sealed_at, post_reveal_transcript, target_id,
              research_project_id, created_at, updated_at, completed_at
         FROM rv_sessions WHERE workspace_id = $1 ORDER BY created_at DESC`,
      [workspaceId],
    );
    return rows.map(mapRvSession);
  }

  async addTargetClarification(sessionId: string, content: string): Promise<TargetClarificationRecord> {
    const clean = content.trim();
    if (!clean) throw new Error("Target clarification cannot be empty.");
    const record: TargetClarificationRecord = { id: createId("clarification"), sessionId, content: clean, createdAt: nowIso() };
    await this.executeWrite(
      "INSERT INTO target_clarifications (id, session_id, content, created_at) VALUES ($1, $2, $3, $4)",
      [record.id, record.sessionId, record.content, record.createdAt],
    );
    return record;
  }

  async listTargetClarifications(sessionId: string): Promise<TargetClarificationRecord[]> {
    const rows = await this.db.select<Array<{ id: string; session_id: string; content: string; created_at: string }>>(
      "SELECT id, session_id, content, created_at FROM target_clarifications WHERE session_id = $1 ORDER BY created_at",
      [sessionId],
    );
    return rows.map((row) => ({ id: row.id, sessionId: row.session_id, content: row.content, createdAt: row.created_at }));
  }

  async createMonitorRun(input: CreateMonitorRunInput): Promise<string> {
    const id = createId("monitor");
    await this.executeWrite(
      `INSERT INTO monitor_runs (id, session_id, model_route, prompt_version_id, library_version, max_interventions, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, input.sessionId, input.modelRoute, input.promptVersionId ?? null, input.libraryVersion, input.maxInterventions, nowIso()],
    );
    return id;
  }

  async appendMonitorIntervention(monitorRunId: string, intervention: MonitorInterventionInput): Promise<void> {
    await this.executeWrite(
      `INSERT INTO monitor_interventions
       (id, monitor_run_id, sequence_number, decision, command_id, viewer_evidence, command_text, rationale, created_at)
       SELECT $1, $2, COALESCE(MAX(sequence_number), 0) + 1, $3, $4, $5, $6, $7, $8
         FROM monitor_interventions WHERE monitor_run_id = $2`,
      [createId("monitor_event"), monitorRunId, intervention.decision, intervention.commandId ?? null, intervention.viewerEvidence ?? null, intervention.commandText ?? null, intervention.rationale ?? null, nowIso()],
    );
  }

  async listMonitorRuns(workspaceId: string): Promise<MonitorRunRecord[]> {
    const rows = await this.db.select<Array<{ id: string; session_id: string; session_code: string; model_route: string; prompt_version_id: string | null; library_version: string; max_interventions: number; created_at: string; intervention_count: number }>>(
      `SELECT mr.id, mr.session_id, s.session_code, mr.model_route, mr.prompt_version_id, mr.library_version,
              mr.max_interventions, mr.created_at, COUNT(mi.id) AS intervention_count
         FROM monitor_runs mr JOIN rv_sessions s ON s.id = mr.session_id
         LEFT JOIN monitor_interventions mi ON mi.monitor_run_id = mr.id
        WHERE s.workspace_id = $1
        GROUP BY mr.id, mr.session_id, s.session_code, mr.model_route, mr.prompt_version_id, mr.library_version, mr.max_interventions, mr.created_at
        ORDER BY mr.created_at DESC`, [workspaceId],
    );
    return rows.map((row) => ({ id: row.id, sessionId: row.session_id, sessionCode: row.session_code, modelRoute: row.model_route, promptVersionId: row.prompt_version_id ?? undefined, libraryVersion: row.library_version, maxInterventions: row.max_interventions, createdAt: row.created_at, interventionCount: Number(row.intervention_count) }));
  }

  async listMonitorInterventions(monitorRunId: string): Promise<MonitorInterventionRecord[]> {
    const rows = await this.db.select<Array<{ id: string; monitor_run_id: string; sequence_number: number; decision: "INTERVENE" | "CONTINUE_PROTOCOL"; command_id: string | null; viewer_evidence: string | null; command_text: string | null; rationale: string | null; created_at: string }>>(
      `SELECT id, monitor_run_id, sequence_number, decision, command_id, viewer_evidence, command_text, rationale, created_at
         FROM monitor_interventions WHERE monitor_run_id = $1 ORDER BY sequence_number`, [monitorRunId],
    );
    return rows.map((row) => ({ id: row.id, monitorRunId: row.monitor_run_id, sequenceNumber: row.sequence_number, decision: row.decision, commandId: row.command_id ?? undefined, viewerEvidence: row.viewer_evidence ?? undefined, commandText: row.command_text ?? undefined, rationale: row.rationale ?? undefined, createdAt: row.created_at }));
  }

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
