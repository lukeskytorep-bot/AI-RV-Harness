import type { ProviderConfig, ProviderKind, ProviderModel } from "../../providers/types";
import { applyReasoningRegistryToProviderModel } from "../../providers/modelReasoningRegistry";
import type { AppSettings } from "../../types";
import type { DatabaseTransactionStatement } from "../databaseNative";
import type { SettingsModelsRepository } from "../contracts/settingsModelsRepository";
import { nowIso } from "../repository";

type WriteResult = { rowsAffected: number };

type ProviderConfigRow = {
  id: string; provider: ProviderKind; label: string; credential_id: string; credential_hint: string | null;
  credential_fingerprint: string | null; base_url: string | null; enabled: number; last_tested_at: string | null;
  last_status: "ok" | "error" | null; last_error: string | null; created_at: string; updated_at: string;
};

type ProviderModelRow = {
  provider_config_id: string; provider: ProviderKind; model_id: string; display_name: string; route: string;
  capability_json: string; pricing_json: string; recommended: number; favorite: number; raw_metadata_json: string; refreshed_at: string;
};

export interface SqliteSettingsModelsRepositoryDependencies {
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
  executeWrite(query: string, bindValues?: unknown[]): Promise<WriteResult>;
  executeTransaction(statements: DatabaseTransactionStatement[]): Promise<unknown>;
  now?: typeof nowIso;
}

