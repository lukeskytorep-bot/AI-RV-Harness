import type { AppRepository } from "../storage/repository";
import type { CreateProfileInput, Profile, Workspace } from "../types";

export const INITIAL_WORKSPACE_NAME = "Workspace 1";

export interface CreatedProfileWorkspace {
  profile: Profile;
  workspace: Workspace;
}

/**
 * Cross-domain creation use case. A new Profile becomes usable only after its
 * first Workspace exists. If Workspace creation fails, archive the just-created
 * Profile so the active directory never contains a Profile with no Workspace.
 */
export async function createProfileWithInitialWorkspace(
  repository: Pick<AppRepository, "createProfile" | "createWorkspace" | "archiveProfile">,
  input: CreateProfileInput,
  workspaceName = INITIAL_WORKSPACE_NAME,
): Promise<CreatedProfileWorkspace> {
  const profile = await repository.createProfile(input);
  try {
    const workspace = await repository.createWorkspace({ profileId: profile.id, name: workspaceName });
    return { profile, workspace };
  } catch (cause) {
    try {
      await repository.archiveProfile(profile.id);
    } catch (recoveryCause) {
      const original = cause instanceof Error ? cause.message : String(cause);
      const recovery = recoveryCause instanceof Error ? recoveryCause.message : String(recoveryCause);
      throw new Error(`Initial Workspace creation failed (${original}); Profile recovery also failed (${recovery}).`);
    }
    throw cause;
  }
}
