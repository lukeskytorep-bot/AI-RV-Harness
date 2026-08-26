import type { GenerationSettings, ProviderImageInput } from "../providers/types";
import type { ChatMessage, ChatMode, InterfaceLanguage } from "../types";

export interface PendingChatTurn {
  threadId: string;
  mode: ChatMode;
  language: InterfaceLanguage;
  providerConfigId: string;
  modelId: string;
  content: string;
  requestedSettings: GenerationSettings;
  rvSystemPrompt?: string;
  attachedProtocol?: string;
  sourceIds: string[];
  images: ProviderImageInput[];
  imageNames: string[];
  createdAt: string;
}

const PREFIX = "rvh.pending-chat-turn.";

export function savePendingChatTurn(turn: PendingChatTurn): void {
  try { localStorage.setItem(`${PREFIX}${turn.threadId}`, JSON.stringify(turn)); } catch { /* SQLite messages still preserve the text turn. */ }
}

export function loadPendingChatTurn(threadId: string, messages: ChatMessage[]): PendingChatTurn | null {
  try {
    const raw = localStorage.getItem(`${PREFIX}${threadId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingChatTurn;
    const last = messages.at(-1);
    if (parsed.threadId !== threadId || !last || last.role !== "user" || last.content.trim() !== parsed.content.trim()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingChatTurn(threadId: string): void {
  try { localStorage.removeItem(`${PREFIX}${threadId}`); } catch { /* no-op */ }
}
