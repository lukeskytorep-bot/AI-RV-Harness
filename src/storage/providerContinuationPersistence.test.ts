import { describe, expect, it } from "vitest";
import openRouterFixture from "../providers/continuation-fixtures/openrouter-reasoning-details.json";
import { validateProviderContinuationState, type ProviderContinuationState } from "../providers/continuationContract";
import { operationForWriteQuery } from "./databaseWriteOperations";
import {
  BROWSER_CHAT_MESSAGE_PROVIDER_STATE_KEY,
  browserChatMessageProviderStateFreshKey,
  browserChatMessageProviderStateResetKey,
  prepareProviderContinuationState,
  ProviderContinuationPersistenceError,
  restoreProviderContinuationState,
} from "./providerContinuationState";
import { BrowserWorkspacesConversationsRepository } from "./browser/workspacesConversationsRepository";
import { BrowserSessionsRepository } from "./browser/sessionsRepository";
import { SqliteWorkspacesConversationsRepository } from "./sqlite/workspacesConversationsRepository";
import { SqliteSessionsRepository } from "./sqlite/sessionsRepository";

const timestamp = "2026-09-24T08:00:00.000Z";

function openRouterState(): ProviderContinuationState {
  const checked = validateProviderContinuationState(openRouterFixture.continuationState);
  if (!checked.ok) throw new Error(checked.message);
  return checked.value;
}

class MemoryStorage implements Storage {
  protected data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.get(key) ?? null; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, value); }
}

