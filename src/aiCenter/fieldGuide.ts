import { sha256Text } from "../application/sha256";
import { credentialIdentityFingerprint } from "../providers/native";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import {
  buildEffectiveViewerPrompt,
  VIEWER_PROMPT_VERSION,
  factoryViewerFieldGuide,
  isExactLegacyFactoryViewerEditable,
  stripKnownLockedBaseVocabulary,
} from "../resources/systemPrompts";
import type { AppRepository } from "../storage/repository";
import type { AiIdentity } from "./types";
import type { InterfaceLanguage, Profile, ViewerSystemPromptSnapshot } from "../types";
import { buildViewerIdentityInput } from "./viewerNotes";
import type {
  FieldGuideBundle,
  FieldGuideCapacity,
  FieldGuideLegacyBaseline,
  FieldGuideSessionSnapshot,
  FieldGuideVersion,
} from "./fieldGuideTypes";

export const FIELD_GUIDE_CAPACITIES = [2048, 4096, 8192] as const;
export const FIELD_GUIDE_DEFAULT_CAPACITY: FieldGuideCapacity = 2048;
export const FIELD_GUIDE_ESTIMATOR_VERSION = "conservative-char-v1" as const;

export class FieldGuideLinkRequiredError extends Error {
  constructor(public readonly profileId: string, public readonly baselineIds: string[]) {
    super("A preserved legacy Viewer prompt requires explicit Field Guide identity and language linking in Viewer Learning before this Viewer can start a new session.");
    this.name = "FieldGuideLinkRequiredError";
  }
}

export function estimateFieldGuideTokens(content: string): number {
  return Math.ceil((content.length / 3.5) * 1.15);
}

async function ensureViewerIdentity(input: {
  repository: AppRepository;
  profileId: string;
  providerConfig: ProviderConfig;
  model: ProviderModel;
}) {
  let secureFingerprint: string | undefined;
  try { secureFingerprint = await credentialIdentityFingerprint(input.providerConfig.credentialId); }
  catch { secureFingerprint = input.providerConfig.credentialFingerprint; }
  return input.repository.ensureAiIdentity(buildViewerIdentityInput(input.profileId, input.providerConfig, input.model, secureFingerprint));
}

function unresolvedCustomBaselines(baselines: FieldGuideLegacyBaseline[]): FieldGuideLegacyBaseline[] {
  return baselines.filter((item) => item.resolutionStatus === "unresolved" && !isExactLegacyFactoryViewerEditable(item.originalContent));
}

function exactFactoryBaselineForLanguage(baselines: FieldGuideLegacyBaseline[], language: InterfaceLanguage): FieldGuideLegacyBaseline | undefined {
  return baselines.find((item) => item.resolutionStatus === "unresolved" && isExactLegacyFactoryViewerEditable(item.originalContent) === language);
}

function identitySourceSnapshot(identity: AiIdentity) {
  return {
    aiIdentityId: identity.id,
    profileId: identity.profileId,
    credentialFingerprint: identity.credentialFingerprint,
    provider: identity.provider,
    ...(identity.normalizedBaseUrl ? { normalizedBaseUrl: identity.normalizedBaseUrl } : {}),
    modelId: identity.modelId,
    modelRoute: identity.modelRoute,
  };
}

function factorySourceSnapshot(profile: Profile, identity: AiIdentity, capturedAt: string) {
  return {
    schemaVersion: 1 as const,
    sourceKind: "factory-baseline" as const,
    profileId: profile.id,
    capturedAt,
    identitySnapshot: identitySourceSnapshot(identity),
  };
}

function legacySourceSnapshot(profile: Profile, identity: AiIdentity, baseline: FieldGuideLegacyBaseline, capturedAt: string) {
  return {
    schemaVersion: 1 as const,
    sourceKind: "legacy-profile-baseline" as const,
    profileId: profile.id,
    capturedAt,
    identitySnapshot: identitySourceSnapshot(identity),
    legacyBaselineId: baseline.id,
    legacyProfileUpdatedAt: baseline.sourceProfileUpdatedAt,
  };
}