function mapProviderConfig(row: ProviderConfigRow): ProviderConfig {
  return {
    id: row.id, provider: row.provider, label: row.label, credentialId: row.credential_id,
    credentialHint: row.credential_hint ?? undefined, credentialFingerprint: row.credential_fingerprint ?? undefined,
    baseUrl: row.base_url ?? undefined, enabled: row.enabled === 1, lastTestedAt: row.last_tested_at ?? undefined,
    lastStatus: row.last_status ?? undefined, lastError: row.last_error ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function mapProviderModel(row: ProviderModelRow): ProviderModel {
  return applyReasoningRegistryToProviderModel({
    providerConfigId: row.provider_config_id, provider: row.provider, modelId: row.model_id, displayName: row.display_name,
    route: row.route, capabilities: JSON.parse(row.capability_json) as ProviderModel["capabilities"],
    pricing: JSON.parse(row.pricing_json) as ProviderModel["pricing"], recommended: row.recommended === 1,
    favorite: row.favorite === 1, rawMetadata: JSON.parse(row.raw_metadata_json) as ProviderModel["rawMetadata"], refreshedAt: row.refreshed_at,
  });
}

export class SqliteSettingsModelsRepository implements SettingsModelsRepository {
  constructor(private readonly dependencies: SqliteSettingsModelsRepositoryDependencies) {}

  async loadSettings(): Promise<Partial<AppSettings>> {
    const rows = await this.dependencies.select<{ key: string; value: string }[]>("SELECT key, value FROM app_settings");
    const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    return {
      ...(values.interfaceLanguage ? { interfaceLanguage: values.interfaceLanguage as AppSettings["interfaceLanguage"] } : {}),
      ...(values.sessionLanguage ? { sessionLanguage: values.sessionLanguage as AppSettings["sessionLanguage"] } : {}),
      ...(values.theme ? { theme: values.theme as AppSettings["theme"] } : {}),
      ...(values.requestTimeoutMs ? { requestTimeoutMs: Number(values.requestTimeoutMs) } : {}),
      ...(values.maxRetries ? { maxRetries: Number(values.maxRetries) } : {}),
      ...(values.defaultMaxOutputTokens ? { defaultMaxOutputTokens: Number(values.defaultMaxOutputTokens) } : {}),
      ...(values.maxSessionCostUsd ? { maxSessionCostUsd: Number(values.maxSessionCostUsd) } : {}),
      ...(values.defaultRevealSource ? { defaultRevealSource: values.defaultRevealSource as AppSettings["defaultRevealSource"] } : {}),
      ...(values.targetRepeatPolicy ? { targetRepeatPolicy: values.targetRepeatPolicy as AppSettings["targetRepeatPolicy"] } : {}),
      ...(values.sessionCodePrefix ? { sessionCodePrefix: values.sessionCodePrefix } : {}),
      ...(values.textScale ? { textScale: values.textScale as AppSettings["textScale"] } : {}),
      ...(values.animations ? { animations: values.animations === "true" } : {}),
      ...(values.trainingDirectory !== undefined ? { trainingDirectory: values.trainingDirectory } : {}),
      ...(values.telepathicStarterPackVersion !== undefined ? { telepathicStarterPackVersion: values.telepathicStarterPackVersion } : {}),
    };
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    const timestamp = (this.dependencies.now ?? nowIso)();
    await this.dependencies.executeTransaction(Object.entries(settings).filter(([, value]) => value !== undefined).map(([key, value]) => ({
      query: `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, $3)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      values: [key, String(value), timestamp],
    })));
  }

  async listProviderConfigs(): Promise<ProviderConfig[]> {
    const rows = await this.dependencies.select<ProviderConfigRow[]>(
      `SELECT pc.id, pc.provider, pc.label, pc.credential_id, pc.credential_hint,
              cm.fingerprint AS credential_fingerprint, pc.base_url, pc.enabled, pc.last_tested_at, pc.last_status, pc.last_error,
              pc.created_at, pc.updated_at FROM provider_configs pc
         LEFT JOIN credentials_metadata cm ON cm.id = pc.credential_id ORDER BY pc.updated_at DESC`,
    );
    return rows.map(mapProviderConfig);
  }

  async createProviderConfig(input: Parameters<SettingsModelsRepository["createProviderConfig"]>[0]): Promise<ProviderConfig> {
    const timestamp = (this.dependencies.now ?? nowIso)();
    const config: ProviderConfig = {
      id: input.id, provider: input.provider, label: input.label.trim(), credentialId: input.credentialId,
      credentialHint: input.credentialHint, credentialFingerprint: input.fingerprint, baseUrl: input.baseUrl?.trim() || undefined,
      enabled: true, createdAt: timestamp, updatedAt: timestamp,
    };
    await this.dependencies.executeTransaction([
      { query: `INSERT INTO credentials_metadata (id, provider, label, fingerprint, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $5)`, values: [input.credentialId, input.provider, config.label, input.fingerprint ?? null, timestamp] },
      { query: `INSERT INTO provider_configs
                (id, provider, label, credential_id, credential_hint, base_url, enabled, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $7)`,
        values: [config.id, config.provider, config.label, config.credentialId, config.credentialHint ?? null, config.baseUrl ?? null, timestamp] },
    ]);
    return config;
  }

  async updateProviderCredentialMetadata(id: string, credentialHint: string, fingerprint: string): Promise<void> {
    const rows = await this.dependencies.select<{ credential_id: string }[]>("SELECT credential_id FROM provider_configs WHERE id = $1 LIMIT 1", [id]);
    const credentialId = rows[0]?.credential_id;
    if (!credentialId) throw new Error("Provider connection not found.");
    const timestamp = (this.dependencies.now ?? nowIso)();
    await this.dependencies.executeTransaction([
      { query: `UPDATE provider_configs SET credential_hint = $1, last_status = NULL, last_error = NULL,
                last_tested_at = NULL, updated_at = $2 WHERE id = $3`, values: [credentialHint, timestamp, id] },
      { query: "UPDATE credentials_metadata SET fingerprint = $1, updated_at = $2 WHERE id = $3", values: [fingerprint, timestamp, credentialId] },
    ]);
  }

  async deleteProviderConfig(id: string): Promise<void> {
    const rows = await this.dependencies.select<{ credential_id: string }[]>("SELECT credential_id FROM provider_configs WHERE id = $1", [id]);
    const credentialId = rows[0]?.credential_id;
    const statements: DatabaseTransactionStatement[] = [];
    if (credentialId) {
      statements.push({
        query: `UPDATE profiles
              SET credential_id = CASE WHEN credential_id = $1 THEN NULL ELSE credential_id END,
                  default_viewer_model_id = CASE WHEN credential_id = $1 THEN NULL ELSE default_viewer_model_id END,
                  default_viewer_reasoning_effort = CASE WHEN credential_id = $1 THEN NULL ELSE default_viewer_reasoning_effort END,
                  default_viewer_temperature = CASE WHEN credential_id = $1 THEN NULL ELSE default_viewer_temperature END,
                  default_monitor_provider_config_id = CASE WHEN default_monitor_provider_config_id = $2 THEN NULL ELSE default_monitor_provider_config_id END,
                  default_monitor_model_id = CASE WHEN default_monitor_provider_config_id = $2 THEN NULL ELSE default_monitor_model_id END,
                  default_judge_provider_config_id = CASE WHEN default_judge_provider_config_id = $2 THEN NULL ELSE default_judge_provider_config_id END,
                  default_judge_model_id = CASE WHEN default_judge_provider_config_id = $2 THEN NULL ELSE default_judge_model_id END,
                  updated_at = $3
            WHERE credential_id = $1 OR default_monitor_provider_config_id = $2 OR default_judge_provider_config_id = $2`,
        values: [credentialId, id, (this.dependencies.now ?? nowIso)()],
      });
    }
    statements.push({ query: "DELETE FROM provider_configs WHERE id = $1", values: [id] });
    if (credentialId) statements.push({ query: "DELETE FROM credentials_metadata WHERE id = $1", values: [credentialId] });
    await this.dependencies.executeTransaction(statements);
  }

  async updateProviderConnectionStatus(id: string, status: "ok" | "error", error?: string): Promise<void> {
    const timestamp = (this.dependencies.now ?? nowIso)();
    await this.dependencies.executeWrite(
      `UPDATE provider_configs SET last_tested_at = $1, last_status = $2, last_error = $3, updated_at = $1 WHERE id = $4`,
      [timestamp, status, error ?? null, id],
    );
  }

  async listProviderModels(providerConfigId?: string): Promise<ProviderModel[]> {
    const query = `SELECT provider_config_id, provider, model_id, display_name, route, capability_json,
                  pricing_json, recommended, favorite, raw_metadata_json, refreshed_at
             FROM model_registry${providerConfigId ? " WHERE provider_config_id = $1" : ""} ORDER BY display_name`;
    const rows = await this.dependencies.select<ProviderModelRow[]>(query, providerConfigId ? [providerConfigId] : undefined);
    return rows.map(mapProviderModel);
  }

  async replaceProviderModels(providerConfigId: string, models: ProviderModel[]): Promise<void> {
    const favorites = new Set((await this.dependencies.select<{ model_id: string }[]>(
      "SELECT model_id FROM model_registry WHERE provider_config_id = $1 AND favorite = 1", [providerConfigId],
    )).map((row) => row.model_id));
    const statements: DatabaseTransactionStatement[] = [{ query: "DELETE FROM model_registry WHERE provider_config_id = $1", values: [providerConfigId] }];
    for (const model of models) statements.push({
      query: `INSERT INTO model_registry
              (provider_config_id, provider, model_id, display_name, route, capability_json, pricing_json,
               recommended, favorite, raw_metadata_json, refreshed_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      values: [model.providerConfigId, model.provider, model.modelId, model.displayName, model.route, JSON.stringify(model.capabilities),
        JSON.stringify(model.pricing), model.recommended ? 1 : 0, (model.favorite || favorites.has(model.modelId)) ? 1 : 0,
        JSON.stringify(model.rawMetadata), model.refreshedAt],
    });
    await this.dependencies.executeTransaction(statements);
  }

  async setProviderModelFavorite(providerConfigId: string, modelId: string, favorite: boolean): Promise<void> {
    await this.dependencies.executeWrite("UPDATE model_registry SET favorite = $1 WHERE provider_config_id = $2 AND model_id = $3", [favorite ? 1 : 0, providerConfigId, modelId]);
  }

  async clearProviderModelCache(): Promise<void> {
    await this.dependencies.executeWrite("DELETE FROM model_registry");
  }
}
