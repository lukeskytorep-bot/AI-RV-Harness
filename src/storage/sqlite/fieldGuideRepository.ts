import type {
  CreateFieldGuideVersionInput,
  FieldGuideActivationEvent,
  FieldGuideBundle,
  FieldGuideCapacity,
  FieldGuideLegacyBaseline,
  FieldGuideSettings,
  FieldGuideSourceSnapshot,
  FieldGuideVersion,
  ResolveLegacyFieldGuideBaselineInput,
} from "../../aiCenter/fieldGuideTypes";
import type { AiIdentity } from "../../aiCenter/types";
import type { DatabaseTransactionStatement } from "../databaseNative";
import type { FieldGuideRepository } from "../contracts/fieldGuideRepository";
import { createId, nowIso } from "../repository";

type WriteResult = { rowsAffected: number };
type SettingsRow = { ai_identity_id: string; language: "pl" | "en"; capacity_tokens: FieldGuideCapacity; active_version_id: string | null; updated_at: string };
type VersionRow = {
  id: string; ai_identity_id: string; language: "pl" | "en"; version_number: number; content: string; content_sha256: string; estimated_tokens: number;
  estimator_version: "conservative-char-v1"; capacity_tokens_at_creation: FieldGuideCapacity; source_training_run_id: string | null; source_session_id: string | null;
  source_snapshot_json: string; lexicon_id: string | null; lexicon_version: string | null; previous_version_id: string | null; restored_from_version_id: string | null; created_at: string;
};
type ActivationRow = { id: string; ai_identity_id: string; language: "pl" | "en"; from_version_id: string | null; to_version_id: string; activation_source: FieldGuideActivationEvent["activationSource"]; created_at: string };
type LegacyRow = { id: string; profile_id: string; original_content: string; source_profile_updated_at: string; resolution_status: FieldGuideLegacyBaseline["resolutionStatus"]; resolved_ai_identity_id: string | null; resolved_language: "pl" | "en" | null; resolved_version_id: string | null; created_at: string; resolved_at: string | null };
type IdentityRow = { id: string; profile_id: string; role: AiIdentity["role"] };

export interface SqliteFieldGuideRepositoryDependencies {
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
  executeWrite(query: string, bindValues?: unknown[]): Promise<WriteResult>;
  executeTransaction(statements: DatabaseTransactionStatement[]): Promise<unknown>;
  now?: typeof nowIso;
  createId?: typeof createId;
}

function parseSnapshot(value: string): FieldGuideSourceSnapshot {
  const parsed = JSON.parse(value) as FieldGuideSourceSnapshot;
  if (parsed.schemaVersion !== 1) throw new Error("Unsupported Field Guide source snapshot version.");
  return parsed;
}

function mapSettings(row: SettingsRow): FieldGuideSettings {
  return { aiIdentityId: row.ai_identity_id, language: row.language, capacityTokens: Number(row.capacity_tokens) as FieldGuideCapacity, ...(row.active_version_id ? { activeVersionId: row.active_version_id } : {}), updatedAt: row.updated_at };
}

function mapVersion(row: VersionRow, activeVersionId?: string): FieldGuideVersion {
  return {
    id: row.id, aiIdentityId: row.ai_identity_id, language: row.language, versionNumber: Number(row.version_number), content: row.content, contentSha256: row.content_sha256,
    estimatedTokens: Number(row.estimated_tokens), estimatorVersion: row.estimator_version, capacityTokensAtCreation: Number(row.capacity_tokens_at_creation) as FieldGuideCapacity,
    activationStatus: row.id === activeVersionId ? "active" : "historical",
    ...(row.source_training_run_id ? { sourceTrainingRunId: row.source_training_run_id } : {}), ...(row.source_session_id ? { sourceSessionId: row.source_session_id } : {}),
    sourceSnapshot: parseSnapshot(row.source_snapshot_json), ...(row.lexicon_id ? { lexiconId: row.lexicon_id } : {}), ...(row.lexicon_version ? { lexiconVersion: row.lexicon_version } : {}),
    ...(row.previous_version_id ? { previousVersionId: row.previous_version_id } : {}), ...(row.restored_from_version_id ? { restoredFromVersionId: row.restored_from_version_id } : {}), createdAt: row.created_at,
  };
}

