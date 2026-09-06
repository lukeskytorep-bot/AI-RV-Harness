import type {
  CreateProfileInput,
  Profile,
  ProfileAiConfigurationInput,
  UpdateProfileInput,
} from "../../types";

/**
 * Internal persistence contract for operations that only mutate Profile data.
 *
 * Profile archive/restore intentionally remain on AppRepository because those
 * operations also update Workspaces and therefore require an explicit
 * cross-domain transaction owner.
 */
export interface ProfilesRepository {
  listProfiles(): Promise<Profile[]>;
  listArchivedProfiles(): Promise<Profile[]>;
  createProfile(input: CreateProfileInput): Promise<Profile>;
  updateProfile(id: string, input: UpdateProfileInput): Promise<void>;
  setProfileAiConfiguration(profileId: string, input: ProfileAiConfigurationInput): Promise<void>;
  setProfileMonitorSystemPrompt(profileId: string, prompt: string): Promise<void>;
  setProfileCredential(profileId: string, credentialId?: string, provider?: string): Promise<void>;
}
