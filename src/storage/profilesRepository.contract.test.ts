import { describe, expect, it } from "vitest";
import type { ReasoningEffort } from "../providers/types";
import type { Profile } from "../types";
import { BrowserProfilesRepository } from "./browser/profilesRepository";
import type { ProfilesRepository } from "./contracts/profilesRepository";
import {
  SqliteProfilesRepository,
  type SqliteProfilesRepositoryDependencies,
} from "./sqlite/profilesRepository";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

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
  default_viewer_sampling_enabled: number;
  default_viewer_top_p: number | null;
  default_viewer_top_k: number | null;
  default_viewer_seed: number | null;
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

interface ContractHarness {
  repository: ProfilesRepository;
  seed(profiles: Profile[]): void;
}

function sequenceClock() {
  let tick = 0;
  return () => `2026-09-06T00:00:0${tick++}.000Z`;
}

function browserHarness(): ContractHarness {
  const storage = new MemoryStorage();
  let id = 0;
  return {
    repository: new BrowserProfilesRepository({
      storage,
      createId: () => `profile-${++id}`,
      now: sequenceClock(),
    }),
    seed: (profiles) => storage.setItem("rvh.dev.profiles", JSON.stringify(profiles)),
  };
}

function toRow(profile: Profile): ProfileRow {
  return {
    id: profile.id,
    display_name: profile.name,
    human_display_name: profile.humanName ?? null,
    note: profile.note ?? null,
    credential_id: profile.credentialId ?? null,
    credential_provider: profile.credentialProvider ?? null,
    default_viewer_model_id: profile.defaultViewerModelId ?? null,
    default_viewer_reasoning_effort: profile.defaultViewerReasoningEffort ?? null,
    default_viewer_temperature: profile.defaultViewerTemperature ?? null,
    default_viewer_sampling_enabled: profile.defaultViewerOpenRouterSampling?.enabled ? 1 : 0,
    default_viewer_top_p: profile.defaultViewerOpenRouterSampling?.topP ?? null,
    default_viewer_top_k: profile.defaultViewerOpenRouterSampling?.topK ?? null,
    default_viewer_seed: profile.defaultViewerOpenRouterSampling?.seed ?? null,
    default_viewer_system_prompt: profile.defaultViewerSystemPrompt ?? null,
    default_monitor_system_prompt: profile.defaultMonitorSystemPrompt ?? null,
    default_monitor_provider_config_id: profile.defaultMonitorProviderConfigId ?? null,
    default_monitor_model_id: profile.defaultMonitorModelId ?? null,
    default_judge_provider_config_id: profile.defaultJudgeProviderConfigId ?? null,
    default_judge_model_id: profile.defaultJudgeModelId ?? null,
    created_at: profile.createdAt,
    updated_at: profile.updatedAt,
    archived_at: profile.archivedAt ?? null,
  };
}

function sqliteHarness(): ContractHarness {
  let rows: ProfileRow[] = [];
  let id = 0;
  const dependencies: SqliteProfilesRepositoryDependencies = {
    now: sequenceClock(),
    createId: () => `profile-${++id}`,
    select: async <T>(query: string) => {
      const archived = query.includes("p.archived_at IS NOT NULL");
      const selected = rows
        .filter((row) => archived ? row.archived_at !== null : row.archived_at === null)
        .sort((a, b) => archived
          ? (b.archived_at ?? "").localeCompare(a.archived_at ?? "")
          : b.updated_at.localeCompare(a.updated_at));
      return selected.map((row) => ({ ...row })) as T;
    },
    executeWrite: async (query: string, values: unknown[] = []) => {
      if (query.includes("INSERT INTO profiles")) {
        rows.unshift({
          id: String(values[0]),
          display_name: String(values[1]),
          human_display_name: values[2] as string | null,
          note: values[3] as string | null,
          credential_id: values[4] as string | null,
          credential_provider: null,
          default_viewer_model_id: values[5] as string | null,
          default_viewer_reasoning_effort: values[6] as ProfileRow["default_viewer_reasoning_effort"],
          default_viewer_temperature: values[7] as number | null,
          default_viewer_sampling_enabled: values[8] as number,
          default_viewer_top_p: values[9] as number | null,
          default_viewer_top_k: values[10] as number | null,
          default_viewer_seed: values[11] as number | null,
          default_viewer_system_prompt: values[12] as string | null,
          default_monitor_system_prompt: values[13] as string | null,
          default_monitor_provider_config_id: values[14] as string | null,
          default_monitor_model_id: values[15] as string | null,
          default_judge_provider_config_id: values[16] as string | null,
          default_judge_model_id: values[17] as string | null,
          created_at: String(values[18]),
          updated_at: String(values[19]),
          archived_at: null,
        });
        return;
      }
      if (query.includes("display_name = $1")) {
        const row = rows.find((item) => item.id === values[4] && item.archived_at === null);
        if (row) Object.assign(row, { display_name: values[0], human_display_name: values[1], note: values[2], updated_at: values[3] });
        return;
      }
      if (query.includes("default_viewer_sampling_enabled = CASE WHEN $5 = 1")) {
        const row = rows.find((item) => item.id === values[16] && item.archived_at === null);
        if (row) Object.assign(row, {
          credential_id: values[0],
          default_viewer_model_id: values[1],
          default_viewer_reasoning_effort: values[2],
          default_viewer_temperature: values[3],
          ...(values[4] === 1 ? {
            default_viewer_sampling_enabled: values[5],
            default_viewer_top_p: values[6],
            default_viewer_top_k: values[7],
            default_viewer_seed: values[8],
          } : {}),
          default_viewer_system_prompt: values[9],
          default_monitor_system_prompt: values[10],
          default_monitor_provider_config_id: values[11],
          default_monitor_model_id: values[12],
          default_judge_provider_config_id: values[13],
          default_judge_model_id: values[14],
          updated_at: values[15],
        });
        return;
      }
      if (query.includes("default_monitor_system_prompt = $1")) {
        const row = rows.find((item) => item.id === values[2]);
        if (row) Object.assign(row, { default_monitor_system_prompt: values[0], updated_at: values[1] });
        return;
      }
      if (query.includes("default_viewer_model_id = NULL")) {
        const row = rows.find((item) => item.id === values[2]);
        if (row) Object.assign(row, {
          credential_id: values[0],
          default_viewer_model_id: null,
          default_viewer_reasoning_effort: null,
          default_viewer_temperature: null,
          updated_at: values[1],
        });
      }
    },
  };
  return {
    repository: new SqliteProfilesRepository(dependencies),
    seed: (profiles) => { rows = profiles.map(toRow); },
  };
}

