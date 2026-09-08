import { assertViewerNoteBasePair } from "../../aiCenter/baseVersion";
import type {
  AiIdentity,
  BeginViewerNoteReflectionInput,
  CommitViewerNoteReflectionInput,
  EnsureAiIdentityInput,
  ViewerNoteActivationEvent,
  ViewerNoteBundle,
  ViewerNoteCapacity,
  ViewerNoteReflectionResult,
  ViewerNoteReflectionRun,
  ViewerNoteSettings,
  ViewerNoteVersion,
} from "../../aiCenter/types";
import type { ProviderKind } from "../../providers/types";
import type { DatabaseTransactionStatement } from "../databaseNative";
import type { AiCenterRepository } from "../contracts/aiCenterRepository";
import { createId, nowIso } from "../repository";

type WriteResult = { rowsAffected: number };
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

export interface SqliteAiCenterRepositoryDependencies {
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
  executeWrite(query: string, bindValues?: unknown[]): Promise<WriteResult>;
  executeTransaction(statements: DatabaseTransactionStatement[]): Promise<unknown>;
  now?: typeof nowIso;
  createId?: typeof createId;
}

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

export class SqliteAiCenterRepository implements AiCenterRepository {
  constructor(private readonly dependencies: SqliteAiCenterRepositoryDependencies) {}

  private now(): string {
    return (this.dependencies.now ?? nowIso)();
  }

  private nextId(prefix: string): string {
    return (this.dependencies.createId ?? createId)(prefix);
  }

