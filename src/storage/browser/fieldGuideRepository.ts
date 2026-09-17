import type {
  CreateFieldGuideVersionInput,
  FieldGuideActivationEvent,
  FieldGuideBundle,
  FieldGuideCapacity,
  FieldGuideLegacyBaseline,
  FieldGuideSettings,
  FieldGuideVersion,
  ResolveLegacyFieldGuideBaselineInput,
} from "../../aiCenter/fieldGuideTypes";
import type { AiIdentity } from "../../aiCenter/types";
import type { FieldGuideRepository } from "../contracts/fieldGuideRepository";
import { createId, nowIso } from "../repository";

const AI_IDENTITIES_KEY = "rvh.dev.ai_identities";
const FIELD_GUIDE_SETTINGS_KEY = "rvh.dev.field_guide_settings";
const FIELD_GUIDE_VERSIONS_KEY = "rvh.dev.field_guide_versions";
const FIELD_GUIDE_ACTIVATIONS_KEY = "rvh.dev.field_guide_activation_events";
const FIELD_GUIDE_LEGACY_BASELINES_KEY = "rvh.dev.field_guide_legacy_baselines";

export interface BrowserFieldGuideRepositoryDependencies {
  storage?: Storage;
  now?: typeof nowIso;
  createId?: typeof createId;
}

export class BrowserFieldGuideRepository implements FieldGuideRepository {
  private readonly storage: Storage;

  constructor(private readonly dependencies: BrowserFieldGuideRepositoryDependencies = {}) {
    this.storage = dependencies.storage ?? localStorage;
  }

  private read<T>(key: string, fallback: T): T {
    try { const raw = this.storage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; }
    catch { return fallback; }
  }

  private write<T>(key: string, value: T) { this.storage.setItem(key, JSON.stringify(value)); }
  private now() { return (this.dependencies.now ?? nowIso)(); }
  private nextId(prefix: string) { return (this.dependencies.createId ?? createId)(prefix); }

  private ensureSettings(aiIdentityId: string, language: "pl" | "en", capacityTokens = 2048 as FieldGuideCapacity): FieldGuideSettings {
    const all = this.read<FieldGuideSettings[]>(FIELD_GUIDE_SETTINGS_KEY, []);
    const existing = all.find((item) => item.aiIdentityId === aiIdentityId && item.language === language);
    if (existing) return existing;
    const created: FieldGuideSettings = { aiIdentityId, language, capacityTokens, updatedAt: this.now() };
    this.write(FIELD_GUIDE_SETTINGS_KEY, [...all, created]);
    return created;
  }

  async getFieldGuideBundle(aiIdentityId: string, language: "pl" | "en"): Promise<FieldGuideBundle | null> {
    const identity = this.read<AiIdentity[]>(AI_IDENTITIES_KEY, []).find((item) => item.id === aiIdentityId);
    if (!identity || identity.role !== "viewer") return null;
    const settings = this.ensureSettings(aiIdentityId, language);
    const rawVersions = this.read<FieldGuideVersion[]>(FIELD_GUIDE_VERSIONS_KEY, [])
      .filter((item) => item.aiIdentityId === aiIdentityId && item.language === language)
      .sort((a, b) => b.versionNumber - a.versionNumber);
    const versions = rawVersions.map((item) => ({ ...item, activationStatus: item.id === settings.activeVersionId ? "active" as const : "historical" as const }));
    const activationEvents = await this.listFieldGuideActivationEvents(aiIdentityId, language);
    return { identityId: aiIdentityId, language, settings, activeVersion: versions.find((item) => item.activationStatus === "active"), versions, activationEvents };
  }

  async listFieldGuideVersions(aiIdentityId: string, language: "pl" | "en") {
    return (await this.getFieldGuideBundle(aiIdentityId, language))?.versions ?? [];
  }

