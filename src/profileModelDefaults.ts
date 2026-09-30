import type { Profile } from "./types";

export {
  findCredentialScopedModelByRouteKey,
  findModelByRouteKey,
  isRouteAllowedForCredential,
  modelRouteKey,
  modelRouteKeyFor,
  modelsForCredential,
  modelsForProfile,
  preferredModelOrder,
  providerConfigsForCredential,
  resolveRoleDefault,
  resolveViewerDefault,
  splitModelRouteKey,
  type ModelRouteRole,
} from "./modelRoutes";

export function profileNeedingInitialSetup(profiles: Profile[]): Profile | null {
  if (!profiles.length) return null;
  return profiles.every((profile) => !profile.credentialId || !profile.defaultViewerModelId) ? profiles[0] : null;
}
