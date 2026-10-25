import type {
  CreateProfileInput,
  Profile,
  ProfileAiConfigurationInput,
  UpdateProfileInput,
} from "../../types";
import type { ProfilesRepository } from "../contracts/profilesRepository";
import { createId, nowIso } from "../repository";

const PROFILES_KEY = "rvh.dev.profiles";

type ProfileStorage = Pick<Storage, "getItem" | "setItem">;

export interface BrowserProfilesRepositoryDependencies {
  storage?: ProfileStorage;
  createId?: typeof createId;
  now?: typeof nowIso;
}

export class BrowserProfilesRepository implements ProfilesRepository {
  constructor(private readonly dependencies: BrowserProfilesRepositoryDependencies = {}) {}

  private get storage(): ProfileStorage {
    return this.dependencies.storage ?? localStorage;
  }

  private readProfiles(): Profile[] {
    try {
      const raw = this.storage.getItem(PROFILES_KEY);
      return raw ? (JSON.parse(raw) as Profile[]) : [];
    } catch {
      return [];
    }
  }

  private writeProfiles(profiles: Profile[]): void {
    this.storage.setItem(PROFILES_KEY, JSON.stringify(profiles));
  }

  async listProfiles(): Promise<Profile[]> {
    return this.readProfiles()
      .filter((profile) => !profile.archivedAt)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async listArchivedProfiles(): Promise<Profile[]> {
    return this.readProfiles()
      .filter((profile) => Boolean(profile.archivedAt))
      .sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""));
  }

  async createProfile(input: CreateProfileInput): Promise<Profile> {
    const timestamp = (this.dependencies.now ?? nowIso)();
    const profile: Profile = {
      id: (this.dependencies.createId ?? createId)("profile"),
      name: input.name.trim(),
      humanName: input.humanName?.trim() || undefined,
      note: input.note?.trim() || undefined,
      credentialId: input.aiConfiguration?.credentialId,
      credentialProvider: input.aiConfiguration?.credentialProvider,
      defaultViewerModelId: input.aiConfiguration?.defaultViewerModelId,
      defaultViewerReasoningEffort: input.aiConfiguration?.defaultViewerReasoningEffort,
      defaultViewerTemperature: input.aiConfiguration?.defaultViewerTemperature,
      defaultViewerSystemPrompt: input.aiConfiguration?.defaultViewerSystemPrompt?.trim() || undefined,
      defaultMonitorSystemPrompt: input.aiConfiguration?.defaultMonitorSystemPrompt?.trim() || undefined,
      defaultMonitorProviderConfigId: input.aiConfiguration?.defaultMonitorProviderConfigId,
      defaultMonitorModelId: input.aiConfiguration?.defaultMonitorModelId,
      defaultJudgeProviderConfigId: input.aiConfiguration?.defaultJudgeProviderConfigId,
      defaultJudgeModelId: input.aiConfiguration?.defaultJudgeModelId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.writeProfiles([profile, ...this.readProfiles()]);
    return profile;
  }

  async updateProfile(id: string, input: UpdateProfileInput): Promise<void> {
    const timestamp = (this.dependencies.now ?? nowIso)();
    this.writeProfiles(this.readProfiles().map((profile) => profile.id === id
      ? {
          ...profile,
          name: input.name.trim(),
          humanName: input.humanName?.trim() || undefined,
          note: input.note?.trim() || undefined,
          updatedAt: timestamp,
        }
      : profile));
  }

  async setProfileAiConfiguration(profileId: string, input: ProfileAiConfigurationInput): Promise<void> {
    const timestamp = (this.dependencies.now ?? nowIso)();
    this.writeProfiles(this.readProfiles().map((profile) => profile.id === profileId
      ? {
          ...profile,
          credentialId: input.credentialId,
          credentialProvider: input.credentialProvider,
          defaultViewerModelId: input.defaultViewerModelId,
          defaultViewerReasoningEffort: input.defaultViewerReasoningEffort,
          defaultViewerTemperature: input.defaultViewerTemperature,
          defaultViewerSystemPrompt: input.defaultViewerSystemPrompt?.trim() || undefined,
          defaultMonitorSystemPrompt: input.defaultMonitorSystemPrompt?.trim() || undefined,
          defaultMonitorProviderConfigId: input.defaultMonitorProviderConfigId,
          defaultMonitorModelId: input.defaultMonitorModelId,
          defaultJudgeProviderConfigId: input.defaultJudgeProviderConfigId,
          defaultJudgeModelId: input.defaultJudgeModelId,
          updatedAt: timestamp,
        }
      : profile));
  }

  async setProfileMonitorSystemPrompt(profileId: string, prompt: string): Promise<void> {
    const profiles = this.readProfiles();
    if (!profiles.some((profile) => profile.id === profileId)) throw new Error("Profile not found.");
    const updatedAt = (this.dependencies.now ?? nowIso)();
    this.writeProfiles(profiles.map((profile) => profile.id === profileId
      ? { ...profile, defaultMonitorSystemPrompt: prompt.trim() || undefined, updatedAt }
      : profile));
  }

  async setProfileCredential(profileId: string, credentialId?: string, provider?: string): Promise<void> {
    const timestamp = (this.dependencies.now ?? nowIso)();
    this.writeProfiles(this.readProfiles().map((profile) => profile.id === profileId
      ? {
          ...profile,
          credentialId,
          credentialProvider: provider,
          defaultViewerModelId: undefined,
          defaultViewerReasoningEffort: undefined,
          defaultViewerTemperature: undefined,
          updatedAt: timestamp,
        }
      : profile));
  }
}
