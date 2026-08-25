import type { ProviderConfig, ProviderModel } from "./providers/types";
import type { Profile } from "./types";

export function modelRouteKey(providerConfigId: string, modelId: string): string {
  return `${providerConfigId}::${modelId}`;
}

export function splitModelRouteKey(key: string): { providerConfigId: string; modelId: string } | null {
  const separator = "::";
  const boundary = key.indexOf(separator);
  if (boundary <= 0 || boundary + separator.length >= key.length) return null;
  return { providerConfigId: key.slice(0, boundary), modelId: key.slice(boundary + separator.length) };
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
  models: ProviderModel[],
): string {
  const providerConfigId = role === "monitor" ? profile?.defaultMonitorProviderConfigId : profile?.defaultJudgeProviderConfigId;
  const modelId = role === "monitor" ? profile?.defaultMonitorModelId : profile?.defaultJudgeModelId;
  if (!providerConfigId || !modelId) return "";
  return models.some((model) => model.providerConfigId === providerConfigId && model.modelId === modelId)
    ? modelRouteKey(providerConfigId, modelId)
    : "";
}

export function preferredModelOrder(models: ProviderModel[]): ProviderModel[] {
  return [...models].sort((left, right) => {
    const leftRank = left.favorite ? 0 : left.recommended ? 1 : 2;
    const rightRank = right.favorite ? 0 : right.recommended ? 1 : 2;
    return leftRank - rightRank || left.displayName.localeCompare(right.displayName);
  });
}

export function profileNeedingInitialSetup(profiles: Profile[]): Profile | null {
  if (!profiles.length) return null;
  return profiles.every((profile) => !profile.credentialId || !profile.defaultViewerModelId) ? profiles[0] : null;
}
