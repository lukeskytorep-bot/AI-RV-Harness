import type { ReasoningEffort } from "../../providers/types";
import type {
  CreateProfileInput,
  Profile,
  ProfileAiConfigurationInput,
  UpdateProfileInput,
} from "../../types";
import type { ProfilesRepository } from "../contracts/profilesRepository";
import { createId, nowIso } from "../repository";

type ProfileRow = {
  id: string;
  display_name: string;
  human_display_name: string | null;
  note: string | null;
  credential_id: string | null;
  credential_provider: string | null;
  default_viewer_model_id: string | null;
  default_viewer_reasoning_effort: ReasoningEffort | null;
  default_viewer_temperature: number | null;
  default_viewer_system_prompt: string | null;
  default_monitor_system_prompt: string | null;
  default_monitor_provider_config_id: string | null;
  default_monitor_model_id: string | null;
  default_judge_provider_config_id: string | null;
  default_judge_model_id: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export interface SqliteProfilesRepositoryDependencies {
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
  executeWrite(query: string, bindValues?: unknown[]): Promise<unknown>;
  createId?: typeof createId;
  now?: typeof nowIso;
}

function mapProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    name: row.display_name,
    humanName: row.human_display_name ?? undefined,
    note: row.note ?? undefined,
    credentialId: row.credential_id ?? undefined,
    credentialProvider: row.credential_provider ?? undefined,
    defaultViewerModelId: row.default_viewer_model_id ?? undefined,
    defaultViewerReasoningEffort: row.default_viewer_reasoning_effort ?? undefined,
    defaultViewerTemperature: row.default_viewer_temperature ?? undefined,
    defaultViewerSystemPrompt: row.default_viewer_system_prompt ?? undefined,
    defaultMonitorSystemPrompt: row.default_monitor_system_prompt ?? undefined,
    defaultMonitorProviderConfigId: row.default_monitor_provider_config_id ?? undefined,
    defaultMonitorModelId: row.default_monitor_model_id ?? undefined,
    defaultJudgeProviderConfigId: row.default_judge_provider_config_id ?? undefined,
    defaultJudgeModelId: row.default_judge_model_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at ?? undefined,
  };
}

export class SqliteProfilesRepository implements ProfilesRepository {
  constructor(private readonly dependencies: SqliteProfilesRepositoryDependencies) {}

  async listProfiles(): Promise<Profile[]> {
    const rows = await this.dependencies.select<ProfileRow[]>(
      `SELECT p.id, p.display_name, p.human_display_name, p.note, p.credential_id,
              c.provider AS credential_provider,
              p.default_viewer_model_id,
              p.default_viewer_reasoning_effort,
              p.default_viewer_temperature,
              p.default_viewer_system_prompt,
              p.default_monitor_system_prompt,
              p.default_monitor_provider_config_id,
              p.default_monitor_model_id,
              p.default_judge_provider_config_id,
              p.default_judge_model_id,
              p.created_at, p.updated_at, p.archived_at
         FROM profiles p
         LEFT JOIN credentials_metadata c ON c.id = p.credential_id
        WHERE p.archived_at IS NULL
        ORDER BY p.updated_at DESC`,
    );
    return rows.map(mapProfile);
  }

  async listArchivedProfiles(): Promise<Profile[]> {
    const rows = await this.dependencies.select<ProfileRow[]>(
      `SELECT p.id, p.display_name, p.human_display_name, p.note, p.credential_id,
              c.provider AS credential_provider, p.default_viewer_model_id,
              p.default_viewer_reasoning_effort, p.default_viewer_temperature,
              p.default_viewer_system_prompt, p.default_monitor_system_prompt,
              p.default_monitor_provider_config_id, p.default_monitor_model_id,
              p.default_judge_provider_config_id, p.default_judge_model_id,
              p.created_at, p.updated_at, p.archived_at
         FROM profiles p LEFT JOIN credentials_metadata c ON c.id = p.credential_id
        WHERE p.archived_at IS NOT NULL ORDER BY p.archived_at DESC`,
    );
    return rows.map(mapProfile);
  }