export async function prepareFieldGuideForSession(input: {
  repository: AppRepository;
  profile: Profile;
  providerConfig: ProviderConfig;
  model: ProviderModel;
  language: InterfaceLanguage;
  now?: () => string;
}): Promise<FieldGuideSessionSnapshot> {
  const identity = await ensureViewerIdentity({
    repository: input.repository,
    profileId: input.profile.id,
    providerConfig: input.providerConfig,
    model: input.model,
  });
  let bundle = await input.repository.getFieldGuideBundle(identity.id, input.language);
  const now = input.now ?? (() => new Date().toISOString());

  if (!bundle?.activeVersion) {
    const baselines = await input.repository.listFieldGuideLegacyBaselines(input.profile.id);
    const blocking = unresolvedCustomBaselines(baselines);
    if (blocking.length) throw new FieldGuideLinkRequiredError(input.profile.id, blocking.map((item) => item.id));

    const exactFactory = exactFactoryBaselineForLanguage(baselines, input.language);
    if (exactFactory) {
      const content = stripKnownLockedBaseVocabulary(exactFactory.originalContent, input.language);
      await input.repository.resolveLegacyFieldGuideBaseline({
        baselineId: exactFactory.id,
        aiIdentityId: identity.id,
        language: input.language,
        content,
        contentSha256: await sha256Text(content),
        estimatedTokens: estimateFieldGuideTokens(content),
        sourceSnapshot: legacySourceSnapshot(input.profile, identity, exactFactory, now()),
      });
    } else {
      const content = factoryViewerFieldGuide(input.language);
      await input.repository.createFieldGuideVersion({
        aiIdentityId: identity.id,
        language: input.language,
        content,
        contentSha256: await sha256Text(content),
        estimatedTokens: estimateFieldGuideTokens(content),
        sourceSnapshot: factorySourceSnapshot(input.profile, identity, now()),
        activationSource: "initial_version",
      });
    }
    bundle = await input.repository.getFieldGuideBundle(identity.id, input.language);
  }

  const active = bundle?.activeVersion;
  if (!bundle || !active) throw new Error("Field Guide could not be initialized for this Viewer identity and language.");
  return fieldGuideSessionSnapshot(active, bundle, input.model.route, now());
}

export async function resolveLegacyFieldGuideBaselineForViewer(input: {
  repository: AppRepository;
  baseline: FieldGuideLegacyBaseline;
  identityId: string;
  language: InterfaceLanguage;
  profile: Profile;
  now?: () => string;
}): Promise<FieldGuideVersion> {
  const now = input.now ?? (() => new Date().toISOString());
  const content = stripKnownLockedBaseVocabulary(input.baseline.originalContent);
  const identity = (await input.repository.listAiIdentities(input.profile.id)).find((item) => item.id === input.identityId && item.role === "viewer");
  if (!identity) throw new Error("Viewer identity is not available for this Profile.");
  return input.repository.resolveLegacyFieldGuideBaseline({
    baselineId: input.baseline.id,
    aiIdentityId: input.identityId,
    language: input.language,
    content,
    contentSha256: await sha256Text(content),
    estimatedTokens: estimateFieldGuideTokens(content),
    sourceSnapshot: legacySourceSnapshot(input.profile, identity, input.baseline, now()),
  });
}

export function fieldGuideSessionSnapshot(
  version: FieldGuideVersion,
  bundle: FieldGuideBundle,
  modelRoute: string,
  capturedAt: string,
): FieldGuideSessionSnapshot {
  return {
    aiIdentityId: version.aiIdentityId,
    language: version.language,
    versionId: version.id,
    versionNumber: version.versionNumber,
    content: version.content,
    contentSha256: version.contentSha256,
    estimatedTokens: version.estimatedTokens,
    estimatorVersion: FIELD_GUIDE_ESTIMATOR_VERSION,
    capacityTokens: bundle.settings.capacityTokens,
    modelRoute,
    capturedAt,
    sourceKind: version.sourceSnapshot.sourceKind,
    ...(version.lexiconId ? { lexiconId: version.lexiconId } : {}),
    ...(version.lexiconVersion ? { lexiconVersion: version.lexiconVersion } : {}),
  };
}

export async function viewerSystemPromptSnapshotFromFieldGuide(
  fieldGuide: FieldGuideSessionSnapshot,
): Promise<ViewerSystemPromptSnapshot> {
  const content = buildEffectiveViewerPrompt(fieldGuide.language, fieldGuide.content);
  return {
    id: `viewer_prompt_${fieldGuide.aiIdentityId}_${fieldGuide.language}`,
    version: `${VIEWER_PROMPT_VERSION}:field-guide:${fieldGuide.versionId}`,
    content,
    contentSha256: await sha256Text(content),
    fieldGuide,
  };
}