function mapActivation(row: ActivationRow): FieldGuideActivationEvent {
  return { id: row.id, aiIdentityId: row.ai_identity_id, language: row.language, ...(row.from_version_id ? { fromVersionId: row.from_version_id } : {}), toVersionId: row.to_version_id, activationSource: row.activation_source, createdAt: row.created_at };
}

function mapLegacy(row: LegacyRow): FieldGuideLegacyBaseline {
  return { id: row.id, profileId: row.profile_id, originalContent: row.original_content, sourceProfileUpdatedAt: row.source_profile_updated_at, resolutionStatus: row.resolution_status, ...(row.resolved_ai_identity_id ? { resolvedAiIdentityId: row.resolved_ai_identity_id } : {}), ...(row.resolved_language ? { resolvedLanguage: row.resolved_language } : {}), ...(row.resolved_version_id ? { resolvedVersionId: row.resolved_version_id } : {}), createdAt: row.created_at, ...(row.resolved_at ? { resolvedAt: row.resolved_at } : {}) };
}

export class SqliteFieldGuideRepository implements FieldGuideRepository {
  constructor(private readonly dependencies: SqliteFieldGuideRepositoryDependencies) {}
  private now() { return (this.dependencies.now ?? nowIso)(); }
  private nextId(prefix: string) { return (this.dependencies.createId ?? createId)(prefix); }

  private async ensureSettings(aiIdentityId: string, language: "pl" | "en"): Promise<FieldGuideSettings> {
    const rows = await this.dependencies.select<SettingsRow[]>("SELECT * FROM field_guide_settings WHERE ai_identity_id = $1 AND language = $2 LIMIT 1", [aiIdentityId, language]);
    if (rows[0]) return mapSettings(rows[0]);
    const timestamp = this.now();
    const capacityTokens: FieldGuideCapacity = 2048;
    await this.dependencies.executeWrite("INSERT INTO field_guide_settings (ai_identity_id, language, capacity_tokens, updated_at) VALUES ($1,$2,$3,$4)", [aiIdentityId, language, capacityTokens, timestamp]);
    return { aiIdentityId, language, capacityTokens, updatedAt: timestamp };
  }

  async getFieldGuideBundle(aiIdentityId: string, language: "pl" | "en"): Promise<FieldGuideBundle | null> {
    const identities = await this.dependencies.select<IdentityRow[]>("SELECT id, profile_id, role FROM ai_identities WHERE id = $1 LIMIT 1", [aiIdentityId]);
    if (!identities[0] || identities[0].role !== "viewer") return null;
    const settings = await this.ensureSettings(aiIdentityId, language);
    const versions = await this.listFieldGuideVersions(aiIdentityId, language);
    const withStatus = versions.map((version) => ({ ...version, activationStatus: version.id === settings.activeVersionId ? "active" as const : "historical" as const }));
    return { identityId: aiIdentityId, language, settings, activeVersion: withStatus.find((item) => item.activationStatus === "active"), versions: withStatus, activationEvents: await this.listFieldGuideActivationEvents(aiIdentityId, language) };
  }

  async listFieldGuideVersions(aiIdentityId: string, language: "pl" | "en"): Promise<FieldGuideVersion[]> {
    const settingsRows = await this.dependencies.select<SettingsRow[]>("SELECT * FROM field_guide_settings WHERE ai_identity_id = $1 AND language = $2 LIMIT 1", [aiIdentityId, language]);
    const rows = await this.dependencies.select<VersionRow[]>("SELECT * FROM field_guide_versions WHERE ai_identity_id = $1 AND language = $2 ORDER BY version_number DESC", [aiIdentityId, language]);
    return rows.map((row) => mapVersion(row, settingsRows[0]?.active_version_id ?? undefined));
  }

  async listFieldGuideActivationEvents(aiIdentityId: string, language: "pl" | "en"): Promise<FieldGuideActivationEvent[]> {
    const rows = await this.dependencies.select<ActivationRow[]>("SELECT * FROM field_guide_activation_events WHERE ai_identity_id = $1 AND language = $2 ORDER BY created_at DESC", [aiIdentityId, language]);
    return rows.map(mapActivation);
  }

