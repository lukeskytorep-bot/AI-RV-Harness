import type { ProviderConfig, ProviderModel } from "../../providers/types";
import { applyReasoningRegistryToProviderModel } from "../../providers/modelReasoningRegistry";
import type { AppSettings } from "../../types";
import type { SettingsModelsRepository } from "../contracts/settingsModelsRepository";
import { nowIso } from "../repository";

const SETTINGS_KEY = "rvh.dev.settings";
const PROVIDERS_KEY = "rvh.dev.providers";
const MODELS_KEY = "rvh.dev.models";

export interface BrowserSettingsModelsRepositoryDependencies {
  storage?: Storage;
  now?: typeof nowIso;
  clearProfileReferences: (removed: ProviderConfig, timestamp: string) => void;
}

export class BrowserSettingsModelsRepository implements SettingsModelsRepository {
  private readonly storage: Storage;

  constructor(private readonly dependencies: BrowserSettingsModelsRepositoryDependencies) {
    this.storage = dependencies.storage ?? localStorage;
  }

  private read<T>(key: string, fallback: T): T {
    try {
      const raw = this.storage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  }

  private write<T>(key: string, value: T): void {
    this.storage.setItem(key, JSON.stringify(value));
  }

  async loadSettings(): Promise<Partial<AppSettings>> {
    return this.read<Partial<AppSettings>>(SETTINGS_KEY, {});
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    this.write(SETTINGS_KEY, settings);
  }

  async listProviderConfigs(): Promise<ProviderConfig[]> {
    return this.read<ProviderConfig[]>(PROVIDERS_KEY, []).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async createProviderConfig(_input: Parameters<SettingsModelsRepository["createProviderConfig"]>[0]): Promise<ProviderConfig> {
    throw new Error("Provider connections and credential metadata require the desktop runtime.");
  }

  async updateProviderCredentialMetadata(_id: string, _credentialHint: string, _fingerprint: string): Promise<void> {
    throw new Error("Provider connections and credential metadata require the desktop runtime.");
  }

  async deleteProviderConfig(id: string): Promise<void> {
    const configs = await this.listProviderConfigs();
    const removed = configs.find((item) => item.id === id);
    this.write(PROVIDERS_KEY, configs.filter((item) => item.id !== id));
    this.write(MODELS_KEY, this.read<ProviderModel[]>(MODELS_KEY, []).filter((item) => item.providerConfigId !== id));
    if (removed) this.dependencies.clearProfileReferences(removed, (this.dependencies.now ?? nowIso)());
  }

  async updateProviderConnectionStatus(id: string, status: "ok" | "error", error?: string): Promise<void> {
    const timestamp = (this.dependencies.now ?? nowIso)();
    this.write(PROVIDERS_KEY, (await this.listProviderConfigs()).map((item) =>
      item.id === id ? { ...item, lastTestedAt: timestamp, lastStatus: status, lastError: error, updatedAt: timestamp } : item,
    ));
  }

  async listProviderModels(providerConfigId?: string): Promise<ProviderModel[]> {
    return this.read<ProviderModel[]>(MODELS_KEY, [])
      .filter((item) => !providerConfigId || item.providerConfigId === providerConfigId)
      .map(applyReasoningRegistryToProviderModel)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  async replaceProviderModels(providerConfigId: string, models: ProviderModel[]): Promise<void> {
    const current = this.read<ProviderModel[]>(MODELS_KEY, []);
    const favorites = new Set(current.filter((item) => item.providerConfigId === providerConfigId && item.favorite).map((item) => item.modelId));
    const otherProviders = current.filter((item) => item.providerConfigId !== providerConfigId);
    this.write(MODELS_KEY, [...otherProviders, ...models.map((model) => ({ ...model, favorite: Boolean(model.favorite || favorites.has(model.modelId)) }))]);
  }

  async setProviderModelFavorite(providerConfigId: string, modelId: string, favorite: boolean): Promise<void> {
    this.write(MODELS_KEY, this.read<ProviderModel[]>(MODELS_KEY, []).map((model) =>
      model.providerConfigId === providerConfigId && model.modelId === modelId ? { ...model, favorite } : model,
    ));
  }

  async clearProviderModelCache(): Promise<void> {
    this.write(MODELS_KEY, []);
  }
}
