import type { AiIdentity } from "../aiCenter/types";
import type { FieldGuideBundle, FieldGuideVersion } from "../aiCenter/fieldGuideTypes";
import { sha256Text } from "../application/sha256";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import {
  buildEffectiveViewerPrompt,
  LOCKED_BASE_VOCABULARY_VERSION,
  LOCKED_IDENTITY_VERSION,
  VIEWER_PROMPT_VERSION,
} from "../resources/systemPrompts";
import type { AppRepository } from "../storage/repository";
import type { InterfaceLanguage, ViewerSystemPromptSnapshot } from "../types";
import type { ResearchFieldGuideSnapshot } from "./types";

export const RESEARCH_FIELD_GUIDE_HISTORY_LIMIT = 6;
export const RESEARCH_FIELD_GUIDE_MIN_SELECTION = 2;
export const RESEARCH_FIELD_GUIDE_MAX_SELECTION = 4;

export function researchLockedViewerVersions() {
  return {
    lockedCoreIdentityVersion: LOCKED_IDENTITY_VERSION,
    lockedBaseVocabularyVersion: LOCKED_BASE_VOCABULARY_VERSION,
  } as const;
}

export async function lockedOnlyResearchPrompt(language: InterfaceLanguage): Promise<ViewerSystemPromptSnapshot> {
  const content = buildEffectiveViewerPrompt(language, "");
  return {
    id: `research_locked_viewer_${language}`,
    version: `${VIEWER_PROMPT_VERSION}:research-locked-only`,
    content,
    contentSha256: await sha256Text(content),
  };
}

export async function manualResearchPromptSnapshot(
  _language: InterfaceLanguage,
  editable: string,
  id: string,
): Promise<ViewerSystemPromptSnapshot> {
  const content = editable.trim();
  if (!content) throw new Error("Manual Research prompt must not be empty.");
  return {
    id,
    version: "1",
    content,
    contentSha256: await sha256Text(content),
  };
}

export async function researchPromptFromFieldGuide(snapshot: ResearchFieldGuideSnapshot): Promise<ViewerSystemPromptSnapshot> {
  const content = buildEffectiveViewerPrompt(snapshot.language, snapshot.content);
  return {
    id: `research_field_guide_${snapshot.aiIdentityId}_${snapshot.language}`,
    version: `${VIEWER_PROMPT_VERSION}:field-guide:${snapshot.versionId}`,
    content,
    contentSha256: await sha256Text(content),
    fieldGuide: snapshot,
  };
}

export async function captureCurrentResearchFieldGuide(input: {
  repository: AppRepository;
  profileId: string;
  providerConfig: ProviderConfig;
  model: ProviderModel;
  language: InterfaceLanguage;
  capturedAt?: string;
}): Promise<ResearchFieldGuideSnapshot> {
  const identity = await findExactResearchViewerIdentity(input.repository, input.profileId, input.providerConfig, input.model);
  const bundle = await input.repository.getExistingFieldGuideBundle(identity.id, input.language);
  if (!bundle?.activeVersion) {
    throw new Error("The selected Viewer identity has no active Field Guide. Open Viewer Learning or run a normal Viewer/Training session first; Research never creates Field Guide versions.");
  }
  return researchFieldGuideSnapshot(identity, bundle, bundle.activeVersion, input.model.route, input.capturedAt ?? new Date().toISOString());
}

export async function listResearchFieldGuideHistory(input: {
  repository: AppRepository;
  profileId: string;
  providerConfig: ProviderConfig;
  model: ProviderModel;
  language: InterfaceLanguage;
  limit?: number;
}): Promise<ResearchFieldGuideSnapshot[]> {
  const identity = await findExactResearchViewerIdentity(input.repository, input.profileId, input.providerConfig, input.model);
  const bundle = await input.repository.getExistingFieldGuideBundle(identity.id, input.language);
  if (!bundle) return [];
  const limit = Math.max(1, Math.min(input.limit ?? RESEARCH_FIELD_GUIDE_HISTORY_LIMIT, RESEARCH_FIELD_GUIDE_HISTORY_LIMIT));
  const capturedAt = new Date().toISOString();
  return bundle.versions
    .filter((version) => version.aiIdentityId === identity.id && version.language === input.language)
    .slice(0, limit)
    .map((version) => researchFieldGuideSnapshot(identity, bundle, version, input.model.route, capturedAt));
}

