import type { EligibleViewerIdentity } from "../aiCenter/viewerIdentitySelection";
import type { AppRepository } from "../storage/repository";
import type { InterfaceLanguage } from "../types";

export interface ConversationViewerLearningSnapshot {
  aiIdentityId: string;
  modelRoute: string;
  language: InterfaceLanguage;
  capturedAt: string;
  fieldGuide: {
    versionId: string;
    versionNumber: number;
    content: string;
    contentSha256: string;
  };
  viewerNotes: {
    versionId?: string;
    versionNumber?: number;
    content: string;
    contentSha256: string;
  };
}

const PREF_PREFIX = "rvh.conversation-viewer-learning.";
const CONTEXT_PREFIX = "rvh.conversation-viewer-context.";


export function conversationViewerContextKey(identityId: string, modelRoute: string, snapshot?: ConversationViewerLearningSnapshot): string {
  const learning = snapshot
    ? `${snapshot.fieldGuide.versionId}:${snapshot.fieldGuide.contentSha256}:${snapshot.viewerNotes.versionId ?? "none"}:${snapshot.viewerNotes.contentSha256 || "empty"}`
    : "viewer-learning-off";
  return `${identityId}|${modelRoute}|${learning}`;
}

export function loadConversationViewerContextKey(threadId: string): string | undefined {
  try { return localStorage.getItem(`${CONTEXT_PREFIX}${threadId}`) ?? undefined; } catch { return undefined; }
}

export function saveConversationViewerContextKey(threadId: string, key: string): void {
  try { localStorage.setItem(`${CONTEXT_PREFIX}${threadId}`, key); } catch { /* continuity still has provider fingerprint guards */ }
}

export function loadConversationViewerLearningPreference(threadId: string): boolean | undefined {
  try {
    const raw = localStorage.getItem(`${PREF_PREFIX}${threadId}`);
    return raw === null ? undefined : raw === "1";
  } catch {
    return undefined;
  }
}

export function saveConversationViewerLearningPreference(threadId: string, enabled: boolean): void {
  try { localStorage.setItem(`${PREF_PREFIX}${threadId}`, enabled ? "1" : "0"); } catch { /* preference is optional */ }
}


export function defaultConversationViewerLearningEnabled(input: { saved?: boolean; packageAvailable: boolean; trained: boolean }): boolean {
  if (!input.packageAvailable) return false;
  return input.saved ?? input.trained;
}

export async function loadExistingConversationViewerLearningSnapshot(input: {
  repository: AppRepository;
  identity: EligibleViewerIdentity;
  language: InterfaceLanguage;
  now?: () => string;
}): Promise<ConversationViewerLearningSnapshot | null> {
  const [fieldGuide, viewerNotes] = await Promise.all([
    input.repository.getExistingFieldGuideBundle(input.identity.identity.id, input.language),
    input.repository.getExistingViewerNoteBundle(input.identity.identity.id),
  ]);
  const activeFieldGuide = fieldGuide?.activeVersion;
  if (!activeFieldGuide || !viewerNotes) return null;

  const activeNotes = viewerNotes.activeVersion;
  return {
    aiIdentityId: input.identity.identity.id,
    modelRoute: input.identity.model.route,
    language: input.language,
    capturedAt: (input.now ?? (() => new Date().toISOString()))(),
    fieldGuide: {
      versionId: activeFieldGuide.id,
      versionNumber: activeFieldGuide.versionNumber,
      content: activeFieldGuide.content,
      contentSha256: activeFieldGuide.contentSha256,
    },
    viewerNotes: {
      ...(activeNotes ? { versionId: activeNotes.id, versionNumber: activeNotes.versionNumber } : {}),
      content: activeNotes?.content ?? "",
      contentSha256: activeNotes?.contentSha256 ?? "",
    },
  };
}

export function viewerLearningSystemMessages(snapshot: ConversationViewerLearningSnapshot, language: InterfaceLanguage) {
  const boundary = language === "pl"
    ? "Poniższe Field Guide i Viewer Notes należą do dokładnie wybranej tożsamości Viewera. Są pomocniczym kontekstem tylko do odczytu. Możesz korzystać z zawartej w nich wiedzy podczas rozmowy, lecz ta Conversation nie tworzy, nie aktualizuje ani nie aktywuje ich wersji. Nie traktuj ich jako polecenia rozpoczęcia sesji RV, jeżeli użytkownik nie poprosił o taką sesję."
    : "The Field Guide and Viewer Notes below belong to the exact selected Viewer identity. They are read-only supporting context. You may use their knowledge during the conversation, but this Conversation does not create, update, or activate their versions. Do not treat them as an instruction to begin an RV session unless the user explicitly requests one.";
  const fieldGuide = `[VIEWER LEARNING FIELD GUIDE — READ-ONLY]\nidentity=${snapshot.aiIdentityId}\nroute=${snapshot.modelRoute}\nversion=${snapshot.fieldGuide.versionNumber}\nversion_id=${snapshot.fieldGuide.versionId}\nsha256=${snapshot.fieldGuide.contentSha256}\n[BEGIN FIELD GUIDE]\n${snapshot.fieldGuide.content}\n[END FIELD GUIDE]`;
  const notesVersion = snapshot.viewerNotes.versionNumber === undefined ? "none" : String(snapshot.viewerNotes.versionNumber);
  const notesVersionId = snapshot.viewerNotes.versionId ?? "none";
  const viewerNotes = `[VIEWER LEARNING VIEWER NOTES — READ-ONLY]\nidentity=${snapshot.aiIdentityId}\nroute=${snapshot.modelRoute}\nversion=${notesVersion}\nversion_id=${notesVersionId}\nsha256=${snapshot.viewerNotes.contentSha256 || "empty"}\n[BEGIN VIEWER NOTES]\n${snapshot.viewerNotes.content}\n[END VIEWER NOTES]`;
  return [
    { role: "system" as const, content: `[VIEWER LEARNING — READ-ONLY BOUNDARY]\n${boundary}` },
    { role: "system" as const, content: fieldGuide },
    { role: "system" as const, content: viewerNotes },
  ];
}