  async listFieldGuideLegacyBaselines(profileId: string): Promise<FieldGuideLegacyBaseline[]> {
    const rows = await this.dependencies.select<LegacyRow[]>("SELECT * FROM field_guide_legacy_baselines WHERE profile_id = $1 ORDER BY created_at DESC", [profileId]);
    return rows.map(mapLegacy);
  }

  async createFieldGuideVersion(input: CreateFieldGuideVersionInput): Promise<FieldGuideVersion> {
    if (input.legacyBaselineId) {
      const baselines = await this.dependencies.select<LegacyRow[]>("SELECT * FROM field_guide_legacy_baselines WHERE id = $1 LIMIT 1", [input.legacyBaselineId]);
      const baseline = baselines[0];
      if (!baseline || baseline.resolution_status !== "unresolved") throw new Error("Legacy Field Guide baseline is missing or already resolved.");
      const identities = await this.dependencies.select<IdentityRow[]>("SELECT id, profile_id, role FROM ai_identities WHERE id = $1 LIMIT 1", [input.aiIdentityId]);
      const identity = identities[0];
      if (!identity || identity.profile_id !== baseline.profile_id || identity.role !== "viewer") throw new Error("Legacy Field Guide baseline can only be linked to a Viewer identity from the same Profile.");
    }
    const settings = await this.ensureSettings(input.aiIdentityId, input.language);
    if (input.estimatedTokens > settings.capacityTokens) throw new Error("Field Guide content exceeds the configured capacity.");
    const maxRows = await this.dependencies.select<Array<{ max_version: number | null }>>("SELECT MAX(version_number) AS max_version FROM field_guide_versions WHERE ai_identity_id = $1 AND language = $2", [input.aiIdentityId, input.language]);
    const versionNumber = Number(maxRows[0]?.max_version ?? 0) + 1;
    const createdAt = this.now();
    const versionId = this.nextId("field_guide_version");
    const activationId = this.nextId("field_guide_activation");
    const previousVersionId = input.previousVersionId ?? settings.activeVersionId;
    const statements: DatabaseTransactionStatement[] = [
      { query: "INSERT INTO field_guide_versions (id, ai_identity_id, language, version_number, content, content_sha256, estimated_tokens, estimator_version, capacity_tokens_at_creation, source_training_run_id, source_session_id, source_snapshot_json, lexicon_id, lexicon_version, previous_version_id, restored_from_version_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'conservative-char-v1',$8,$9,$10,$11,$12,$13,$14,$15,$16)", values: [versionId, input.aiIdentityId, input.language, versionNumber, input.content, input.contentSha256, input.estimatedTokens, settings.capacityTokens, input.sourceTrainingRunId ?? null, input.sourceSessionId ?? null, JSON.stringify(input.sourceSnapshot), input.lexiconId ?? null, input.lexiconVersion ?? null, previousVersionId ?? null, input.restoredFromVersionId ?? null, createdAt] },
      { query: "INSERT INTO field_guide_activation_events (id, ai_identity_id, language, from_version_id, to_version_id, activation_source, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)", values: [activationId, input.aiIdentityId, input.language, settings.activeVersionId ?? null, versionId, input.activationSource, createdAt] },
      { query: "UPDATE field_guide_settings SET active_version_id = $1, updated_at = $2 WHERE ai_identity_id = $3 AND language = $4", values: [versionId, createdAt, input.aiIdentityId, input.language] },
    ];
    if (input.legacyBaselineId) statements.push({ query: "UPDATE field_guide_legacy_baselines SET resolution_status = 'resolved', resolved_ai_identity_id = $1, resolved_language = $2, resolved_version_id = $3, resolved_at = $4 WHERE id = $5 AND resolution_status = 'unresolved'", values: [input.aiIdentityId, input.language, versionId, createdAt, input.legacyBaselineId] });
    await this.dependencies.executeTransaction(statements);
    return { id: versionId, aiIdentityId: input.aiIdentityId, language: input.language, versionNumber, content: input.content, contentSha256: input.contentSha256, estimatedTokens: input.estimatedTokens, estimatorVersion: "conservative-char-v1", capacityTokensAtCreation: settings.capacityTokens, activationStatus: "active", ...(input.sourceTrainingRunId ? { sourceTrainingRunId: input.sourceTrainingRunId } : {}), ...(input.sourceSessionId ? { sourceSessionId: input.sourceSessionId } : {}), sourceSnapshot: input.sourceSnapshot, ...(input.lexiconId ? { lexiconId: input.lexiconId } : {}), ...(input.lexiconVersion ? { lexiconVersion: input.lexiconVersion } : {}), ...(previousVersionId ? { previousVersionId } : {}), ...(input.restoredFromVersionId ? { restoredFromVersionId: input.restoredFromVersionId } : {}), createdAt };
  }

