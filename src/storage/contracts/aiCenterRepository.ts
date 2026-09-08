import type {
  AiIdentity,
  BeginViewerNoteReflectionInput,
  CommitViewerNoteReflectionInput,
  EnsureAiIdentityInput,
  ViewerNoteActivationEvent,
  ViewerNoteBundle,
  ViewerNoteCapacity,
  ViewerNoteReflectionResult,
  ViewerNoteReflectionRun,
  ViewerNoteVersion,
} from "../../aiCenter/types";

/** Internal persistence contract for AI identities and Viewer Notes history/lifecycle. */
export interface AiCenterRepository {
  ensureAiIdentity(input: EnsureAiIdentityInput): Promise<AiIdentity>;
  listAiIdentities(profileId: string): Promise<AiIdentity[]>;
  getViewerNoteBundle(aiIdentityId: string): Promise<ViewerNoteBundle | null>;
  listViewerNoteVersions(aiIdentityId: string): Promise<ViewerNoteVersion[]>;
  listViewerNoteActivationEvents(aiIdentityId: string): Promise<ViewerNoteActivationEvent[]>;
  listViewerNoteReflectionRuns(aiIdentityId: string): Promise<ViewerNoteReflectionRun[]>;
  setViewerNoteCapacity(aiIdentityId: string, capacityTokens: ViewerNoteCapacity): Promise<void>;
  setViewerNotesDefaultEnabled(aiIdentityId: string, enabled: boolean): Promise<void>;
  beginViewerNoteReflection(input: BeginViewerNoteReflectionInput): Promise<ViewerNoteReflectionRun>;
  failViewerNoteReflection(
    runId: string,
    status: Exclude<ViewerNoteReflectionRun["status"], "PENDING" | "UPDATE" | "NO_CHANGE" | "STALE_BASE">,
    failureMessage: string,
    providerRequestId?: string,
    rawFinalResponseSha256?: string,
    attemptCount?: number,
  ): Promise<void>;
  commitViewerNoteReflection(input: CommitViewerNoteReflectionInput): Promise<ViewerNoteReflectionResult>;
  restoreViewerNoteVersion(aiIdentityId: string, versionId: string, workspaceId?: string): Promise<void>;
}
