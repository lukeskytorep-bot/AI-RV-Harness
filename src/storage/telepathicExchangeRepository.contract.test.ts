import { describe, expect, it, vi } from "vitest";
import { createTelepathicSeriesState, telepathicConversationHumanStep } from "../telepathicExchange/engine";
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
    expect((await repository.listTelepathicSeries("workspace-a")).map((item) => item.config.seriesId)).toEqual([config.seriesId]);
    expect(await repository.listTelepathicSeries("workspace-other")).toEqual([]);
    expect(JSON.stringify(loaded)).not.toContain("chat_messages");
  });

  it("writes one normalized SQLite checkpoint transaction for series, participants, rounds and blind slots", async () => {
    const statements: Array<{ query: string; values?: unknown[] }> = [];
    const repository = new SqliteTelepathicExchangeRepository({
      select: async <T,>(query: string): Promise<T> => {
        if (query.startsWith("SELECT round_id, content_sha256 FROM telepathic_targets")) return [] as T;
        throw new Error(`unexpected select: ${query}`);
      },
      executeWrite: async () => ({ rowsAffected: 1 }),
      executeTransaction: async (items: DatabaseTransactionStatement[]) => { statements.push(...items); return []; },
      executeFencedTransaction: async ({ statements: items }) => { statements.push(...items); return []; },
    });
    await repository.saveTelepathicSeries(createTelepathicSeriesState(config, "2026-10-06T21:00:00.000Z"));
    const sql = statements.map((item) => item.query).join("\n");
    expect(sql).toContain("INSERT INTO telepathic_series");
    expect(sql).toContain("INSERT INTO telepathic_participants");
    expect(sql).toContain("INSERT INTO telepathic_rounds");
    expect(sql).toContain("INSERT INTO telepathic_blind_submissions");
    expect(sql).not.toContain("chat_messages");
  });

  it("uses an atomic SQLite lease across separate repository instances", async () => {
    let leaseOwner: string | null = null;
    let leaseVersion = 0;
    let leaseExpiresAt: string | null = null;
    const executeWrite = async (query: string, values: unknown[] = []) => {
      if (query.startsWith("UPDATE telepathic_series SET run_lease_owner=NULL")) {
        if (leaseOwner === String(values[1]) && leaseVersion === Number(values[2])) { leaseOwner = null; leaseExpiresAt = null; return { rowsAffected: 1 }; }
        return { rowsAffected: 0 };
      }
      if (query.startsWith("UPDATE telepathic_series SET run_lease_owner=")) {
        if (leaseOwner !== null) return { rowsAffected: 0 };
        leaseOwner = String(values[0]); leaseExpiresAt = String(values[1]); leaseVersion += 1;
        return { rowsAffected: 1 };
      }
      if (query.startsWith("UPDATE telepathic_series SET run_lease_expires_at=")) {
        if (leaseOwner === String(values[2]) && leaseVersion === Number(values[3])) { leaseExpiresAt = String(values[0]); return { rowsAffected: 1 }; }
        return { rowsAffected: 0 };
      }
      throw new Error(`unexpected write: ${query}`);
    };
    const deps = {
      select: async <T,>(query: string): Promise<T> => query.includes("run_lease_owner") ? [{ run_lease_owner: leaseOwner, run_lease_version: leaseVersion, run_lease_expires_at: leaseExpiresAt }] as T : [] as T,
      executeWrite,
      executeTransaction: async () => [],
      executeFencedTransaction: async () => [],
    };
    const first = new SqliteTelepathicExchangeRepository(deps);
    const second = new SqliteTelepathicExchangeRepository(deps);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });

    const firstRun = first.withTelepathicSeriesLease(config.seriesId, async () => { entered(); await gate; return "first"; });
    await started;
    await expect(second.withTelepathicSeriesLease(config.seriesId, async () => "second")).rejects.toThrow(/another application instance/);
    release();
    await expect(firstRun).resolves.toBe("first");
    await expect(second.withTelepathicSeriesLease(config.seriesId, async () => "second")).resolves.toBe("second");
  });

  it("marks the lease lost when a heartbeat renewal is rejected", async () => {
    vi.useFakeTimers();
    try {
      let owner: string | null = null;
      let version = 0;
      let expiry: string | null = null;
      const repository = new SqliteTelepathicExchangeRepository({
        select: async <T,>(query: string): Promise<T> => query.includes("run_lease_owner") ? [{ run_lease_owner: owner, run_lease_version: version, run_lease_expires_at: expiry }] as T : [] as T,
        executeWrite: async (query: string, values: unknown[] = []) => {
          if (query.startsWith("UPDATE telepathic_series SET run_lease_owner=NULL")) return { rowsAffected: 1 };
          if (query.startsWith("UPDATE telepathic_series SET run_lease_owner=")) { owner = String(values[0]); expiry = String(values[1]); version += 1; return { rowsAffected: 1 }; }
          if (query.startsWith("UPDATE telepathic_series SET run_lease_expires_at=")) return { rowsAffected: 0 };
          throw new Error(`unexpected write: ${query}`);
        },
        executeTransaction: async () => [],
        executeFencedTransaction: async () => [],
      });

      const run = repository.withTelepathicSeriesLease(config.seriesId, async () => {
        await vi.advanceTimersByTimeAsync(30_000);
        expect(repository.telepathicSeriesLeaseSignal(config.seriesId)?.aborted).toBe(true);
        return "done";
      });
      await expect(run).rejects.toThrow(/lease was lost/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("allows another repository instance to take over an expired lease", async () => {
    let leaseOwner: string | null = "stale-owner";
    let leaseVersion = 4;
    let leaseExpiresAt: string | null = "2000-01-01T00:00:00.000Z";
    const deps = {
      select: async <T,>(query: string): Promise<T> => query.includes("run_lease_owner") ? [{ run_lease_owner: leaseOwner, run_lease_version: leaseVersion, run_lease_expires_at: leaseExpiresAt }] as T : [] as T,
      executeWrite: async (query: string, values: unknown[] = []) => {
        if (query.startsWith("UPDATE telepathic_series SET run_lease_owner=NULL")) { leaseOwner = null; leaseExpiresAt = null; return { rowsAffected: 1 }; }
        if (query.startsWith("UPDATE telepathic_series SET run_lease_owner=")) {
          const now = String(values[3]);
          if (leaseOwner !== null && leaseExpiresAt !== null && leaseExpiresAt >= now) return { rowsAffected: 0 };
          leaseOwner = String(values[0]); leaseExpiresAt = String(values[1]); leaseVersion += 1; return { rowsAffected: 1 };
        }
        if (query.startsWith("UPDATE telepathic_series SET run_lease_expires_at=")) return { rowsAffected: 1 };
        throw new Error(`unexpected write: ${query}`);
      },
      executeTransaction: async () => [],
      executeFencedTransaction: async () => [],
    };
    const repository = new SqliteTelepathicExchangeRepository(deps);
    await expect(repository.withTelepathicSeriesLease(config.seriesId, async () => "taken-over")).resolves.toBe("taken-over");
    expect(leaseVersion).toBe(5);
  });

  it("rejects a late checkpoint after another owner has taken over the lease", async () => {
    let leaseOwner: string | null = null;
    let leaseVersion = 0;
    let leaseExpiresAt: string | null = null;
    const state = createTelepathicSeriesState(config, "2026-10-07T21:00:00.000Z");
    const deps = {
      select: async <T,>(query: string): Promise<T> => {
        if (query.includes("content_sha256 FROM telepathic_targets")) return [] as T;
        if (query.includes("run_lease_owner")) return [{ run_lease_owner: leaseOwner, run_lease_version: leaseVersion, run_lease_expires_at: leaseExpiresAt }] as T;
        return [] as T;
      },
      executeWrite: async (query: string, values: unknown[] = []) => {
        if (query.startsWith("UPDATE telepathic_series SET run_lease_owner=NULL")) return { rowsAffected: 0 };
        if (query.startsWith("UPDATE telepathic_series SET run_lease_owner=")) { leaseOwner = String(values[0]); leaseExpiresAt = String(values[1]); leaseVersion += 1; return { rowsAffected: 1 }; }
        if (query.startsWith("UPDATE telepathic_series SET run_lease_expires_at=")) return { rowsAffected: leaseOwner === String(values[2]) && leaseVersion === Number(values[3]) ? 1 : 0 };
        throw new Error(`unexpected write: ${query}`);
      },
      executeTransaction: async () => [],
      executeFencedTransaction: async ({ leaseOwner: expectedOwner, leaseVersion: expectedVersion }: { seriesId: string; leaseOwner: string; leaseVersion: number; statements: DatabaseTransactionStatement[] }) => {
        if (leaseOwner !== expectedOwner || leaseVersion !== expectedVersion) throw new Error("Telepathic fenced write rejected because the series lease was lost.");
        return [];
      },
    };
    const repository = new SqliteTelepathicExchangeRepository(deps);
    const run = repository.withTelepathicSeriesLease(config.seriesId, async () => {
      leaseOwner = "new-owner";
      leaseVersion += 1;
      await repository.saveTelepathicSeries(state);
      return "unexpected";
    });
    await expect(run).rejects.toThrow(/lease was lost|fenced write rejected/);
  });

  it("preserves an explicitly completed empty human reflection when reading SQLite state", async () => {
    const state = createTelepathicSeriesState(config, "2026-10-07T21:00:00.000Z");
    const round = state.rounds[0];
    round.status = "reflections";
    round.revealedAt = "2026-10-07T21:05:00.000Z";
    state.status = "paused";
    const seriesRow = { id: config.seriesId, status: state.status, current_round_index: 0, config_json: JSON.stringify(config), plan_json: JSON.stringify(state.plan), created_at: state.createdAt, updated_at: state.updatedAt };
    const participantRows = config.participants.map((item) => ({ participant_id: item.id, kind: item.kind, display_name: item.displayName, route_snapshot_json: item.ai ? JSON.stringify(item.ai) : null, field_guide_snapshot_json: null, viewer_notes_snapshot_json: null, final_reflection_text: null }));
    const repository = new SqliteTelepathicExchangeRepository({
      select: async <T,>(query: string): Promise<T> => {
        if (query.startsWith("SELECT id, status, current_round_index")) return [seriesRow] as T;
        if (query.startsWith("SELECT participant_id")) return participantRows as T;
        if (query.startsWith("SELECT id, round_number")) return [{ id: round.assignment.roundId, round_number: 1, sender_participant_id: round.assignment.senderParticipantId, status: "reflections", revealed_at: round.revealedAt, completed_at: null, blocked_reason: null }] as T;
        if (query.startsWith("SELECT t.round_id")) return [{
          round_id: round.assignment.roundId,
          sender_participant_id: "human",
          content: "Locked human target",
          assets_manifest_json: "[]",
          content_sha256: "target-hash",
          status: "transmission_ready",
          locked_at: "2026-10-07T21:01:00.000Z",
          transmission_ready_at: "2026-10-07T21:02:00.000Z",
        }] as T;
        if (query.startsWith("SELECT b.round_id")) return [] as T;
        if (query.startsWith("SELECT f.round_id")) return [{ round_id: round.assignment.roundId, participant_id: "human", role: "sender", reflection_text: "", share_others_consent: null, shared_answers_comment: null }] as T;
        if (query.startsWith("SELECT id, round_id, participant_id")) return [] as T;
        throw new Error(`unexpected select: ${query}`);
      },
      executeWrite: async () => ({ rowsAffected: 1 }),
      executeTransaction: async () => [],
      executeFencedTransaction: async () => [],
    });
    const loaded = await repository.getTelepathicSeries(config.seriesId);
    expect(loaded?.rounds[0].reflectionsByParticipant.human).toHaveProperty("reflection", "");
    expect(loaded && telepathicConversationHumanStep(loaded)).toEqual({ kind: "none" });
  });

  it("refuses to renew a telepathic series lease after its stored expiry has passed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-07T22:00:00.000Z"));
    try {
      let owner: string | null = null;
      let version = 0;
      let expiry: string | null = null;
      const repository = new SqliteTelepathicExchangeRepository({
        select: async <T,>(query: string): Promise<T> => query.includes("run_lease_owner") ? [{ run_lease_owner: owner, run_lease_version: version, run_lease_expires_at: expiry }] as T : [] as T,
        executeWrite: async (query: string, values: unknown[] = []) => {
          if (query.startsWith("UPDATE telepathic_series SET run_lease_owner=NULL")) return { rowsAffected: 1 };
          if (query.startsWith("UPDATE telepathic_series SET run_lease_owner=")) { owner = String(values[0]); expiry = String(values[1]); version += 1; return { rowsAffected: 1 }; }
          if (query.startsWith("UPDATE telepathic_series SET run_lease_expires_at=")) {
            const stillValid = expiry !== null && expiry > new Date().toISOString();
            return { rowsAffected: owner === String(values[2]) && version === Number(values[3]) && stillValid ? 1 : 0 };
          }
          throw new Error(`unexpected write: ${query}`);
        },
        executeTransaction: async () => [],
        executeFencedTransaction: async () => [],
      });
      const run = repository.withTelepathicSeriesLease(config.seriesId, async () => {
        expiry = "2026-10-07T21:59:59.000Z";
        await vi.advanceTimersByTimeAsync(30_000);
        expect(repository.telepathicSeriesLeaseSignal(config.seriesId)?.aborted).toBe(true);
        return "unexpected";
      });
      await expect(run).rejects.toThrow(/lease was lost/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("persists exact frozen telepathic-training learning content inside participant snapshots", async () => {
    const repository = new BrowserTelepathicExchangeRepository({ storage: new MemoryStorage() });
    const trainingConfig: TelepathicSeriesConfig = {
      ...structuredClone(config),
      seriesId: "series-training-learning-storage",
      mode: "ai_ai_training",
      participants: [
        {
          ...structuredClone(config.participants[1]),
          id: "ai-one",
          fieldGuide: { id: "fg-7", version: "7", versionNumber: 7, content: "FROZEN FIELD GUIDE TEXT", contentSha256: "fg-sha", capturedAt: "2026-10-07T12:00:00.000Z", modelRoute: "custom_openai:model-ai" },
          viewerNotes: { id: "vn-3", version: "3", versionNumber: 3, content: "FROZEN VIEWER NOTES TEXT", contentSha256: "vn-sha", capturedAt: "2026-10-07T12:00:00.000Z", modelRoute: "custom_openai:model-ai" },
        },
        {
          ...structuredClone(config.participants[1]),
          id: "ai-two",
          ai: { ...structuredClone(config.participants[1].ai!), aiIdentityId: "identity-ai-two", profileId: "profile-ai-two", workspaceId: "workspace-ai-two" },
        },
      ],
      senderPolicy: { kind: "rotate" },
    };
    const state = createTelepathicSeriesState(trainingConfig, "2026-10-07T12:00:00.000Z");
    await repository.saveTelepathicSeries(state);
    const loaded = await repository.getTelepathicSeries(trainingConfig.seriesId);
    expect(loaded?.config.participants[0].fieldGuide?.content).toBe("FROZEN FIELD GUIDE TEXT");
    expect(loaded?.config.participants[0].viewerNotes?.content).toBe("FROZEN VIEWER NOTES TEXT");
  });

});
