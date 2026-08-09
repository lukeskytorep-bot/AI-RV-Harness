import type { AppRepository } from "../storage/repository";
import { createId } from "../storage/repository";
import { deleteCredentialSecret, discoverModels, hasCredentialSecret, storeCredentialSecret } from "./native";
import type { ProviderConfig, ProviderKind, ProviderModel } from "./types";

export const PROVIDER_MODEL_CACHE_LIMIT_PER_PROVIDER = 2000;

export function credentialHint(secret: string): string {
  const clean = secret.trim();
  const suffix = clean.slice(-3);
  if (clean.startsWith("sk-or-")) return `sk-or-••••••••${suffix}`;
  if (clean.startsWith("sk-")) return `sk-••••••••${suffix}`;
  return `••••••••${suffix}`;
}

export async function credentialFingerprint(secret: string): Promise<string> {
  const bytes = new TextEncoder().encode(secret.trim());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

export async function addProvider(
  repository: AppRepository,
  input: { provider: ProviderKind; label: string; apiKey: string; baseUrl?: string },
): Promise<ProviderConfig> {
  const apiKey = input.apiKey.trim();
  const label = input.label.trim();
  if (!label) throw new Error("Provider label is required.");
  if (!apiKey) throw new Error("API key is required.");
  if (input.provider === "custom_openai" && !input.baseUrl?.trim()) throw new Error("Custom provider requires a base URL.");

  const credentialId = createId("credential");
  const providerId = createId("provider");
  await storeCredentialSecret(credentialId, apiKey);
  try {
    return await repository.createProviderConfig({
      id: providerId,
      provider: input.provider,
      label,
      credentialId,
      credentialHint: credentialHint(apiKey),
      baseUrl: input.baseUrl?.trim() || undefined,
      fingerprint: await credentialFingerprint(apiKey),
    });
  } catch (error) {
    await deleteCredentialSecret(credentialId).catch(() => undefined);
    throw error;
  }
}

export async function refreshProviderModels(repository: AppRepository, config: ProviderConfig): Promise<ProviderModel[]> {
  try {
    if (!await hasCredentialSecret(config.credentialId)) {
      throw new Error("API key is missing from secure storage. Remove this provider connection and add it again.");
    }
    const models = (await discoverModels(config)).slice(0, PROVIDER_MODEL_CACHE_LIMIT_PER_PROVIDER);
    await repository.replaceProviderModels(config.id, models);
    await repository.updateProviderConnectionStatus(config.id, "ok");
    return models;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await repository.updateProviderConnectionStatus(config.id, "error", message);
    throw error;
  }
}

export async function removeProvider(repository: AppRepository, config: ProviderConfig): Promise<void> {
  await deleteCredentialSecret(config.credentialId);
  await repository.deleteProviderConfig(config.id);
}