function runProfilesRepositoryContract(name: string, createHarness: () => ContractHarness) {
  describe(`${name} ProfilesRepository contract`, () => {
    it("normalizes new and updated Profile fields and keeps active ordering", async () => {
      const { repository } = createHarness();
      const first = await repository.createProfile({ name: "  First  ", humanName: "  Human  ", note: "  note  " });
      const second = await repository.createProfile({ name: "Second" });

      expect(first).toMatchObject({ name: "First", humanName: "Human", note: "note" });
      expect((await repository.listProfiles()).map((profile) => profile.id)).toEqual([second.id, first.id]);

      await repository.updateProfile(first.id, { name: "  Updated  ", humanName: "  Owner  ", note: "  changed  " });
      expect((await repository.listProfiles())[0]).toMatchObject({ id: first.id, name: "Updated", humanName: "Owner", note: "changed" });
    });

    it("preserves Profile AI fields while applying narrow prompt and credential updates", async () => {
      const { repository } = createHarness();
      const profile = await repository.createProfile({ name: "Viewer" });
      await repository.setProfileAiConfiguration(profile.id, {
        credentialId: "credential-old",
        defaultViewerModelId: "viewer-model",
        defaultViewerReasoningEffort: "high",
        defaultViewerTemperature: 0.4,
        defaultViewerSystemPrompt: "  viewer prompt  ",
        defaultMonitorSystemPrompt: "  monitor old  ",
        defaultMonitorModelId: "monitor-model",
        defaultJudgeModelId: "judge-model",
      });
      await repository.setProfileMonitorSystemPrompt(profile.id, "  monitor new  ");
      await repository.setProfileCredential(profile.id, "credential-new", "openrouter");

      expect((await repository.listProfiles())[0]).toMatchObject({
        id: profile.id,
        credentialId: "credential-new",
        defaultMonitorSystemPrompt: "monitor new",
        defaultMonitorModelId: "monitor-model",
        defaultJudgeModelId: "judge-model",
      });
      expect((await repository.listProfiles())[0]?.defaultViewerModelId).toBeUndefined();
      expect((await repository.listProfiles())[0]?.defaultViewerReasoningEffort).toBeUndefined();
      expect((await repository.listProfiles())[0]?.defaultViewerTemperature).toBeUndefined();
    });

    it("round-trips OpenRouter sampling, preserves zero values, and keeps stored sampling across credential changes", async () => {
      const { repository } = createHarness();
      const profile = await repository.createProfile({
        name: "Sampling Viewer",
        aiConfiguration: {
          credentialId: "credential-or",
          credentialProvider: "openrouter",
          defaultViewerModelId: "model-a",
          defaultViewerTemperature: 0.7,
          defaultViewerOpenRouterSampling: { enabled: true, topP: 0.04, topK: 0, seed: 42 },
        },
      });

      expect((await repository.listProfiles())[0]).toMatchObject({
        defaultViewerTemperature: 0.7,
        defaultViewerOpenRouterSampling: { enabled: true, topP: 0.04, topK: 0, seed: 42 },
      });

      await repository.setProfileAiConfiguration(profile.id, {
        credentialId: "credential-or",
        credentialProvider: "openrouter",
        defaultViewerModelId: "model-a",
        defaultViewerTemperature: 0.7,
        defaultViewerOpenRouterSampling: { enabled: false, topP: 0.04, topK: 0, seed: 42 },
      });
      expect((await repository.listProfiles())[0]?.defaultViewerOpenRouterSampling).toEqual({ enabled: false, topP: 0.04, topK: 0, seed: 42 });

      await repository.setProfileCredential(profile.id, "credential-other", "mistral");
      const afterProviderChange = (await repository.listProfiles())[0];
      expect(afterProviderChange?.defaultViewerTemperature).toBeUndefined();
      expect(afterProviderChange?.defaultViewerOpenRouterSampling).toEqual({ enabled: false, topP: 0.04, topK: 0, seed: 42 });
    });

    it("rejects malformed sampling enabled values before write and preserves the previous profile", async () => {
      const { repository } = createHarness();
      const profile = await repository.createProfile({
        name: "Sampling Viewer",
        aiConfiguration: {
          credentialId: "credential-or",
          credentialProvider: "openrouter",
          defaultViewerModelId: "model-a",
          defaultViewerTemperature: 0.6,
          defaultViewerOpenRouterSampling: { enabled: true, topK: 64 },
        },
      });

      const malformedEnabledValues: unknown[] = ["false", 1, null, undefined];
      for (const enabled of malformedEnabledValues) {
        const malformedSampling = enabled === undefined
          ? { topK: 20 }
          : { enabled, topK: 20 };

        await expect(repository.setProfileAiConfiguration(profile.id, {
          credentialId: "credential-or",
          credentialProvider: "openrouter",
          defaultViewerModelId: "model-b",
          defaultViewerTemperature: 0.2,
          defaultViewerOpenRouterSampling: malformedSampling as never,
        })).rejects.toThrow("enabled must be a boolean");

        expect((await repository.listProfiles())[0]).toMatchObject({
          defaultViewerModelId: "model-a",
          defaultViewerTemperature: 0.6,
          defaultViewerOpenRouterSampling: { enabled: true, topK: 64 },
        });
      }
    });

    it("round-trips the shared sampling columns for Custom OpenAI-compatible and rejects unrelated providers", async () => {
      const { repository } = createHarness();
      const custom = await repository.createProfile({
        name: "Custom Sampling Viewer",
        aiConfiguration: {
          credentialId: "credential-custom",
          credentialProvider: "custom_openai",
          defaultViewerModelId: "model-custom",
          defaultViewerTemperature: 0.8,
          defaultViewerOpenRouterSampling: { enabled: true, topP: 0.04, topK: 0, seed: 42 },
        },
      });
      expect((await repository.listProfiles()).find((item) => item.id === custom.id)?.defaultViewerOpenRouterSampling)
        .toEqual({ enabled: true, topP: 0.04, topK: 0, seed: 42 });

      await repository.setProfileAiConfiguration(custom.id, {
        credentialId: "credential-custom",
        credentialProvider: "custom_openai",
        defaultViewerModelId: "model-custom",
        defaultViewerTemperature: 1.1,
      });
      expect((await repository.listProfiles()).find((item) => item.id === custom.id)).toMatchObject({
        defaultViewerTemperature: 1.1,
        defaultViewerOpenRouterSampling: { enabled: true, topP: 0.04, topK: 0, seed: 42 },
      });

      await repository.setProfileCredential(custom.id, "credential-other", "mistral");
      await repository.setProfileCredential(custom.id, "credential-custom", "custom_openai");
      expect((await repository.listProfiles()).find((item) => item.id === custom.id)?.defaultViewerOpenRouterSampling)
        .toEqual({ enabled: true, topP: 0.04, topK: 0, seed: 42 });

      const unrelated = await repository.createProfile({ name: "Viewer" });
      await expect(repository.setProfileAiConfiguration(unrelated.id, {
        credentialId: "credential-m",
        credentialProvider: "mistral",
        defaultViewerModelId: "model-m",
        defaultViewerOpenRouterSampling: { enabled: true, topP: 0.7 },
      })).rejects.toThrow("OpenRouter or Custom OpenAI-compatible");
    });

    it("separates and sorts active and archived Profile records", async () => {
      const { repository, seed } = createHarness();
      seed([
        { id: "active-old", name: "Old", createdAt: "1", updatedAt: "2026-09-01T00:00:00.000Z" },
        { id: "active-new", name: "New", createdAt: "2", updatedAt: "2026-09-02T00:00:00.000Z" },
        { id: "archived-old", name: "Archived old", createdAt: "3", updatedAt: "3", archivedAt: "2026-08-01T00:00:00.000Z" },
        { id: "archived-new", name: "Archived new", createdAt: "4", updatedAt: "4", archivedAt: "2026-08-02T00:00:00.000Z" },
      ]);

      expect((await repository.listProfiles()).map((profile) => profile.id)).toEqual(["active-new", "active-old"]);
      expect((await repository.listArchivedProfiles()).map((profile) => profile.id)).toEqual(["archived-new", "archived-old"]);
    });
  });
}

runProfilesRepositoryContract("browser", browserHarness);
runProfilesRepositoryContract("SQLite", sqliteHarness);