  async listFieldGuideActivationEvents(aiIdentityId: string, language: "pl" | "en") {
    return this.read<FieldGuideActivationEvent[]>(FIELD_GUIDE_ACTIVATIONS_KEY, [])
      .filter((item) => item.aiIdentityId === aiIdentityId && item.language === language)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listFieldGuideLegacyBaselines(profileId: string) {
    let all = this.read<FieldGuideLegacyBaseline[]>(FIELD_GUIDE_LEGACY_BASELINES_KEY, []);
    if (!all.some((item) => item.profileId === profileId)) {
      const profile = this.read<Array<{ id: string; defaultViewerSystemPrompt?: string; updatedAt: string }>>("rvh.dev.profiles", []).find((item) => item.id === profileId);
      const originalContent = profile?.defaultViewerSystemPrompt?.trim();
      if (profile && originalContent) {
        const baseline: FieldGuideLegacyBaseline = {
          id: `field_guide_legacy_${profile.id}`,
          profileId: profile.id,
          originalContent,
          sourceProfileUpdatedAt: profile.updatedAt,
          resolutionStatus: "unresolved",
          createdAt: profile.updatedAt,
        };
        all = [baseline, ...all];
        this.write(FIELD_GUIDE_LEGACY_BASELINES_KEY, all);
      }
    }
    return all.filter((item) => item.profileId === profileId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createFieldGuideVersion(input: CreateFieldGuideVersionInput): Promise<FieldGuideVersion> {
    const identity = this.read<AiIdentity[]>(AI_IDENTITIES_KEY, []).find((item) => item.id === input.aiIdentityId);
    if (!identity || identity.role !== "viewer") throw new Error("Field Guide versions require an exact Viewer identity.");
    if (input.legacyBaselineId) {
      const baseline = this.read<FieldGuideLegacyBaseline[]>(FIELD_GUIDE_LEGACY_BASELINES_KEY, []).find((item) => item.id === input.legacyBaselineId);
      if (!baseline || baseline.resolutionStatus !== "unresolved") throw new Error("Legacy Field Guide baseline is missing or already resolved.");
      if (baseline.profileId !== identity.profileId) throw new Error("Legacy Field Guide baseline can only be linked to a Viewer identity from the same Profile.");
    }
    const settings = this.ensureSettings(input.aiIdentityId, input.language);
    if (input.estimatedTokens > settings.capacityTokens) throw new Error("Field Guide content exceeds the configured capacity.");
    const allVersions = this.read<FieldGuideVersion[]>(FIELD_GUIDE_VERSIONS_KEY, []);
    for (const lineageId of [input.previousVersionId, input.restoredFromVersionId].filter((value): value is string => Boolean(value))) {
      const lineage = allVersions.find((item) => item.id === lineageId);
      if (!lineage || lineage.aiIdentityId !== input.aiIdentityId || lineage.language !== input.language) {
        throw new Error("Field Guide version lineage cannot cross Viewer identity or language.");
      }
    }
    const currentVersions = allVersions.filter((item) => item.aiIdentityId === input.aiIdentityId && item.language === input.language);
    const versionNumber = Math.max(0, ...currentVersions.map((item) => item.versionNumber)) + 1;
    const createdAt = this.now();
    const previousVersionId = input.previousVersionId ?? settings.activeVersionId;
    const version: FieldGuideVersion = {
      id: this.nextId("field_guide_version"), aiIdentityId: input.aiIdentityId, language: input.language, versionNumber,
      content: input.content, contentSha256: input.contentSha256, estimatedTokens: input.estimatedTokens,
      estimatorVersion: "conservative-char-v1", capacityTokensAtCreation: settings.capacityTokens, activationStatus: "active",
      ...(input.sourceTrainingRunId ? { sourceTrainingRunId: input.sourceTrainingRunId } : {}),
      ...(input.sourceSessionId ? { sourceSessionId: input.sourceSessionId } : {}), sourceSnapshot: input.sourceSnapshot,
      ...(input.lexiconId ? { lexiconId: input.lexiconId } : {}), ...(input.lexiconVersion ? { lexiconVersion: input.lexiconVersion } : {}),
      ...(previousVersionId ? { previousVersionId } : {}),
      ...(input.restoredFromVersionId ? { restoredFromVersionId: input.restoredFromVersionId } : {}), createdAt,
    };
    this.write(FIELD_GUIDE_VERSIONS_KEY, [version, ...allVersions]);
    this.write(FIELD_GUIDE_SETTINGS_KEY, this.read<FieldGuideSettings[]>(FIELD_GUIDE_SETTINGS_KEY, []).map((item) => item.aiIdentityId === input.aiIdentityId && item.language === input.language ? { ...item, activeVersionId: version.id, updatedAt: createdAt } : item));
    const event: FieldGuideActivationEvent = { id: this.nextId("field_guide_activation"), aiIdentityId: input.aiIdentityId, language: input.language, ...(settings.activeVersionId ? { fromVersionId: settings.activeVersionId } : {}), toVersionId: version.id, activationSource: input.activationSource, createdAt };
    this.write(FIELD_GUIDE_ACTIVATIONS_KEY, [event, ...this.read<FieldGuideActivationEvent[]>(FIELD_GUIDE_ACTIVATIONS_KEY, [])]);
    if (input.legacyBaselineId) {
      this.write(FIELD_GUIDE_LEGACY_BASELINES_KEY, this.read<FieldGuideLegacyBaseline[]>(FIELD_GUIDE_LEGACY_BASELINES_KEY, []).map((item) => item.id === input.legacyBaselineId ? { ...item, resolutionStatus: "resolved", resolvedAiIdentityId: input.aiIdentityId, resolvedLanguage: input.language, resolvedVersionId: version.id, resolvedAt: createdAt } : item));
    }
    return version;
  }

  async resolveLegacyFieldGuideBaseline(input: ResolveLegacyFieldGuideBaselineInput): Promise<FieldGuideVersion> {
    const baseline = this.read<FieldGuideLegacyBaseline[]>(FIELD_GUIDE_LEGACY_BASELINES_KEY, []).find((item) => item.id === input.baselineId);
    if (!baseline) throw new Error("Legacy Field Guide baseline not found.");
    if (baseline.resolutionStatus !== "unresolved") throw new Error("Legacy Field Guide baseline is already resolved.");
    const identity = this.read<AiIdentity[]>(AI_IDENTITIES_KEY, []).find((item) => item.id === input.aiIdentityId);
    if (!identity || identity.profileId !== baseline.profileId || identity.role !== "viewer") throw new Error("Legacy Field Guide baseline can only be linked to a Viewer identity from the same Profile.");
    return this.createFieldGuideVersion({ ...input, activationSource: "legacy_profile_baseline", legacyBaselineId: input.baselineId });
  }

  async setFieldGuideCapacity(aiIdentityId: string, language: "pl" | "en", capacityTokens: FieldGuideCapacity) {
    if (![2048, 4096, 8192].includes(capacityTokens)) throw new Error("Unsupported Field Guide capacity.");
    const bundle = await this.getFieldGuideBundle(aiIdentityId, language);
    if (!bundle) throw new Error("Field Guide identity not found.");
    if (bundle.activeVersion && bundle.activeVersion.estimatedTokens > capacityTokens) throw new Error(`Capacity cannot be reduced below the active Field Guide size (${bundle.activeVersion.estimatedTokens} estimated tokens).`);
    const timestamp = this.now();
    this.write(FIELD_GUIDE_SETTINGS_KEY, this.read<FieldGuideSettings[]>(FIELD_GUIDE_SETTINGS_KEY, []).map((item) => item.aiIdentityId === aiIdentityId && item.language === language ? { ...item, capacityTokens, updatedAt: timestamp } : item));
  }

  async restoreFieldGuideVersion(aiIdentityId: string, language: "pl" | "en", versionId: string): Promise<FieldGuideVersion> {
    const bundle = await this.getFieldGuideBundle(aiIdentityId, language);
    const source = bundle?.versions.find((item) => item.id === versionId);
    if (!bundle || !source) throw new Error("Field Guide version not found.");
    if (source.estimatedTokens > bundle.settings.capacityTokens) throw new Error("The selected Field Guide version does not fit the current capacity.");
    return this.createFieldGuideVersion({
      aiIdentityId, language, content: source.content, contentSha256: source.contentSha256, estimatedTokens: source.estimatedTokens,
      sourceSnapshot: { schemaVersion: 1, sourceKind: "human-restore", profileId: source.sourceSnapshot.profileId, capturedAt: this.now(), restoredFromVersionId: source.id, ...(source.lexiconId ? { lexiconId: source.lexiconId } : {}), ...(source.lexiconVersion ? { lexiconVersion: source.lexiconVersion } : {}) },
      ...(bundle.settings.activeVersionId ? { previousVersionId: bundle.settings.activeVersionId } : {}), restoredFromVersionId: source.id,
      ...(source.lexiconId ? { lexiconId: source.lexiconId } : {}), ...(source.lexiconVersion ? { lexiconVersion: source.lexiconVersion } : {}), activationSource: "human_restore",
    });
  }
}