describe("OPENROUTER-CONTINUITY-PERSISTENCE-1", () => {
  it("round-trips exact validated state with canonical hash and UTF-8 size and rejects tampering", async () => {
    const state = openRouterState();
    const prepared = await prepareProviderContinuationState(state);
    const row = {
      ownerId: "assistant-1",
      format: prepared.format,
      formatVersion: prepared.formatVersion,
      transport: prepared.transport,
      replayFingerprintJson: prepared.replayFingerprintJson,
      payloadJson: prepared.payloadJson,
      payloadSha256: prepared.payloadSha256,
      payloadSizeBytes: prepared.payloadSizeBytes,
      createdAt: timestamp,
    };
    const restored = await restoreProviderContinuationState(row);
    expect(restored.ownerId).toBe("assistant-1");
    expect(restored.state).toEqual(state);
    expect(restored.payloadSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(restored.payloadSizeBytes).toBe(new TextEncoder().encode(prepared.payloadJson).byteLength);

    await expect(restoreProviderContinuationState({ ...row, payloadJson: `${prepared.payloadJson} ` }))
      .rejects.toBeInstanceOf(ProviderContinuationPersistenceError);
    await expect(restoreProviderContinuationState({ ...row, payloadSha256: "0".repeat(64) }))
      .rejects.toThrow(/hash check failed/);
  });

  it("persists Browser Conversation assistant message and state atomically and restores exact state", async () => {
    const storage = new MemoryStorage();
    const repository = new BrowserWorkspacesConversationsRepository({ storage, now: () => timestamp });
    const thread = await repository.createChatThread("workspace-1", "conversation", "Continuity");
    const state = openRouterState();

    const assistant = await repository.appendAssistantMessageWithProviderState(thread.id, "Visible answer", state);
    expect((await repository.listChatMessages(thread.id))).toEqual([assistant]);
    const bindings = await repository.listChatMessageProviderStates(thread.id);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.ownerId).toBe(assistant.id);
    expect(bindings[0]?.state).toEqual(state);
    expect(storage.getItem("rvh.dev.chat_messages")).not.toContain("reasoningDetails");
    expect(storage.getItem(BROWSER_CHAT_MESSAGE_PROVIDER_STATE_KEY)).toContain("openrouter-reasoning-details");
  });

  it("fails closed instead of overwriting malformed Browser provider-state storage", async () => {
    const conversationStorage = new MemoryStorage();
    conversationStorage.setItem(BROWSER_CHAT_MESSAGE_PROVIDER_STATE_KEY, "{broken");
    const conversationRepository = new BrowserWorkspacesConversationsRepository({ storage: conversationStorage, now: () => timestamp });
    const thread = await conversationRepository.createChatThread("workspace-1", "conversation", "Continuity");
    await expect(conversationRepository.appendAssistantMessageWithProviderState(thread.id, "answer", openRouterState()))
      .rejects.toBeInstanceOf(ProviderContinuationPersistenceError);
    expect(conversationStorage.getItem(BROWSER_CHAT_MESSAGE_PROVIDER_STATE_KEY)).toBe("{broken");
    expect(conversationStorage.getItem("rvh.dev.chat_messages")).toBeNull();

    const sessionStorage = new MemoryStorage();
    sessionStorage.setItem("rvh.dev.session_event_provider_state", "{broken");
    const sessionRepository = new BrowserSessionsRepository({ storage: sessionStorage, now: () => timestamp, isResearchScoresFrozen: () => true });
    await expect(sessionRepository.appendSessionEventWithProviderState("session-1", { eventType: "VIEWER_RESPONSE", role: "assistant", content: "answer" }, openRouterState()))
      .rejects.toBeInstanceOf(ProviderContinuationPersistenceError);
    expect(sessionStorage.getItem("rvh.dev.session_event_provider_state")).toBe("{broken");
    expect(sessionStorage.getItem("rvh.dev.session_events")).toBeNull();
  });

  it("makes explicit Browser Conversation reset durable and starts a fresh chain even when legacy state storage is malformed", async () => {
    const storage = new MemoryStorage();
    storage.setItem(BROWSER_CHAT_MESSAGE_PROVIDER_STATE_KEY, "{broken");
    const repository = new BrowserWorkspacesConversationsRepository({ storage, now: () => timestamp });
    const thread = await repository.createChatThread("workspace-1", "conversation", "Continuity");

    await repository.resetChatMessageProviderStates(thread.id);
    expect(storage.getItem(browserChatMessageProviderStateResetKey(thread.id))).toBe("1");
    const assistant = await repository.appendAssistantMessageWithProviderState(thread.id, "Fresh answer", openRouterState());
    expect(storage.getItem(BROWSER_CHAT_MESSAGE_PROVIDER_STATE_KEY)).toBe("{broken");
    expect(storage.getItem(browserChatMessageProviderStateFreshKey(thread.id))).toContain("openrouter-reasoning-details");

    const afterRestart = new BrowserWorkspacesConversationsRepository({ storage, now: () => timestamp });
    const bindings = await afterRestart.listChatMessageProviderStates(thread.id);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.ownerId).toBe(assistant.id);
    expect(bindings[0]?.state).toEqual(openRouterState());
  });

  it("rolls Browser Conversation message/state/thread writes back together if provider-state persistence fails", async () => {
    class FailingStorage extends MemoryStorage {
      failProviderState = false;
      override setItem(key: string, value: string) {
        if (this.failProviderState && key === BROWSER_CHAT_MESSAGE_PROVIDER_STATE_KEY) throw new Error("quota failure");
        super.setItem(key, value);
      }
    }
    const storage = new FailingStorage();
    const repository = new BrowserWorkspacesConversationsRepository({ storage, now: () => timestamp });
    const thread = await repository.createChatThread("workspace-1", "conversation", "Continuity");
    const threadBefore = storage.getItem("rvh.dev.chat_threads");
    storage.failProviderState = true;

    await expect(repository.appendAssistantMessageWithProviderState(thread.id, "answer", openRouterState())).rejects.toThrow("quota failure");
    expect(storage.getItem("rvh.dev.chat_messages")).toBeNull();
    expect(storage.getItem(BROWSER_CHAT_MESSAGE_PROVIDER_STATE_KEY)).toBeNull();
    expect(storage.getItem("rvh.dev.chat_threads")).toBe(threadBefore);
  });

  it("persists Browser Session assistant event and provider state atomically without placing payload in event metadata", async () => {
    const storage = new MemoryStorage();
    const repository = new BrowserSessionsRepository({ storage, now: () => timestamp, isResearchScoresFrozen: () => true });
    const state = openRouterState();
    const event = await repository.appendSessionEventWithProviderState("session-1", { eventType: "VIEWER_RESPONSE", role: "assistant", content: "answer", metadata: { safe: true } }, state);
    const binding = await repository.getSessionEventProviderState(event.id);
    expect(binding?.state).toEqual(state);
    expect(storage.getItem("rvh.dev.session_events")).not.toContain("reasoningDetails");
    expect(storage.getItem("rvh.dev.session_event_provider_state")).toContain("reasoningDetails");
    await expect(repository.appendSessionEventWithProviderState("session-1", { eventType: "USER", role: "user", content: "no" }, state))
      .rejects.toThrow(/assistant Session event/);
  });

  it("uses registered SECURITY-IPC writes for SQLite Conversation message + state in one transaction", async () => {
    const transactions: Array<Array<{ query: string; values?: unknown[] }>> = [];
    const repository = new SqliteWorkspacesConversationsRepository({
      select: async <T>() => [] as T,
      executeWrite: async () => ({ rowsAffected: 1 }),
      executeTransaction: async (statements) => { transactions.push(statements); return [1, 1, 1]; },
      now: () => timestamp,
    });
    const assistant = await repository.appendAssistantMessageWithProviderState("thread-1", "answer", openRouterState());
    expect(assistant.role).toBe("assistant");
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toHaveLength(3);
    expect(operationForWriteQuery(transactions[0]![0]!.query)).toBe("workspaces_conversations_insert_chat_messages_01");
    expect(operationForWriteQuery(transactions[0]![1]!.query)).toBe("continuation_insert_chat_message_provider_state_01");
    expect(operationForWriteQuery(transactions[0]![2]!.query)).toBe("workspaces_conversations_update_chat_threads_06");
    expect(transactions[0]![1]!.values?.[0]).toBe(assistant.id);
  });

  it("uses a registered SECURITY-IPC delete for durable SQLite Conversation continuation reset", async () => {
    const writes: Array<{ query: string; values?: unknown[] }> = [];
    const repository = new SqliteWorkspacesConversationsRepository({
      select: async <T>() => [] as T,
      executeWrite: async (query, values) => { writes.push({ query, values }); return { rowsAffected: 1 }; },
      executeTransaction: async () => [],
      now: () => timestamp,
    });
    await repository.resetChatMessageProviderStates("thread-1");
    expect(writes).toHaveLength(1);
    expect(operationForWriteQuery(writes[0]!.query)).toBe("continuation_delete_chat_message_provider_state_01");
    expect(writes[0]!.values).toEqual(["thread-1"]);
  });

  it("restores exact SQLite Conversation and Session provider state rows through the shared integrity validator", async () => {
    const state = openRouterState();
    const prepared = await prepareProviderContinuationState(state);
    const conversationRepository = new SqliteWorkspacesConversationsRepository({
      select: async <T>(query: string) => query.includes("FROM chat_message_provider_state") ? [{
        message_id: "assistant-sqlite", format: prepared.format, format_version: prepared.formatVersion, transport: prepared.transport,
        replay_fingerprint_json: prepared.replayFingerprintJson, payload_json: prepared.payloadJson, payload_sha256: prepared.payloadSha256,
        payload_size_bytes: prepared.payloadSizeBytes, created_at: timestamp,
      }] as T : [] as T,
      executeWrite: async () => ({ rowsAffected: 1 }),
      executeTransaction: async () => [],
      now: () => timestamp,
    });
    const conversationBindings = await conversationRepository.listChatMessageProviderStates("thread-sqlite");
    expect(conversationBindings).toHaveLength(1);
    expect(conversationBindings[0]?.ownerId).toBe("assistant-sqlite");
    expect(conversationBindings[0]?.state).toEqual(state);

    const sessionRepository = new SqliteSessionsRepository({
      select: async <T>(query: string) => query.includes("FROM session_event_provider_state") ? [{
        session_event_id: "event-sqlite", format: prepared.format, format_version: prepared.formatVersion, transport: prepared.transport,
        replay_fingerprint_json: prepared.replayFingerprintJson, payload_json: prepared.payloadJson, payload_sha256: prepared.payloadSha256,
        payload_size_bytes: prepared.payloadSizeBytes, created_at: timestamp,
      }] as T : [] as T,
      executeWrite: async () => ({ rowsAffected: 1 }),
      executeTransaction: async () => [],
      isResearchScoresFrozen: async () => true,
      now: () => timestamp,
    });
    const sessionBinding = await sessionRepository.getSessionEventProviderState("event-sqlite");
    expect(sessionBinding?.ownerId).toBe("event-sqlite");
    expect(sessionBinding?.state).toEqual(state);
  });

  it("uses registered SECURITY-IPC writes for SQLite Session event + state in one transaction", async () => {
    const transactions: Array<Array<{ query: string; values?: unknown[] }>> = [];
    let eventId = "";
    const repository = new SqliteSessionsRepository({
      select: async <T>(query: string, values?: unknown[]) => {
        if (query.includes("FROM session_events WHERE id")) {
          eventId = String(values?.[0]);
          return [{ id: eventId, session_id: "session-1", sequence_number: 1, event_type: "VIEWER_RESPONSE", role: "assistant", content: "answer", metadata_json: "{}", created_at: timestamp }] as T;
        }
        return [] as T;
      },
      executeWrite: async () => ({ rowsAffected: 1 }),
      executeTransaction: async (statements) => { transactions.push(statements); return [1, 1]; },
      isResearchScoresFrozen: async () => true,
      now: () => timestamp,
    });
    const event = await repository.appendSessionEventWithProviderState("session-1", { eventType: "VIEWER_RESPONSE", role: "assistant", content: "answer" }, openRouterState());
    expect(event.id).toBe(eventId);
    expect(transactions).toHaveLength(1);
    expect(operationForWriteQuery(transactions[0]![0]!.query)).toBe("sessions_insert_session_events_01");
    expect(operationForWriteQuery(transactions[0]![1]!.query)).toBe("continuation_insert_session_event_provider_state_01");
    expect(transactions[0]![1]!.values?.[0]).toBe(event.id);
  });
});
