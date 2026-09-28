import type { FieldGuideLanguage } from "./fieldGuideTypes";
import type { AiIdentity } from "./types";
import { credentialIdentityFingerprint } from "../providers/native";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import { isTauriRuntime } from "../storage";
import type { AppRepository } from "../storage/repository";

export interface EligibleViewerIdentity {
  identity: AiIdentity;
  providerConfig: ProviderConfig;
  model: ProviderModel;
  trained: boolean;
  fieldGuideVersionNumber?: number;
  viewerNotesVersionNumber?: number;
}

function normalizedBaseUrl(baseUrl?: string): string | undefined {
  const clean = baseUrl?.trim().replace(/\/+$/, "").toLowerCase();
  return clean || undefined;
}

function metadataCredentialFingerprint(config: ProviderConfig): string {
  return config.credentialFingerprint?.trim() || `${config.provider}:${config.credentialId}`;
}

async function currentIdentityCredentialFingerprint(config: ProviderConfig): Promise<string | null> {
  if (!isTauriRuntime()) return metadataCredentialFingerprint(config);
  try {
    const fingerprint = (await credentialIdentityFingerprint(config.credentialId)).trim();
    return fingerprint || null;
  } catch {
    return null;
  }
}

function exactBindingMatches(identity: AiIdentity, config: ProviderConfig, model: ProviderModel, currentCredentialFingerprint: string): boolean {
  return identity.role === "viewer"
    && identity.routeStatus === "available"
    && config.enabled
    && identity.providerConfigId === config.id
    && identity.provider === config.provider
    && identity.credentialFingerprint === currentCredentialFingerprint
    && (identity.normalizedBaseUrl ?? undefined) === normalizedBaseUrl(config.baseUrl)
    && identity.modelId === model.modelId
    && identity.modelRoute === model.route
    && model.providerConfigId === config.id;
}

export async function listEligibleViewerIdentities(input: {
  repository: AppRepository;
  profileId: string;
  language: FieldGuideLanguage;
  providerConfigs: ProviderConfig[];
  models: ProviderModel[];
}): Promise<EligibleViewerIdentity[]> {
  const identities = await input.repository.listAiIdentities(input.profileId);
  const [trainingRuns, archivedTrainingRuns] = await Promise.all([
    input.repository.listTrainingRuns(),
    input.repository.listArchivedTrainingRuns(),
  ]);
  const allTrainingRuns = [...trainingRuns, ...archivedTrainingRuns].filter((run) => run.profileId === input.profileId);

  const eligible: EligibleViewerIdentity[] = [];
  for (const identity of identities) {
    if (identity.role !== "viewer" || identity.routeStatus !== "available") continue;
    const providerConfig = input.providerConfigs.find((config) => config.id === identity.providerConfigId);
    if (!providerConfig) continue;
    const model = input.models.find((candidate) => candidate.providerConfigId === providerConfig.id && candidate.modelId === identity.modelId && candidate.route === identity.modelRoute);
    if (!model) continue;
    const currentCredentialFingerprint = await currentIdentityCredentialFingerprint(providerConfig);
    if (!currentCredentialFingerprint || !exactBindingMatches(identity, providerConfig, model, currentCredentialFingerprint)) continue;

    const otherLanguage: FieldGuideLanguage = input.language === "en" ? "pl" : "en";
    const [fieldGuide, otherLanguageFieldGuide, viewerNotes] = await Promise.all([
      input.repository.getExistingFieldGuideBundle(identity.id, input.language),
      input.repository.getExistingFieldGuideBundle(identity.id, otherLanguage),
      input.repository.getExistingViewerNoteBundle(identity.id),
    ]);
    const trainedByFieldGuide = Boolean([...(fieldGuide?.versions ?? []), ...(otherLanguageFieldGuide?.versions ?? [])].some((version) => version.sourceSnapshot.sourceKind === "training-reflection" || version.sourceTrainingRunId));
    const trainedByCompletedTarget = allTrainingRuns.some((run) => run.completedTargetIds.length > 0 && run.executionSnapshot?.rvSystemPrompt?.fieldGuide?.aiIdentityId === identity.id);

    eligible.push({
      identity,
      providerConfig,
      model,
      trained: trainedByFieldGuide || trainedByCompletedTarget,
      ...(fieldGuide?.activeVersion ? { fieldGuideVersionNumber: fieldGuide.activeVersion.versionNumber } : {}),
      ...(viewerNotes?.activeVersion ? { viewerNotesVersionNumber: viewerNotes.activeVersion.versionNumber } : {}),
    });
  }

  return eligible.sort((left, right) => right.identity.lastUsedAt.localeCompare(left.identity.lastUsedAt));
}

export function preferredViewerIdentityId(items: EligibleViewerIdentity[], profileDefaultModelId?: string): string {
  if (items.length === 1) return items[0].identity.id;
  if (!profileDefaultModelId) return "";
  const matches = items.filter((item) => item.identity.modelId === profileDefaultModelId);
  return matches.length === 1 ? matches[0].identity.id : "";
}

export function viewerIdentityLabel(item: EligibleViewerIdentity, language: "pl" | "en"): string {
  const status = item.trained ? (language === "pl" ? "wytrenowana" : "trained") : (language === "pl" ? "Nieukończony trening" : "Training incomplete");
  const learning = item.fieldGuideVersionNumber
    ? ` · Field Guide v${item.fieldGuideVersionNumber}`
    : item.viewerNotesVersionNumber
      ? ` · Viewer Notes v${item.viewerNotesVersionNumber}`
      : "";
  return `${item.identity.modelDisplayName} · ${item.providerConfig.label} · ${status}${learning}`;
}

export async function requireExistingViewerIdentity(input: {
  repository: AppRepository;
  profileId: string;
  identityId: string;
  providerConfig: ProviderConfig;
  model: ProviderModel;
}): Promise<AiIdentity> {
  const identity = (await input.repository.listAiIdentities(input.profileId)).find((item) => item.id === input.identityId);
  const currentCredentialFingerprint = await currentIdentityCredentialFingerprint(input.providerConfig);
  if (!identity || !currentCredentialFingerprint || !exactBindingMatches(identity, input.providerConfig, input.model, currentCredentialFingerprint)) {
    throw new Error("The selected Viewer identity is no longer available for this Profile and exact provider route.");
  }
  return identity;
}

export async function ensureProfileViewerIdentity(input: {
  repository: AppRepository;
  profileId: string;
  credentialId?: string;
  modelId?: string;
}): Promise<AiIdentity | null> {
  if (!input.credentialId || !input.modelId) return null;
  const configs = await input.repository.listProviderConfigs();
  const config = configs.find((item) => item.credentialId === input.credentialId && item.enabled);
  if (!config) return null;
  const model = (await input.repository.listProviderModels(config.id)).find((item) => item.modelId === input.modelId);
  if (!model) return null;
  const fingerprint = await currentIdentityCredentialFingerprint(config);
  if (!fingerprint) return null;
  return input.repository.ensureAiIdentity({
    profileId: input.profileId,
    credentialFingerprint: fingerprint,
    credentialDisplay: `…${fingerprint.slice(-4).toUpperCase()}`,
    providerConfigId: config.id,
    provider: config.provider,
    ...(normalizedBaseUrl(config.baseUrl) ? { baseUrl: normalizedBaseUrl(config.baseUrl) } : {}),
    modelId: model.modelId,
    modelRoute: model.route,
    modelDisplayName: model.displayName,
    role: "viewer",
  });
}