  async ensureAiIdentity(input: EnsureAiIdentityInput): Promise<AiIdentity> {
    const normalizedBaseUrl = input.baseUrl?.trim().replace(/\/+$/, "").toLowerCase() ?? "";
    const rows = await this.dependencies.select<AiIdentityRow[]>(
      `SELECT * FROM ai_identities WHERE profile_id = $1 AND credential_fingerprint = $2 AND provider = $3
       AND normalized_base_url = $4 AND model_route = $5 AND role = $6 LIMIT 1`,
      [input.profileId, input.credentialFingerprint, input.provider, normalizedBaseUrl, input.modelRoute, input.role],
    );
    const timestamp = this.now();
    if (rows[0]) {
      await this.dependencies.executeWrite(`UPDATE ai_identities SET credential_display = $1, provider_config_id = $2, model_id = $3,
        model_display_name = $4, route_status = 'available', last_used_at = $5, updated_at = $5 WHERE id = $6`,
      [input.credentialDisplay, input.providerConfigId, input.modelId, input.modelDisplayName, timestamp, rows[0].id]);
      return { ...mapAiIdentity(rows[0]), credentialDisplay: input.credentialDisplay, providerConfigId: input.providerConfigId, modelId: input.modelId, modelDisplayName: input.modelDisplayName, routeStatus: "available", lastUsedAt: timestamp, updatedAt: timestamp };
    }
    const identity: AiIdentity = { id: this.nextId("ai_identity"), profileId: input.profileId, credentialFingerprint: input.credentialFingerprint,
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
    await this.dependencies.executeTransaction(statements);
    return identity;
  }

  async listAiIdentities(profileId: string): Promise<AiIdentity[]> {
    const rows = await this.dependencies.select<AiIdentityRow[]>("SELECT * FROM ai_identities WHERE profile_id = $1 ORDER BY last_used_at DESC", [profileId]);
    return rows.map(mapAiIdentity);
  }

  async getViewerNoteBundle(aiIdentityId: string): Promise<ViewerNoteBundle | null> {
    const identities = await this.dependencies.select<AiIdentityRow[]>("SELECT * FROM ai_identities WHERE id = $1 LIMIT 1", [aiIdentityId]);
    if (!identities[0]) return null;
    const settingsRows = await this.dependencies.select<ViewerNoteSettingsRow[]>("SELECT * FROM ai_note_settings WHERE ai_identity_id = $1 LIMIT 1", [aiIdentityId]);
    if (!settingsRows[0]) return null;
    const settings = mapViewerNoteSettings(settingsRows[0]);
    const versions = await this.listViewerNoteVersions(aiIdentityId);
    return { identity: mapAiIdentity(identities[0]), settings, activeVersion: versions.find((item) => item.id === settings.activeVersionId), versions,
      activationEvents: await this.listViewerNoteActivationEvents(aiIdentityId), reflectionRuns: await this.listViewerNoteReflectionRuns(aiIdentityId) };
  }

  async listViewerNoteVersions(aiIdentityId: string): Promise<ViewerNoteVersion[]> {
    const rows = await this.dependencies.select<ViewerNoteVersionRow[]>("SELECT * FROM ai_note_versions WHERE ai_identity_id = $1 ORDER BY version_number DESC", [aiIdentityId]);
    return rows.map(mapViewerNoteVersion);
  }

  async listViewerNoteActivationEvents(aiIdentityId: string): Promise<ViewerNoteActivationEvent[]> {
    const rows = await this.dependencies.select<ViewerNoteActivationRow[]>("SELECT * FROM ai_note_activation_events WHERE ai_identity_id = $1 ORDER BY created_at DESC", [aiIdentityId]);
    return rows.map(mapViewerNoteActivation);
  }

  async listViewerNoteReflectionRuns(aiIdentityId: string): Promise<ViewerNoteReflectionRun[]> {
    const rows = await this.dependencies.select<ViewerNoteReflectionRunRow[]>("SELECT * FROM ai_note_reflection_runs WHERE ai_identity_id = $1 ORDER BY created_at DESC", [aiIdentityId]);
    return rows.map(mapViewerNoteReflectionRun);
  }

  async setViewerNoteCapacity(aiIdentityId: string, capacityTokens: ViewerNoteCapacity): Promise<void> {
    const rows = await this.dependencies.select<Array<{ estimated_tokens: number | null }>>(`SELECT v.estimated_tokens FROM ai_note_settings s
      LEFT JOIN ai_note_versions v ON v.id = s.active_version_id WHERE s.ai_identity_id = $1`, [aiIdentityId]);
    if (!rows.length) throw new Error("Viewer Notes settings not found.");
    if (rows[0].estimated_tokens !== null && Number(rows[0].estimated_tokens) > capacityTokens) throw new Error(`Capacity cannot be reduced below the active notes size (${rows[0].estimated_tokens} estimated tokens).`);
    await this.dependencies.executeWrite("UPDATE ai_note_settings SET capacity_tokens = $1, updated_at = $2 WHERE ai_identity_id = $3", [capacityTokens, this.now(), aiIdentityId]);
  }

  async setViewerNotesDefaultEnabled(aiIdentityId: string, enabled: boolean): Promise<void> {
    await this.dependencies.executeWrite("UPDATE ai_note_settings SET default_enabled = $1, updated_at = $2 WHERE ai_identity_id = $3", [enabled ? 1 : 0, this.now(), aiIdentityId]);
  }

  async beginViewerNoteReflection(input: BeginViewerNoteReflectionInput): Promise<ViewerNoteReflectionRun> {
    assertViewerNoteBasePair(input);
    const existing = await this.dependencies.select<ViewerNoteReflectionRunRow[]>("SELECT * FROM ai_note_reflection_runs WHERE id = $1 OR (ai_identity_id = $2 AND source_session_id = $3) LIMIT 1", [input.id, input.aiIdentityId, input.sourceSessionId]);
    if (existing[0]) return mapViewerNoteReflectionRun(existing[0]);
    const createdAt = this.now();
    await this.dependencies.executeWrite(`INSERT INTO ai_note_reflection_runs
      (id, ai_identity_id, note_type, source_session_id, source_workspace_id, base_version_id, base_content_sha256,
       reflection_packet_sha256, packet_json, attempt_count, status, created_at)
      VALUES ($1,$2,'viewer_self_notes',$3,$4,$5,$6,$7,$8,0,'PENDING',$9)`,
    [input.id, input.aiIdentityId, input.sourceSessionId, input.sourceWorkspaceId, input.baseVersionId ?? null, input.baseContentSha256 ?? null, input.reflectionPacketSha256, input.packetJson, createdAt]);
    return { ...input, noteType: "viewer_self_notes", attemptCount: 0, status: "PENDING", createdAt };
  }

  async failViewerNoteReflection(runId: string, status: Exclude<ViewerNoteReflectionRun["status"], "PENDING" | "UPDATE" | "NO_CHANGE" | "STALE_BASE">, failureMessage: string, providerRequestId?: string, rawFinalResponseSha256?: string, attemptCount = 1): Promise<void> {
    await this.dependencies.executeWrite(`UPDATE ai_note_reflection_runs SET status = $1, failure_message = $2, attempt_count = attempt_count + $3,
      provider_request_id = COALESCE($4, provider_request_id), raw_final_response_sha256 = COALESCE($5, raw_final_response_sha256), completed_at = $6 WHERE id = $7`,
    [status, failureMessage, attemptCount, providerRequestId ?? null, rawFinalResponseSha256 ?? null, this.now(), runId]);
  }

  async commitViewerNoteReflection(input: CommitViewerNoteReflectionInput): Promise<ViewerNoteReflectionResult> {
    assertViewerNoteBasePair(input);
    const existingRuns = await this.dependencies.select<ViewerNoteReflectionRunRow[]>("SELECT * FROM ai_note_reflection_runs WHERE id = $1 LIMIT 1", [input.runId]);
    const run = existingRuns[0];
    if (!run) throw new Error("Viewer Notes reflection run not found.");
    if (run.status === "UPDATE") {
      const versions = await this.dependencies.select<ViewerNoteVersionRow[]>("SELECT * FROM ai_note_versions WHERE reflection_run_id = $1 LIMIT 1", [input.runId]);
      return { status: "UPDATE", ...(versions[0] ? { version: mapViewerNoteVersion(versions[0]) } : {}) };
    }
    if (run.status === "NO_CHANGE") return { status: "NO_CHANGE" };
    const completedAt = this.now();
    if (input.decision === "NO_CHANGE") {
      await this.dependencies.executeWrite(`UPDATE ai_note_reflection_runs SET status = 'NO_CHANGE', attempt_count = attempt_count + $1, change_summary = $2,
        provider_request_id = $3, raw_final_response_sha256 = $4, completed_at = $5 WHERE id = $6`,
      [input.attemptCount ?? 1, input.changeSummary, input.providerRequestId ?? null, input.rawFinalResponseSha256, completedAt, input.runId]);
      return { status: "NO_CHANGE" };
    }
    if (!input.notes || !input.contentSha256 || input.estimatedTokens === undefined) throw new Error("Complete Viewer Notes are required for UPDATE.");
    const numberRows = await this.dependencies.select<Array<{ next_number: number }>>("SELECT COALESCE(MAX(version_number),0)+1 AS next_number FROM ai_note_versions WHERE ai_identity_id = $1", [input.aiIdentityId]);
    const versionId = this.nextId("ai_note_version");
    const activationId = this.nextId("ai_note_activation");
    const activationSource = input.baseVersionId ? "model_update" : "initial_version";
    try {
      await this.dependencies.executeTransaction([
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
        { query: `UPDATE ai_note_reflection_runs SET status = 'UPDATE', attempt_count = attempt_count + $1, change_summary = $2,
          provider_request_id = $3, raw_final_response_sha256 = $4, completed_at = $5 WHERE id = $6`, values: [input.attemptCount ?? 1, input.changeSummary, input.providerRequestId ?? null, input.rawFinalResponseSha256, completedAt, input.runId] },
      ]);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (message.includes("STALE_BASE")) {
        await this.dependencies.executeWrite("UPDATE ai_note_reflection_runs SET status = 'STALE_BASE', failure_message = $1, completed_at = $2 WHERE id = $3", ["Active Viewer Notes changed while reflection was running.", completedAt, input.runId]);
        return { status: "STALE_BASE" };
      }
      throw cause;
    }
    const versionRows = await this.dependencies.select<ViewerNoteVersionRow[]>("SELECT * FROM ai_note_versions WHERE id = $1", [versionId]);
    return { status: "UPDATE", version: mapViewerNoteVersion(versionRows[0]) };
  }

  async restoreViewerNoteVersion(aiIdentityId: string, versionId: string, workspaceId?: string): Promise<void> {
    const rows = await this.dependencies.select<Array<{ active_version_id: string | null; capacity_tokens: number; estimated_tokens: number }>>(`SELECT s.active_version_id, s.capacity_tokens, v.estimated_tokens
      FROM ai_note_settings s JOIN ai_note_versions v ON v.id = $1 AND v.ai_identity_id = s.ai_identity_id WHERE s.ai_identity_id = $2`, [versionId, aiIdentityId]);
    if (!rows[0]) throw new Error("Viewer Notes version not found.");
    if (Number(rows[0].estimated_tokens) > Number(rows[0].capacity_tokens)) throw new Error("The selected version does not fit the current capacity.");
    const timestamp = this.now();
    await this.dependencies.executeTransaction([
      { query: "UPDATE ai_note_settings SET active_version_id = $1, updated_at = $2 WHERE ai_identity_id = $3", values: [versionId, timestamp, aiIdentityId] },
      { query: `INSERT INTO ai_note_activation_events (id, ai_identity_id, from_version_id, to_version_id, activation_source, workspace_id, created_at)
        VALUES ($1,$2,$3,$4,'human_restore',$5,$6)`, values: [this.nextId("ai_note_activation"), aiIdentityId, rows[0].active_version_id, versionId, workspaceId ?? null, timestamp] },
    ]);
  }
}
