import type { ProviderConfig, ProviderModel } from "./providers/types";
import type { Profile } from "./types";

export type ModelRouteRole = "viewer" | "monitor" | "judge";

export function modelRouteKey(providerConfigId: string, modelId: string): string {
  return `${providerConfigId}::${modelId}`;
}

export function modelRouteKeyFor(model: Pick<ProviderModel, "providerConfigId" | "modelId">): string {
  return modelRouteKey(model.providerConfigId, model.modelId);
}

export function splitModelRouteKey(key: string): { providerConfigId: string; modelId: string } | null {
  const separator = "::";
  const boundary = key.indexOf(separator);
  if (boundary <= 0 || boundary + separator.length >= key.length) return null;
  return { providerConfigId: key.slice(0, boundary), modelId: key.slice(boundary + separator.length) };
}

export function findModelByRouteKey(key: string, models: ProviderModel[]): ProviderModel | null {
  const route = splitModelRouteKey(key);
  if (!route) return null;
  return models.find((model) => model.providerConfigId === route.providerConfigId && model.modelId === route.modelId) ?? null;
}

export function providerConfigsForCredential(credentialId: string | undefined, providers: ProviderConfig[]): ProviderConfig[] {
  if (!credentialId) return [];
  return providers.filter((provider) => provider.credentialId === credentialId);
}

export function modelsForCredential(
  credentialId: string | undefined,
  providers: ProviderConfig[],
  models: ProviderModel[],
): ProviderModel[] {
  const allowedProviderIds = new Set(providerConfigsForCredential(credentialId, providers).map((provider) => provider.id));
  return models.filter((model) => allowedProviderIds.has(model.providerConfigId));
}

export function modelsForProfile(profile: Profile | null | undefined, providers: ProviderConfig[], models: ProviderModel[]): ProviderModel[] {
  return modelsForCredential(profile?.credentialId, providers, models);
}

export function isRouteAllowedForCredential(
  key: string,
  credentialId: string | undefined,
  providers: ProviderConfig[],
  models: ProviderModel[],
): boolean {
  const selected = findModelByRouteKey(key, models);
  if (!selected) return false;
  return modelsForCredential(credentialId, providers, [selected]).length === 1;
}

export function findCredentialScopedModelByRouteKey(
  key: string,
  credentialId: string | undefined,
  providers: ProviderConfig[],
  models: ProviderModel[],
): ProviderModel | null {
  if (!isRouteAllowedForCredential(key, credentialId, providers, models)) return null;
  return findModelByRouteKey(key, models);
}

export function preferredModelOrder(models: ProviderModel[]): ProviderModel[] {
  return [...models].sort((left, right) => {
    const leftRank = left.favorite ? 0 : left.recommended ? 1 : 2;
    const rightRank = right.favorite ? 0 : right.recommended ? 1 : 2;
    return leftRank - rightRank || left.displayName.localeCompare(right.displayName);
  });
}

export function resolveViewerDefault(
  profile: Profile | null,
  provider: ProviderConfig | null,
  models: ProviderModel[],
): string {
  if (!profile?.defaultViewerModelId || !provider || provider.credentialId !== profile.credentialId) return "";
  return models.some((model) => model.providerConfigId === provider.id && model.modelId === profile.defaultViewerModelId)
    ? profile.defaultViewerModelId
    : "";
}

export function resolveRoleDefault(
  profile: Profile | null,
  role: "monitor" | "judge",
  providers: ProviderConfig[],
  models: ProviderModel[],
): string {
  const providerConfigId = role === "monitor" ? profile?.defaultMonitorProviderConfigId : profile?.defaultJudgeProviderConfigId;
  const modelId = role === "monitor" ? profile?.defaultMonitorModelId : profile?.defaultJudgeModelId;
  if (!profile?.credentialId || !providerConfigId || !modelId) return "";
  const key = modelRouteKey(providerConfigId, modelId);
  return isRouteAllowedForCredential(key, profile.credentialId, providers, models) ? key : "";
}
