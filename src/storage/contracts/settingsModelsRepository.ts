import type { ProviderConfig, ProviderModel, CreateProviderConfigInput } from "../../providers/types";
import type { AppSettings } from "../../types";

/** Internal persistence contract for application settings and the provider/model registry. */
export interface SettingsModelsRepository {
  loadSettings(): Promise<Partial<AppSettings>>;
  saveSettings(settings: AppSettings): Promise<void>;
  listProviderConfigs(): Promise<ProviderConfig[]>;
  createProviderConfig(input: CreateProviderConfigInput): Promise<ProviderConfig>;
  updateProviderCredentialMetadata(id: string, credentialHint: string, fingerprint: string): Promise<void>;
  deleteProviderConfig(id: string): Promise<void>;
  updateProviderConnectionStatus(id: string, status: "ok" | "error", error?: string): Promise<void>;
  listProviderModels(providerConfigId?: string): Promise<ProviderModel[]>;
  replaceProviderModels(providerConfigId: string, models: ProviderModel[]): Promise<void>;
  setProviderModelFavorite(providerConfigId: string, modelId: string, favorite: boolean): Promise<void>;
  clearProviderModelCache(): Promise<void>;
}
