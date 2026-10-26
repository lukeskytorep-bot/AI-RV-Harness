import { credentialIdentityFingerprint } from "../providers/native";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import { isTauriRuntime } from "../storage";
import type { AppRepository } from "../storage/repository";
import type { AiIdentity, EnsureAiIdentityInput } from "./types";

export type ViewerRouteFailureCode = "configuration_missing" | "model_missing" | "fingerprint_unavailable" | "binding_mismatch" | "ambiguous_route";
export type ViewerRouteResult<T> = { ok: true; value: T } | { ok: false; code: ViewerRouteFailureCode };
export type PreparedViewerRoute = Omit<EnsureAiIdentityInput, "profileId">;

const messages: Record<ViewerRouteFailureCode, { en: string; pl: string }> = {
  configuration_missing: { en: "The Viewer connection is missing or disabled. Check Profile settings.", pl: "Brakuje połączenia Viewera lub jest ono wyłączone. Sprawdź ustawienia profilu." },
  model_missing: { en: "The Viewer model is missing from the selected connection. Select the model again.", pl: "Brakuje modelu Viewera w wybranym połączeniu. Wybierz model ponownie." },
  fingerprint_unavailable: { en: "Cannot read the saved API key identity. Check the saved connection and try again.", pl: "Nie można odczytać tożsamości zapisanego klucza API. Sprawdź zapisane połączenie i spróbuj ponownie." },
  binding_mismatch: { en: "The selected Viewer identity no longer matches the provider connection and model. Check Profile settings.", pl: "Wybrana tożsamość Viewera nie odpowiada powiązaniu połączenia i modelu. Sprawdź ustawienia profilu." },
  ambiguous_route: { en: "More than one Viewer route matches this connection and model. Select an unambiguous connection.", pl: "Do tego połączenia i modelu pasuje więcej niż jedna trasa Viewera. Wybierz jednoznaczne połączenie." },
};
export class ViewerRouteError extends Error {
  constructor(public readonly code: ViewerRouteFailureCode) {
    super(messages[code].en);
    this.name = "ViewerRouteError";
  }
}
export function viewerRouteErrorMessage(error: unknown, language: "en" | "pl"): string | undefined {
  return error instanceof ViewerRouteError ? messages[error.code][language] : undefined;
}
export function requireViewerRoute<T>(result: ViewerRouteResult<T>): T {
  if (!result.ok) throw new ViewerRouteError(result.code);
  return result.value;
}
export function normalizedViewerBaseUrl(baseUrl?: string): string | undefined {
  return baseUrl?.trim().replace(/\/+$/, "").toLowerCase() || undefined;
}
export async function resolveViewerCredential(config: ProviderConfig): Promise<ViewerRouteResult<string>> {
  // Browser has a separate, intentionally metadata-based identity namespace.
  // Desktop must never persist that fallback after keychain/IPC failure.
  if (!isTauriRuntime()) return { ok: true, value: config.credentialFingerprint?.trim() || `${config.provider}:${config.credentialId}` };
  try {
    const value = (await credentialIdentityFingerprint(config.credentialId)).trim();
    return value ? { ok: true, value } : { ok: false, code: "fingerprint_unavailable" };
  } catch {
    // Do not expose keychain errors, secrets or fingerprints in UI/logs.
    return { ok: false, code: "fingerprint_unavailable" };
  }
}
export async function prepareViewerRoute(config: ProviderConfig, model: ProviderModel): Promise<ViewerRouteResult<PreparedViewerRoute>> {
  if (!config.enabled || !config.credentialId) return { ok: false, code: "configuration_missing" };
  if (!model.modelId) return { ok: false, code: "model_missing" };
  if (model.providerConfigId !== config.id || model.provider !== config.provider || !model.route) return { ok: false, code: "binding_mismatch" };
  const result = await resolveViewerCredential(config);
  if (!result.ok) return result;
  const fingerprint = result.value;
  return { ok: true, value: {
    credentialFingerprint: fingerprint,
    credentialDisplay: `…${fingerprint.slice(-4).toUpperCase()}`,
    providerConfigId: config.id, provider: config.provider,
    ...(normalizedViewerBaseUrl(config.baseUrl) ? { baseUrl: normalizedViewerBaseUrl(config.baseUrl) } : {}),
    modelId: model.modelId, modelRoute: model.route, modelDisplayName: model.displayName, role: "viewer",
  } };
}
export async function prepareProfileViewerRoute(input: {
  repository: AppRepository; credentialId?: string; modelId?: string;
}): Promise<ViewerRouteResult<PreparedViewerRoute>> {
  if (!input.credentialId) return { ok: false, code: "configuration_missing" };
  if (!input.modelId) return { ok: false, code: "model_missing" };
  const configs = (await input.repository.listProviderConfigs()).filter((item) => item.credentialId === input.credentialId && item.enabled);
  if (!configs.length) return { ok: false, code: "configuration_missing" };
  if (configs.length !== 1) return { ok: false, code: "ambiguous_route" };
  const models = (await input.repository.listProviderModels(configs[0].id)).filter((item) => item.modelId === input.modelId);
  if (!models.length) return { ok: false, code: "model_missing" };
  if (models.length !== 1) return { ok: false, code: "ambiguous_route" };
  return prepareViewerRoute(configs[0], models[0]);
}
export async function ensureViewerIdentityForRoute(input: {
  repository: AppRepository; profileId: string; providerConfig: ProviderConfig; model: ProviderModel;
}): Promise<AiIdentity> {
  const prepared = requireViewerRoute(await prepareViewerRoute(input.providerConfig, input.model));
  return input.repository.ensureAiIdentity({ ...prepared, profileId: input.profileId });
}
