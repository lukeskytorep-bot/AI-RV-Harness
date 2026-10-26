import { latestCompatibleWorkspace } from "../domain/workspaceKind";
import type { Profile, Workspace } from "../types";

export interface ProfileWorkspaceSelectionInput {
  profiles: readonly Profile[];
  workspaces: readonly Workspace[];
  activeProfileId: string | null;
  activeConversationWorkspaceId: string | null;
  activeRvWorkspaceId: string | null;
  selectedProfileId: string;
}

export interface ProfileWorkspaceSelection {
  profileId: string;
  conversationWorkspaceId: string | null;
  rvWorkspaceId: string | null;
  changed: boolean;
}

export function resolveProfileWorkspaceSelection(input: ProfileWorkspaceSelectionInput): ProfileWorkspaceSelection | null {
  if (!input.profiles.some((profile) => profile.id === input.selectedProfileId)) return null;

  if (input.selectedProfileId === input.activeProfileId) {
    return {
      profileId: input.selectedProfileId,
      conversationWorkspaceId: input.activeConversationWorkspaceId,
      rvWorkspaceId: input.activeRvWorkspaceId,
      changed: false,
    };
  }

  return {
    profileId: input.selectedProfileId,
    conversationWorkspaceId: latestCompatibleWorkspace(input.workspaces, "conversation", input.selectedProfileId)?.id ?? null,
    rvWorkspaceId: latestCompatibleWorkspace(input.workspaces, "rv", input.selectedProfileId)?.id ?? null,
    changed: true,
  };
}

export interface OpenedWorkspaceSelectionInput {
  workspaces: readonly Workspace[];
  activeProfileId: string | null;
  activeConversationWorkspaceId: string | null;
  activeRvWorkspaceId: string | null;
  workspace: Workspace;
  requiredKind: "conversation" | "rv";
}

export interface OpenedWorkspaceSelection {
  profileId: string;
  conversationWorkspaceId: string | null;
  rvWorkspaceId: string | null;
}

export function resolveOpenedWorkspaceSelection(input: OpenedWorkspaceSelectionInput): OpenedWorkspaceSelection {
  const profileChanged = input.workspace.profileId !== input.activeProfileId;
  const counterpartKind = input.requiredKind === "conversation" ? "rv" : "conversation";
  const counterpartWorkspaceId = profileChanged
    ? latestCompatibleWorkspace(input.workspaces, counterpartKind, input.workspace.profileId)?.id ?? null
    : counterpartKind === "conversation"
      ? input.activeConversationWorkspaceId
      : input.activeRvWorkspaceId;

  return {
    profileId: input.workspace.profileId,
    conversationWorkspaceId: input.requiredKind === "conversation" ? input.workspace.id : counterpartWorkspaceId,
    rvWorkspaceId: input.requiredKind === "rv" ? input.workspace.id : counterpartWorkspaceId,
  };
}
