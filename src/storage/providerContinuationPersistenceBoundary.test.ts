import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (relative: string) => fs.readFileSync(path.resolve(process.cwd(), relative), "utf8");

describe("OPENROUTER-CONTINUITY-PERSISTENCE-1 boundary", () => {
  it("owns continuation payloads in dedicated schema 025 tables, never session metadata", () => {
    const migration = read("src-tauri/migrations/025_provider_continuation_state.sql");
    expect(migration).toContain("CREATE TABLE chat_message_provider_state");
    expect(migration).toContain("CREATE TABLE session_event_provider_state");
    expect(migration).toContain("REFERENCES chat_messages(id) ON DELETE CASCADE");
    expect(migration).toContain("REFERENCES session_events(id) ON DELETE CASCADE");
    expect(migration).not.toContain("metadata_json");
  });

  it("validates before persistence and verifies hash, byte size and payload again on restore", () => {
    const persistence = read("src/storage/providerContinuationState.ts");
    expect(persistence).toContain("validateProviderContinuationState(state)");
    expect(persistence).toContain("sha256Text(payloadJson)");
    expect(persistence).toContain("rawSize !== row.payloadSizeBytes");
    expect(persistence).toContain("row.payloadSha256.toLowerCase() !== (await sha256Text(row.payloadJson)).toLowerCase()");
    expect(persistence).toContain("validateProviderContinuationState(payload)");
  });

  it("uses named SECURITY-IPC writes rather than widening raw SQL", () => {
    const frontend = read("src/storage/databaseWriteOperations.ts");
    const rust = read("src-tauri/src/database.rs");
    for (const operation of [
      "continuation_insert_chat_message_provider_state_01",
      "continuation_delete_chat_message_provider_state_01",
      "continuation_insert_session_event_provider_state_01",
    ]) {
      expect(frontend).toContain(operation);
      expect(rust).toContain(operation);
    }
    expect(frontend).toContain("INSERT INTO chat_message_provider_state");
    expect(frontend).toContain("DELETE FROM chat_message_provider_state WHERE message_id IN (SELECT id FROM chat_messages WHERE thread_id = $1)");
    expect(frontend).toContain("INSERT INTO session_event_provider_state");
  });

  it("keeps Conversation assistant message + state and Session event + state atomic", () => {
    const conversation = read("src/storage/sqlite/workspacesConversationsRepository.ts");
    const sessions = read("src/storage/sqlite/sessionsRepository.ts");
    expect(conversation).toContain("appendAssistantMessageWithProviderState");
    expect(conversation).toContain("executeTransaction([");
    expect(sessions).toContain("appendSessionEventWithProviderState");
    expect(sessions).toContain("executeTransaction([");
  });

  it("keeps ordinary export surfaces and visible semantic message types free of continuation payloads", () => {
    const exports = [
      read("src/exports/research.ts"),
      read("src/exports/session.ts"),
      read("src/exports/training.ts"),
    ];
    for (const source of exports) {
      expect(source).not.toContain("providerContinuationState");
      expect(source).not.toContain("chat_message_provider_state");
      expect(source).not.toContain("session_event_provider_state");
    }
    const types = read("src/types.ts");
    expect(types).not.toContain("reasoningDetails");
  });

  it("makes Conversation text-only fallback a durable provider-state reset without weakening validation", () => {
    const engine = read("src/chat/engine.ts");
    const browser = read("src/storage/browser/workspacesConversationsRepository.ts");
    const sqlite = read("src/storage/sqlite/workspacesConversationsRepository.ts");
    expect(engine).toContain("resetChatMessageProviderStates");
    expect(browser).toContain("browserChatMessageProviderStateResetKey");
    expect(browser).toContain("browserChatMessageProviderStateFreshKey");
    expect(sqlite).toContain("DELETE FROM chat_message_provider_state WHERE message_id IN (SELECT id FROM chat_messages WHERE thread_id = $1)");
    expect(engine).toContain("ProviderContinuationPersistenceError");
  });

  it("keeps C3 workflow rollout absent", () => {
    for (const relative of [
      "src/sessions/controller.ts",
      "src/sessions/rvLiteController.ts",
      "src/training/execution.ts",
      "src/research/engine.ts",
      "src/sessions/postReveal.ts",
    ]) {
      const source = read(relative);
      expect(source, relative).not.toContain("appendSessionEventWithProviderState");
      expect(source, relative).not.toContain("getSessionEventProviderState");
    }
  });
});
