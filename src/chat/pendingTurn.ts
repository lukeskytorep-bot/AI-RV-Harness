import type { GenerationSettings, ProviderImageInput } from "../providers/types";
import type { ChatMessage, ChatMode, InterfaceLanguage } from "../types";
import type { ConversationViewerLearningSnapshot } from "./viewerLearning";

export interface PendingChatTurn {
  threadId: string;
  mode: ChatMode;
  language: InterfaceLanguage;
  providerConfigId: string;
  modelId: string;
  modelRoute?: string;
  aiIdentityId?: string;
  viewerLearning?: ConversationViewerLearningSnapshot;
  conversationContextKey?: string;
  content: string;
  requestedSettings: GenerationSettings;
  rvSystemPrompt?: string;
  attachedProtocol?: string;
  sourceIds: string[];
  images: ProviderImageInput[];
  imageNames: string[];
  imageMimeTypes?: string[];
  createdAt: string;
}

const PREFIX = "rvh.pending-chat-turn.";

export function savePendingChatTurn(turn: PendingChatTurn): void {
  // Image bytes are intentionally not persisted. A retry after restart must be text-only
  // unless the user explicitly attaches the image again. Names/types are safe metadata.
  const durable: PendingChatTurn = { ...turn, images: [], imageMimeTypes: turn.imageMimeTypes ?? turn.images.map((image) => image.mimeType) };
  try { localStorage.setItem(`${PREFIX}${turn.threadId}`, JSON.stringify(durable)); } catch { /* SQLite messages still preserve the text turn. */ }
}

export function loadPendingChatTurn(threadId: string, messages: ChatMessage[]): PendingChatTurn | null {
  try {
    const raw = localStorage.getItem(`${PREFIX}${threadId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingChatTurn;
    const last = messages.at(-1);
    if (parsed.threadId !== threadId || !last || last.role !== "user" || last.content.trim() !== parsed.content.trim()) return null;
    // Sanitize legacy records that may still contain image bytes from older releases.
    // Preserve only safe name/MIME metadata and overwrite localStorage immediately.
    const sanitized: PendingChatTurn = {
      ...parsed,
      imageMimeTypes: parsed.imageMimeTypes ?? parsed.images?.map((image) => image.mimeType) ?? [],
      images: [],
    };
    try { localStorage.setItem(`${PREFIX}${threadId}`, JSON.stringify(sanitized)); } catch { /* best-effort legacy cleanup */ }
    return sanitized;
  } catch {
    return null;
  }
}

export function clearPendingChatTurn(threadId: string): void {
  try { localStorage.removeItem(`${PREFIX}${threadId}`); } catch { /* no-op */ }
}
