import { describe, expect, it } from "vitest";
import { createTelepathicSeriesState } from "./engine";
import { buildTelepathicConversationView } from "./conversationView";
import type { TelepathicSeriesConfig } from "./types";

const baseConfig = (senderPolicy: TelepathicSeriesConfig["senderPolicy"]): TelepathicSeriesConfig => ({
  schemaVersion: 1,
  seriesId: "view-boundary",
  seriesWorkspaceId: "workspace-human",
  mode: "conversation_exchange",
  language: "en",
  participants: [
    { id: "human", kind: "human", displayName: "Human" },
    { id: "ai-a", kind: "ai", displayName: "AI A", ai: { profileId: "p-a", profileName: "AI A", workspaceId: "w-a", aiIdentityId: "i-a", providerConfigId: "pc-a", credentialId: "c-a", credentialFingerprint: "fp-a", modelId: "m-a", route: "r-a" } },
    { id: "ai-b", kind: "ai", displayName: "AI B", ai: { profileId: "p-b", profileName: "AI B", workspaceId: "w-b", aiIdentityId: "i-b", providerConfigId: "pc-b", credentialId: "c-b", credentialFingerprint: "fp-b", modelId: "m-b", route: "r-b" } },
  ],
  roundCount: 1,
  topic: "location",
  discloseTopicToReceivers: false,
  senderPolicy,
});

function seedHiddenData(state: ReturnType<typeof createTelepathicSeriesState>) {
  const round = state.rounds[0];
  round.status = "blind";
  round.target = {
    schemaVersion: 1,
    roundId: round.assignment.roundId,
    senderParticipantId: round.assignment.senderParticipantId,
    content: "SECRET TARGET TEXT",
    assets: [{ artifactId: "a1", kind: "image", originalFileName: "secret-target.png", mimeType: "image/png", size: 12, sha256: "asset-hash", path: "/private/secret-target.png" }],
    contentSha256: "target-hash",
    lockedAt: "2026-10-07T01:00:00.000Z",
    transmissionReadyAt: "2026-10-07T01:01:00.000Z",
    status: "transmission_ready",
  };
  for (const receiverId of round.assignment.receiverParticipantIds) {
    round.blindByParticipant[receiverId] = { participantId: receiverId, status: "first_complete", first: `PRIVATE BLIND ${receiverId}`, providerAttemptCount: 1 };
  }
  state.providerCalls.push({ id: "call-secret", seriesId: state.config.seriesId, roundId: round.assignment.roundId, participantId: "ai-a", callStage: "receiver_first", technicalAttempt: 1, status: "succeeded", scopeKey: "scope-secret", requestSha256: "request-secret", responseText: "provider-private-text", createdAt: state.createdAt, updatedAt: state.updatedAt });
}

describe("Conversation telepathic UI data boundary", () => {
  it("does not expose target, filenames, provider ledger or another receiver's blind before Reveal", () => {
    const state = createTelepathicSeriesState(baseConfig({ kind: "fixed_ai", participantId: "ai-a" }), "2026-10-07T00:00:00.000Z");
    seedHiddenData(state);
    const view = buildTelepathicConversationView(state);
    const serialized = JSON.stringify(view);

    expect(view.rounds[0].target).toBeUndefined();
    expect(serialized).not.toContain("SECRET TARGET TEXT");
    expect(serialized).not.toContain("secret-target.png");
    expect(serialized).not.toContain("provider-private-text");
    expect(serialized).not.toContain("request-secret");
    expect(serialized).not.toContain("PRIVATE BLIND ai-b");
    expect(view.rounds[0].blindByParticipant["ai-b"].status).toBe("first_complete");
    expect(view.config.participants.find((item) => item.id === "ai-a")).toEqual({ id: "ai-a", kind: "ai", displayName: "AI A" });
  });

  it("lets the human sender see the locked target but never exposes its private artifact path", () => {
    const state = createTelepathicSeriesState(baseConfig({ kind: "human_only", humanParticipantId: "human" }), "2026-10-07T00:00:00.000Z");
    seedHiddenData(state);
    const view = buildTelepathicConversationView(state);
    expect(view.rounds[0].target?.content).toBe("SECRET TARGET TEXT");
    expect(JSON.stringify(view)).toContain("secret-target.png");
    expect(JSON.stringify(view)).not.toContain("/private/secret-target.png");
  });

  it("exposes completed round feedback after Reveal without exposing provider payload records", () => {
    const state = createTelepathicSeriesState(baseConfig({ kind: "fixed_ai", participantId: "ai-a" }), "2026-10-07T00:00:00.000Z");
    seedHiddenData(state);
    state.rounds[0].revealedAt = "2026-10-07T02:00:00.000Z";
    state.rounds[0].reflectionsByParticipant["ai-b"] = { participantId: "ai-b", role: "receiver", reflection: "POST REVEAL REVIEW" };
    const view = buildTelepathicConversationView(state);
    expect(view.rounds[0].target?.content).toBe("SECRET TARGET TEXT");
    expect(view.rounds[0].blindByParticipant["ai-b"].first).toBe("PRIVATE BLIND ai-b");
    expect(view.rounds[0].reflectionsByParticipant["ai-b"].reflection).toBe("POST REVEAL REVIEW");
    expect(JSON.stringify(view)).not.toContain("provider-private-text");
  });
});