  async resolveLegacyFieldGuideBaseline(input: ResolveLegacyFieldGuideBaselineInput): Promise<FieldGuideVersion> {
    const baselines = await this.dependencies.select<LegacyRow[]>("SELECT * FROM field_guide_legacy_baselines WHERE id = $1 LIMIT 1", [input.baselineId]);
    const baseline = baselines[0];
    if (!baseline || baseline.resolution_status !== "unresolved") throw new Error("Legacy Field Guide baseline is missing or already resolved.");
    const identities = await this.dependencies.select<IdentityRow[]>("SELECT id, profile_id, role FROM ai_identities WHERE id = $1 LIMIT 1", [input.aiIdentityId]);
    const identity = identities[0];
    if (!identity || identity.profile_id !== baseline.profile_id || identity.role !== "viewer") throw new Error("Legacy Field Guide baseline can only be linked to a Viewer identity from the same Profile.");
    return this.createFieldGuideVersion({ ...input, activationSource: "legacy_profile_baseline", legacyBaselineId: input.baselineId });
  }

  async setFieldGuideCapacity(aiIdentityId: string, language: "pl" | "en", capacityTokens: FieldGuideCapacity): Promise<void> {
    if (![2048, 4096, 8192].includes(capacityTokens)) throw new Error("Unsupported Field Guide capacity.");
    const bundle = await this.getFieldGuideBundle(aiIdentityId, language);
    if (!bundle) throw new Error("Field Guide identity not found.");
    if (bundle.activeVersion && bundle.activeVersion.estimatedTokens > capacityTokens) throw new Error(`Capacity cannot be reduced below the active Field Guide size (${bundle.activeVersion.estimatedTokens} estimated tokens).`);
    await this.dependencies.executeWrite("UPDATE field_guide_settings SET capacity_tokens = $1, updated_at = $2 WHERE ai_identity_id = $3 AND language = $4", [capacityTokens, this.now(), aiIdentityId, language]);
  }

  async restoreFieldGuideVersion(aiIdentityId: string, language: "pl" | "en", versionId: string): Promise<FieldGuideVersion> {
    const bundle = await this.getFieldGuideBundle(aiIdentityId, language);
    const source = bundle?.versions.find((item) => item.id === versionId);
    if (!bundle || !source) throw new Error("Field Guide version not found.");
    if (source.estimatedTokens > bundle.settings.capacityTokens) throw new Error("The selected Field Guide version does not fit the current capacity.");
    return this.createFieldGuideVersion({ aiIdentityId, language, content: source.content, contentSha256: source.contentSha256, estimatedTokens: source.estimatedTokens, sourceSnapshot: { schemaVersion: 1, sourceKind: "human-restore", profileId: source.sourceSnapshot.profileId, capturedAt: this.now(), restoredFromVersionId: source.id, ...(source.lexiconId ? { lexiconId: source.lexiconId } : {}), ...(source.lexiconVersion ? { lexiconVersion: source.lexiconVersion } : {}) }, ...(bundle.settings.activeVersionId ? { previousVersionId: bundle.settings.activeVersionId } : {}), restoredFromVersionId: source.id, ...(source.lexiconId ? { lexiconId: source.lexiconId } : {}), ...(source.lexiconVersion ? { lexiconVersion: source.lexiconVersion } : {}), activationSource: "human_restore" });
  }
}
