import { describe, expect, it } from "vitest";
import { createTelepathicSeriesState } from "../telepathicExchange/engine";
import type { TelepathicSeriesConfig } from "../telepathicExchange/types";
import { BrowserTelepathicExchangeRepository } from "./browser/telepathicExchangeRepository";
import { SqliteTelepathicExchangeRepository } from "./sqlite/telepathicExchangeRepository";
import type { DatabaseTransactionStatement } from "./databaseNative";

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();
  get length(): number { return this.data.size; }
  clear(): void { this.data.clear(); }
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string): void { this.data.delete(key); }
  setItem(key: string, value: string): void { this.data.set(key, value); }
}

const config: TelepathicSeriesConfig = {
  schemaVersion: 1,
  seriesId: "series-storage",
  seriesWorkspaceId: "workspace-a",
  mode: "conversation_exchange",
  language: "en",
  participants: [
    { id: "human", kind: "human", displayName: "Human" },
    {
      id: "ai",
      kind: "ai",
      displayName: "AI",
      ai: {
        profileId: "profile-ai",
        profileName: "AI",
        workspaceId: "workspace-ai",
        aiIdentityId: "identity-ai",
        providerConfigId: "provider-ai",
        credentialId: "credential-ai",
        credentialFingerprint: "fingerprint-ai",
        modelId: "model-ai",
        route: "custom_openai:model-ai",
      },
    },
  ],
  roundCount: 1,
  topic: "any",
  discloseTopicToReceivers: false,
  senderPolicy: { kind: "human_only", humanParticipantId: "human" },
};

describe("telepathic exchange persistence contract", () => {
  it("round-trips the durable browser checkpoint without Conversation history", async () => {
    const repository = new BrowserTelepathicExchangeRepository({ storage: new MemoryStorage() });
    const state = createTelepathicSeriesState(config, "2026-10-06T21:00:00.000Z");
    await repository.saveTelepathicSeries(state);
    const loaded = await repository.getTelepathicSeries(config.seriesId);
    expect(loaded).toEqual(state);
    expect(JSON.stringify(loaded)).not.toContain("chat_messages");
  });

  it("writes one normalized SQLite checkpoint transaction for series, participants, rounds and blind slots", async () => {
    const statements: Array<{ query: string; values?: unknown[] }> = [];
    const repository = new SqliteTelepathicExchangeRepository({
      select: async <T,>(query: string): Promise<T> => {
        if (query.startsWith("SELECT round_id, content_sha256 FROM telepathic_targets")) return [] as T;
        throw new Error(`unexpected select: ${query}`);
      },
      executeTransaction: async (items: DatabaseTransactionStatement[]) => { statements.push(...items); return []; },
    });
    await repository.saveTelepathicSeries(createTelepathicSeriesState(config, "2026-10-06T21:00:00.000Z"));
    const sql = statements.map((item) => item.query).join("\n");
    expect(sql).toContain("INSERT INTO telepathic_series");
    expect(sql).toContain("INSERT INTO telepathic_participants");
    expect(sql).toContain("INSERT INTO telepathic_rounds");
    expect(sql).toContain("INSERT INTO telepathic_blind_submissions");
    expect(sql).not.toContain("chat_messages");
  });
});