export function validateResearchFieldGuideSelection(
  versions: ResearchFieldGuideSnapshot[],
  selectedVersionIds: string[],
  expectedIdentityId: string,
  expectedLanguage: InterfaceLanguage,
): ResearchFieldGuideSnapshot[] {
  const selected = [...new Set(selectedVersionIds)]
    .map((id) => versions.find((version) => version.versionId === id))
    .filter((version): version is ResearchFieldGuideSnapshot => Boolean(version));
  if (selected.length < RESEARCH_FIELD_GUIDE_MIN_SELECTION || selected.length > RESEARCH_FIELD_GUIDE_MAX_SELECTION) {
    throw new RangeError(`Select between ${RESEARCH_FIELD_GUIDE_MIN_SELECTION} and ${RESEARCH_FIELD_GUIDE_MAX_SELECTION} Field Guide versions.`);
  }
  if (selected.some((version) => version.aiIdentityId !== expectedIdentityId)) {
    throw new Error("Field Guide history selection contains a version from another Viewer identity.");
  }
  if (selected.some((version) => version.language !== expectedLanguage)) {
    throw new Error("Field Guide history selection contains a version from another language.");
  }
  return selected;
}

export function fieldGuideSnapshotSignature(snapshot: ResearchFieldGuideSnapshot | undefined): string {
  if (!snapshot) return "__none__";
  return JSON.stringify({
    aiIdentityId: snapshot.aiIdentityId,
    language: snapshot.language,
    versionId: snapshot.versionId,
    versionNumber: snapshot.versionNumber,
    contentSha256: snapshot.contentSha256,
    content: snapshot.content,
    versionCreatedAt: snapshot.versionCreatedAt,
    capacityTokens: snapshot.capacityTokens,
    capacityTokensAtCreation: snapshot.capacityTokensAtCreation,
    modelRoute: snapshot.modelRoute,
    sourceKind: snapshot.sourceKind,
    sourceTrainingRunId: snapshot.sourceTrainingRunId ?? null,
    sourceSessionId: snapshot.sourceSessionId ?? null,
    sourceSnapshot: snapshot.sourceSnapshot,
    identity: snapshot.identity,
  });
}

function researchFieldGuideSnapshot(
  identity: AiIdentity,
  bundle: FieldGuideBundle,
  version: FieldGuideVersion,
  modelRoute: string,
  capturedAt: string,
): ResearchFieldGuideSnapshot {
  return {
    aiIdentityId: version.aiIdentityId,
    language: version.language,
    versionId: version.id,
    versionNumber: version.versionNumber,
    versionCreatedAt: version.createdAt,
    content: version.content,
    contentSha256: version.contentSha256,
    estimatedTokens: version.estimatedTokens,
    estimatorVersion: "conservative-char-v1",
    capacityTokens: bundle.settings.capacityTokens,
    capacityTokensAtCreation: version.capacityTokensAtCreation,
    modelRoute,
    capturedAt,
    sourceKind: version.sourceSnapshot.sourceKind,
    ...(version.lexiconId ? { lexiconId: version.lexiconId } : {}),
    ...(version.lexiconVersion ? { lexiconVersion: version.lexiconVersion } : {}),
    ...(version.sourceTrainingRunId ? { sourceTrainingRunId: version.sourceTrainingRunId } : {}),
    ...(version.sourceSessionId ? { sourceSessionId: version.sourceSessionId } : {}),
    sourceSnapshot: structuredClone(version.sourceSnapshot),
    identity: {
      aiIdentityId: identity.id,
      profileId: identity.profileId,
      credentialFingerprint: identity.credentialFingerprint,
      providerConfigId: identity.providerConfigId,
      provider: identity.provider,
      ...(identity.normalizedBaseUrl ? { normalizedBaseUrl: identity.normalizedBaseUrl } : {}),
      modelId: identity.modelId,
      modelRoute: identity.modelRoute,
    },
  };
}

async function findExactResearchViewerIdentity(
  repository: AppRepository,
  profileId: string,
  providerConfig: ProviderConfig,
  model: ProviderModel,
): Promise<AiIdentity> {
  const identities = await repository.listAiIdentities(profileId);
  const identity = identities.find((candidate) => candidate.role === "viewer"
    && candidate.profileId === profileId
    && candidate.providerConfigId === providerConfig.id
    && candidate.modelId === model.modelId
    && candidate.modelRoute === model.route);
  if (!identity) {
    throw new Error("The exact Viewer identity has no Viewer Learning record. Research is read-only and will not create one.");
  }
  return identity;
}
