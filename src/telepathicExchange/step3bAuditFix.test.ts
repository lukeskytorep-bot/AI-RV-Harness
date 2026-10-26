import { describe, expect, it } from "vitest";

import {
  allowRetryForUncertainTelepathicCall,
  createTelepathicSeriesState,
  resumeBlockedTelepathicSeries,
  unresolvedTelepathicProviderCalls,
} from "./engine";
import { InMemoryTelepathicExchangeStore } from "./store";
import type { TelepathicSeriesConfig } from "./types";

const config: TelepathicSeriesConfig = {
  schemaVersion: 1,
  seriesId: "series-audit-fix",
  seriesWorkspaceId: "workspace-a",
  mode: "conversation_exchange",
  language: "en",
  participants: [
    { id: "human", kind: "human", displayName: "Human" },
    { id: "ai", kind: "ai", displayName: "AI", ai: { profileId: "p", profileName: "AI", workspaceId: "w", aiIdentityId: "i", providerConfigId: "pc", credentialId: "c", credentialFingerprint: "fp", modelId: "m", route: "r" } },
  ],
  roundCount: 1,
  topic: "any",
  discloseTopicToReceivers: false,
  senderPolicy: { kind: "human_only", humanParticipantId: "human" },
};

const deps = (store: InMemoryTelepathicExchangeStore) => ({
  store,
  resolveRoute: async () => { throw new Error("route should not be resolved by operator recovery tests"); },
});

describe("STEP 3B audit fixes", () => {
  it("resumes an ordinary blocked series from its durable stage without an uncertain provider call", async () => {
    const store = new InMemoryTelepathicExchangeStore();
    const state = createTelepathicSeriesState(config, "2026-10-07T00:00:00.000Z");
    state.status = "blocked";
    state.rounds[0].status = "blind";
    state.rounds[0].blockedReason = "temporary route lookup failure";
    await store.saveTelepathicSeries(state);

    const recovered = await resumeBlockedTelepathicSeries(deps(store), config.seriesId);
    expect(recovered.status).toBe("paused");
    expect(recovered.rounds[0].status).toBe("blind");
    expect(recovered.rounds[0].blockedReason).toBeUndefined();
  });

  it("requires an explicit operator decision for an uncertain dispatched provider result", async () => {
    const store = new InMemoryTelepathicExchangeStore();
    const state = createTelepathicSeriesState(config, "2026-10-07T00:00:00.000Z");
    state.status = "blocked";
    state.rounds[0].status = "blind";
    state.rounds[0].blockedReason = "uncertain delivery";
    state.providerCalls.push({ id: "call-1", seriesId: config.seriesId, roundId: state.rounds[0].assignment.roundId, participantId: "ai", callStage: "receiver_first", technicalAttempt: 1, status: "uncertain", scopeKey: "scope", requestSha256: "hash", createdAt: state.createdAt, updatedAt: state.updatedAt });
    await store.saveTelepathicSeries(state);

    await expect(resumeBlockedTelepathicSeries(deps(store), config.seriesId)).rejects.toThrow(/explicit operator decision/);
    expect(unresolvedTelepathicProviderCalls(state)).toHaveLength(1);

    const resolved = await allowRetryForUncertainTelepathicCall(deps(store), config.seriesId, "call-1");
    expect(resolved.status).toBe("paused");
    expect(resolved.providerCalls[0].status).toBe("failed");
    expect(resolved.providerCalls[0].errorMessage).toMatch(/explicitly allowed/);
  });
});

describe("STEP 3B final-reflection recovery", () => {
  it("keeps completed rounds complete when an uncertain final reflection is explicitly released for retry", async () => {
    const store = new InMemoryTelepathicExchangeStore();
    const state = createTelepathicSeriesState(config, "2026-10-07T00:00:00.000Z");
    state.status = "completed";
    state.currentRoundIndex = state.rounds.length;
    state.rounds[0].status = "completed";
    state.rounds[0].completedAt = "2026-10-07T00:10:00.000Z";
    state.providerCalls.push({ id: "final-call-1", seriesId: config.seriesId, roundId: "series-complete", participantId: "ai", callStage: "series_reflection", technicalAttempt: 1, status: "uncertain", scopeKey: "final-scope", requestSha256: "hash", createdAt: state.createdAt, updatedAt: state.updatedAt });
    await store.saveTelepathicSeries(state);

    const resolved = await allowRetryForUncertainTelepathicCall(deps(store), config.seriesId, "final-call-1");
    expect(resolved.status).toBe("completed");
    expect(resolved.rounds[0].status).toBe("completed");
    expect(resolved.rounds[0].completedAt).toBe("2026-10-07T00:10:00.000Z");
    expect(resolved.providerCalls[0].status).toBe("failed");
  });
});