  async createProfile(input: CreateProfileInput): Promise<Profile> {
    const timestamp = (this.dependencies.now ?? nowIso)();
    const ai = input.aiConfiguration;
    const profile: Profile = {
      id: (this.dependencies.createId ?? createId)("profile"),
      name: input.name.trim(),
      humanName: input.humanName?.trim() || undefined,
      note: input.note?.trim() || undefined,
      credentialId: ai?.credentialId,
      credentialProvider: ai?.credentialProvider,
      defaultViewerModelId: ai?.defaultViewerModelId,
      defaultViewerReasoningEffort: ai?.defaultViewerReasoningEffort,
      defaultViewerTemperature: ai?.defaultViewerTemperature,
      defaultViewerSystemPrompt: ai?.defaultViewerSystemPrompt?.trim() || undefined,
      defaultMonitorSystemPrompt: ai?.defaultMonitorSystemPrompt?.trim() || undefined,
      defaultMonitorProviderConfigId: ai?.defaultMonitorProviderConfigId,
      defaultMonitorModelId: ai?.defaultMonitorModelId,
      defaultJudgeProviderConfigId: ai?.defaultJudgeProviderConfigId,
      defaultJudgeModelId: ai?.defaultJudgeModelId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.dependencies.executeWrite(
      `INSERT INTO profiles (
         id, display_name, human_display_name, note, credential_id,
         default_viewer_model_id, default_viewer_reasoning_effort,
         default_viewer_temperature, default_viewer_system_prompt, default_monitor_system_prompt,
         default_monitor_provider_config_id, default_monitor_model_id,
         default_judge_provider_config_id, default_judge_model_id,
         created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        profile.id,
        profile.name,
        profile.humanName ?? null,
        profile.note ?? null,
        profile.credentialId ?? null,
        profile.defaultViewerModelId ?? null,
        profile.defaultViewerReasoningEffort ?? null,
        profile.defaultViewerTemperature ?? null,
        profile.defaultViewerSystemPrompt ?? null,
        profile.defaultMonitorSystemPrompt ?? null,
        profile.defaultMonitorProviderConfigId ?? null,
        profile.defaultMonitorModelId ?? null,
        profile.defaultJudgeProviderConfigId ?? null,
        profile.defaultJudgeModelId ?? null,
        timestamp,
        timestamp,
      ],
    );
    return profile;
  }

  async updateProfile(id: string, input: UpdateProfileInput): Promise<void> {
    await this.dependencies.executeWrite(
      "UPDATE profiles SET display_name = $1, human_display_name = $2, note = $3, updated_at = $4 WHERE id = $5 AND archived_at IS NULL",
      [input.name.trim(), input.humanName?.trim() || null, input.note?.trim() || null, (this.dependencies.now ?? nowIso)(), id],
    );
  }

  async setProfileAiConfiguration(profileId: string, input: ProfileAiConfigurationInput): Promise<void> {
    await this.dependencies.executeWrite(
      `UPDATE profiles
          SET credential_id = $1,
              default_viewer_model_id = $2,
              default_viewer_reasoning_effort = $3,
              default_viewer_temperature = $4,
              default_viewer_system_prompt = $5,
              default_monitor_system_prompt = $6,
              default_monitor_provider_config_id = $7,
              default_monitor_model_id = $8,
              default_judge_provider_config_id = $9,
              default_judge_model_id = $10,
              updated_at = $11
        WHERE id = $12 AND archived_at IS NULL`,
      [
        input.credentialId ?? null,
        input.defaultViewerModelId ?? null,
        input.defaultViewerReasoningEffort ?? null,
        input.defaultViewerTemperature ?? null,
        input.defaultViewerSystemPrompt?.trim() || null,
        input.defaultMonitorSystemPrompt?.trim() || null,
        input.defaultMonitorProviderConfigId ?? null,
        input.defaultMonitorModelId ?? null,
        input.defaultJudgeProviderConfigId ?? null,
        input.defaultJudgeModelId ?? null,
        (this.dependencies.now ?? nowIso)(),
        profileId,
      ],
    );
  }

  async setProfileMonitorSystemPrompt(profileId: string, prompt: string): Promise<void> {
    await this.dependencies.executeWrite(
      "UPDATE profiles SET default_monitor_system_prompt = $1, updated_at = $2 WHERE id = $3",
      [prompt.trim() || null, (this.dependencies.now ?? nowIso)(), profileId],
    );
  }

  async setProfileCredential(profileId: string, credentialId?: string, _provider?: string): Promise<void> {
    await this.dependencies.executeWrite(
      `UPDATE profiles
          SET credential_id = $1,
              default_viewer_model_id = NULL,
              default_viewer_reasoning_effort = NULL,
              default_viewer_temperature = NULL,
              updated_at = $2
        WHERE id = $3`,
      [credentialId ?? null, (this.dependencies.now ?? nowIso)(), profileId],
    );
  }
}
