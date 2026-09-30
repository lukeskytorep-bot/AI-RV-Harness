import type { AppRepository } from "../storage/repository";
import type { CreateProfileInput, Profile, Workspace } from "../types";

export const INITIAL_CONVERSATION_WORKSPACE_NAME = "Conversation Workspace";
export const INITIAL_RV_WORKSPACE_NAME = "RV Workspace";

export interface CreatedProfileWorkspaces {
  profile: Profile;
  conversationWorkspace: Workspace;
  rvWorkspace: Workspace;
}

/**
 * Cross-domain creation use case. A new Profile becomes usable only after both
 * required typed Workspaces exist. If either Workspace creation fails, archive
 * the just-created Profile; Profile archival also archives any Workspace that
 * was already created, so no active partial configuration remains.
 */
export async function createProfileWithInitialWorkspaces(
  repository: Pick<AppRepository, "createProfile" | "createWorkspace" | "archiveProfile">,
  input: CreateProfileInput,
): Promise<CreatedProfileWorkspaces> {
  const profile = await repository.createProfile(input);
  try {
    const conversationWorkspace = await repository.createWorkspace({
      profileId: profile.id,
      name: INITIAL_CONVERSATION_WORKSPACE_NAME,
      kind: "conversation",
    });
    const rvWorkspace = await repository.createWorkspace({
      profileId: profile.id,
      name: INITIAL_RV_WORKSPACE_NAME,
      kind: "rv",
    });
    return { profile, conversationWorkspace, rvWorkspace };
  } catch (cause) {
    try {
      await repository.archiveProfile(profile.id);
    } catch (recoveryCause) {
      const original = cause instanceof Error ? cause.message : String(cause);
      const recovery = recoveryCause instanceof Error ? recoveryCause.message : String(recoveryCause);
      throw new Error(`Initial typed Workspace creation failed (${original}); Profile recovery also failed (${recovery}).`);
    }
    throw cause;
  }
}
