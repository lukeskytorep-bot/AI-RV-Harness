import type { ChatMessage, ChatMessageMetadata } from "../types";
import type { AppRepository } from "../storage/repository";
type ChatRepository = Pick<AppRepository, "listChatMessages" | "updateChatMessageMetadata">;

// A thread operation owns both execution and recovery decisions. Web Locks also
// excludes another window in the same origin/storage partition when supported.
const activeThreads = new Set<string>();
export async function withChatResponseOperation<T>(threadId: string, task: () => Promise<T>): Promise<T> {
  const run = async () => {
    if (activeThreads.has(threadId)) throw new Error("Conversation work is running in another window or operation.");
    activeThreads.add(threadId);
    try { return await task(); } finally { activeThreads.delete(threadId); }
  };
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks?.request) return run();
  return locks.request(`rvh-chat-response:${threadId}`, { mode: "exclusive", ifAvailable: true }, async lock => {
    if (!lock) throw new Error("Conversation work is running in another window or operation.");
    return run();
  });
}

export function chatResponseNeedsResolution(message: ChatMessage | undefined): boolean {
  return ["prepared", "dispatched", "uncertain"].includes(message?.metadata?.responseRecovery?.state ?? "");
}

async function currentUnanswered(repository: ChatRepository, threadId: string): Promise<ChatMessage> {
  const last = (await repository.listChatMessages(threadId)).at(-1);
  if (!last || last.role !== "user") throw new Error("There is no unanswered response to recover.");
  return last;
}

export async function endChatResponse(repository: ChatRepository, threadId: string): Promise<void> {
  return withChatResponseOperation(threadId, async () => {
    const last = await currentUnanswered(repository, threadId);
    if (last.metadata?.responseRecovery?.state === "ended") return;
    const recovery = last.metadata?.responseRecovery;
    const metadata: ChatMessageMetadata = { ...last.metadata, responseRecovery: {
      state: "ended", attempts: recovery?.attempts ?? [], endedAt: new Date().toISOString(),
    } };
    await repository.updateChatMessageMetadata(last.id, metadata);
    const saved = await currentUnanswered(repository, threadId);
    if (saved.metadata?.responseRecovery?.state !== "ended") throw new Error("Response end marker could not be persisted.");
  });
}

export async function approveChatResponseRetry(repository: ChatRepository, threadId: string): Promise<void> {
  return withChatResponseOperation(threadId, async () => {
    const last = await currentUnanswered(repository, threadId);
    if (last.metadata?.responseRecovery?.state === "ended") throw new Error("This response was ended and cannot be resumed.");
    if (!chatResponseNeedsResolution(last)) return;
    await repository.updateChatMessageMetadata(last.id, { ...last.metadata, responseRecovery: {
      ...last.metadata!.responseRecovery!, state: "retry_approved", retryApprovedAt: new Date().toISOString(),
    } });
  });
}

export async function chatResponseOperationState(threadId: string): Promise<"idle" | "other" | "unknown"> {
  if (activeThreads.has(threadId)) return "other";
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks?.query) return "idle";
  try {
    const snapshot = await locks.query();
    return snapshot.held?.some(lock => lock.name === `rvh-chat-response:${threadId}`) ? "other" : "idle";
  } catch { return "unknown"; }
}
