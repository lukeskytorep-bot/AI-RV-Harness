import type { FieldGuideLanguage } from "./fieldGuideTypes";
import type { AiIdentity } from "./types";
import { normalizedViewerBaseUrl as normalizedBaseUrl, prepareProfileViewerRoute, requireViewerRoute, resolveViewerCredential, ViewerRouteError, type ViewerRouteFailureCode } from "./viewerIdentityRoute";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import type { AppRepository } from "../storage/repository";
import type { Profile, Workspace } from "../types";

export interface EligibleViewerIdentity {
  identity: AiIdentity;
  providerConfig: ProviderConfig;
  model: ProviderModel;
  trained: boolean;
  fieldGuideVersionNumber?: number;
  viewerNotesVersionNumber?: number;
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
    && model.providerConfigId === config.id
    && model.provider === config.provider;
}

export interface ViewerIdentityListing {
  identities: EligibleViewerIdentity[];
  issues: { providerConfigId?: string; code: ViewerRouteFailureCode }[];
}
export async function inspectViewerIdentities(input: {
  repository: AppRepository;
  profileId: string;
  language: FieldGuideLanguage;
  providerConfigs: ProviderConfig[];
  models: ProviderModel[];
}): Promise<ViewerIdentityListing> {
  const identities = await input.repository.listAiIdentities(input.profileId);
  const [trainingRuns, archivedTrainingRuns] = await Promise.all([
    input.repository.listTrainingRuns(),
    input.repository.listArchivedTrainingRuns(),
  ]);
  const allTrainingRuns = [...trainingRuns, ...archivedTrainingRuns].filter((run) => run.profileId === input.profileId);

  const issues: ViewerIdentityListing["issues"] = [];
  const credentials = new Map<string, Awaited<ReturnType<typeof resolveViewerCredential>>>();
  await Promise.all(input.providerConfigs.filter(config => config.enabled).map(async config => {
    const result = await resolveViewerCredential(config);
    credentials.set(config.id, result);
    if (!result.ok) issues.push({ providerConfigId: config.id, code: result.code });
  }));
  const eligible: EligibleViewerIdentity[] = [];
  for (const identity of identities) {
    if (identity.role !== "viewer") continue;
    if (identity.routeStatus !== "available") { issues.push({ providerConfigId: identity.providerConfigId, code: "binding_mismatch" }); continue; }
    const providerConfig = input.providerConfigs.find((config) => config.id === identity.providerConfigId);
    if (!providerConfig || !providerConfig.enabled) { issues.push({ providerConfigId: identity.providerConfigId, code: "configuration_missing" }); continue; }
    const model = input.models.find((candidate) => candidate.providerConfigId === providerConfig.id && candidate.modelId === identity.modelId && candidate.route === identity.modelRoute);
    if (!model) { issues.push({ providerConfigId: providerConfig.id, code: "model_missing" }); continue; }
    const result = credentials.get(providerConfig.id);
    const currentCredentialFingerprint = result?.ok ? result.value : null;
    if (!currentCredentialFingerprint) continue;
    if (!exactBindingMatches(identity, providerConfig, model, currentCredentialFingerprint)) { issues.push({ providerConfigId: providerConfig.id, code: "binding_mismatch" }); continue; }

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

  return { identities: eligible.sort((left, right) => right.identity.lastUsedAt.localeCompare(left.identity.lastUsedAt)), issues };
}

export async function listEligibleViewerIdentities(input: Parameters<typeof inspectViewerIdentities>[0]): Promise<EligibleViewerIdentity[]> {
  return (await inspectViewerIdentities(input)).identities;
}

export function preferredViewerIdentityId(items: EligibleViewerIdentity[], profileDefaultModelId?: string, credentialId?: string): string {
  if (credentialId) {
    const matches = items.filter(item => item.providerConfig.credentialId === credentialId && (!profileDefaultModelId || item.model.modelId === profileDefaultModelId));
    return matches.length === 1 ? matches[0].identity.id : "";
  }
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
  const currentCredentialFingerprint = requireViewerRoute(await resolveViewerCredential(input.providerConfig));
  if (!identity || !currentCredentialFingerprint || !exactBindingMatches(identity, input.providerConfig, input.model, currentCredentialFingerprint)) {
    throw new ViewerRouteError("binding_mismatch");
  }
  return identity;
}


export async function requireWorkspaceViewerRoute(input: {
  repository: AppRepository;
  workspace: Workspace;
  profile: Profile | null;
  identityId: string;
  providerConfig: ProviderConfig;
  model: ProviderModel;
}): Promise<AiIdentity> {
  if (!input.profile || input.workspace.profileId !== input.profile.id) {
    throw new Error("The selected Workspace no longer belongs to the active Profile.");
  }
  return requireExistingViewerIdentity({
    repository: input.repository,
    profileId: input.profile.id,
    identityId: input.identityId,
    providerConfig: input.providerConfig,
    model: input.model,
  });
}

export async function ensureProfileViewerIdentity(input: {
  repository: AppRepository;
  profileId: string;
  credentialId?: string;
  modelId?: string;
}): Promise<AiIdentity> {
  const prepared = requireViewerRoute(await prepareProfileViewerRoute(input));
  return input.repository.ensureAiIdentity({ ...prepared, profileId: input.profileId });
}
