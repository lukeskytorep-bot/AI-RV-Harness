import { describe, expect, it } from "vitest";
import type { ProviderContinuationState } from "../providers/continuationContract";
import type { ProviderModel } from "../providers/types";
import {
  buildFinalSeriesPacket,
  buildReceiverFirstPacket,
  buildReceiverRevealPacket,
  buildReceiverSecondPacket,
  buildSenderRevealPacket,
  buildSharedAnswersPacket,
  composeTelepathicProviderMessages,
} from "./packets";
import { planTelepathicSeries } from "./planner";
import { preflightTelepathicMessages } from "./preflight";
import { lockTelepathicTarget, markTelepathicTargetTransmissionReady } from "./target";
import {
  MAX_TECHNICAL_SUBMISSION_ATTEMPTS,
  createBlindSubmission,
  recordFirstBlindResponse,
  recordSecondBlindResponse,
  recordTechnicalAttempt,
} from "./blind";
import { type TelepathicParticipant, type TelepathicSeriesConfig } from "./types";

const ai = (id: string): TelepathicParticipant => ({
  id,
  kind: "ai",
  displayName: id.toUpperCase(),
  ai: {
    profileId: `profile-${id}`,
    profileName: id.toUpperCase(),
    workspaceId: `workspace-${id}`,
    aiIdentityId: `identity-${id}`,
    providerConfigId: `provider-${id}`,
    credentialId: `credential-${id}`,
    credentialFingerprint: `fingerprint-${id}`,
    modelId: `model-${id}`,
    route: `openrouter:model-${id}`,
  },
});

const baseConfig = (overrides: Partial<TelepathicSeriesConfig> = {}): TelepathicSeriesConfig => ({
  schemaVersion: 1,
  seriesId: "series-1",
  seriesWorkspaceId: "workspace-leo",
  mode: "ai_ai_training",
  language: "en",
  participants: [ai("leo"), ai("nemo"), ai("aura")],
  roundCount: 5,
  topic: "any",
  discloseTopicToReceivers: false,
  senderPolicy: { kind: "rotate" },
  ...overrides,
});

const model = (supportsVision = false): ProviderModel => ({
  providerConfigId: "provider-leo",
  provider: "openrouter",
  modelId: "model-leo",
  displayName: "Leo Model",
  route: "openrouter:model-leo",
  capabilities: {
    contextTokens: 100_000,
    maxOutputTokens: 4096,
    inputModalities: supportsVision ? ["text", "image"] : ["text"],
    outputModalities: ["text"],
    supportsVision,
    supportsStreaming: true,
    reasoning: { supported: false, efforts: [], confidence: "unknown" },
    temperature: { supported: true, min: 0, max: 2, confidence: "provider_metadata" },
    supportedParameters: ["temperature"],
    source: "provider",
    capturedAt: "now",
  },
  pricing: { promptPerToken: 0.000001, completionPerToken: 0.000002, currency: "USD" },
  recommended: true,
  rawMetadata: {},
  refreshedAt: "now",
});

const continuation: ProviderContinuationState = {
  schemaVersion: 1,
  transport: "openrouter",
  format: "openrouter-reasoning-details",
  replayFingerprint: {
    transport: "openrouter",
    normalizedEndpoint: "https://openrouter.ai/api/v1",
    providerConfigId: "provider-leo",
    credentialId: "credential-leo",
    requestedModelId: "model-leo",
    stateFormat: "openrouter-reasoning-details",
    stateFormatVersion: 1,
  },
  reasoningDetails: [{ type: "reasoning.text", text: "same-round-state" }],
};

describe("TELEPATHIC-EXCHANGE-1 contracts", () => {
  it("plans a stable rotating schedule and never assigns the sender as a receiver", () => {
    const plan = planTelepathicSeries(baseConfig());
    expect(plan.rounds.map((round) => round.senderParticipantId)).toEqual(["leo", "nemo", "aura", "leo", "nemo"]);
    for (const round of plan.rounds) {
      expect(round.receiverParticipantIds).not.toContain(round.senderParticipantId);
      expect(round.receiverParticipantIds).toHaveLength(2);
    }
  });

  it("validates AI-AI training as 2-6 AI Profiles only", () => {
    expect(() => planTelepathicSeries(baseConfig({ participants: [ai("leo")] }))).toThrow(/2 to 6/);
    const seven = Array.from({ length: 7 }, (_, index) => ai(`p${index}`));
    expect(() => planTelepathicSeries(baseConfig({ participants: seven }))).toThrow(/2 to 6/);
    expect(() => planTelepathicSeries(baseConfig({ participants: [ai("leo"), { id: "human", kind: "human", displayName: "Ed" }] }))).toThrow(/cannot include a human/);
    const duplicateProfileA = ai("leo-a");
    const duplicateProfileB = ai("leo-b");
    duplicateProfileB.ai = { ...duplicateProfileB.ai!, profileId: duplicateProfileA.ai!.profileId };
    expect(() => planTelepathicSeries(baseConfig({ participants: [duplicateProfileA, duplicateProfileB] }))).toThrow(/distinct AI Profiles/);
  });

  it("locks one immutable target snapshot before blind and preserves its hash when transmission becomes ready", async () => {
    const locked = await lockTelepathicTarget("r1", "leo", {
      content: "SECRET_TARGET_ALPHA",
      assets: [{ artifactId: "img-1", kind: "image", originalFileName: "secret-castle.png", mimeType: "image/png", size: 123, sha256: "a".repeat(64), shortDescription: "A stone structure" }],
    }, "2026-10-06T10:00:00.000Z");
    expect(locked.status).toBe("locked");
    expect(Object.isFrozen(locked)).toBe(true);
    expect(Object.isFrozen(locked.assets)).toBe(true);
    expect(Object.isFrozen(locked.assets[0])).toBe(true);
    const ready = await markTelepathicTargetTransmissionReady(locked, "2026-10-06T10:01:00.000Z");
    expect(ready.contentSha256).toBe(locked.contentSha256);
    expect(ready.content).toBe("SECRET_TARGET_ALPHA");
    expect(ready.status).toBe("transmission_ready");
  });

  it("refuses Reveal unless the exact locked target is transmission-ready and still matches its hash", async () => {
    const locked = await lockTelepathicTarget("r1", "leo", {
      content: "SECRET_TARGET_ALPHA",
      assets: [{ artifactId: "img-1", kind: "image", originalFileName: "secret-castle.png", mimeType: "image/png", size: 123, sha256: "a".repeat(64), shortDescription: "A stone structure" }],
    }, "2026-10-06T10:00:00.000Z");

    await expect(buildReceiverRevealPacket({
      language: "en",
      seriesId: "series-1",
      roundId: "r1",
      participantId: "nemo",
      name: "Nemo",
      target: locked,
      blind: { participantId: "nemo", status: "sealed", first: "stone", providerAttemptCount: 1 },
      canReadImages: false,
    })).rejects.toThrow(/transmission_ready/);

    const ready = await markTelepathicTargetTransmissionReady(locked, "2026-10-06T10:01:00.000Z");
    const tampered = structuredClone(ready);
    tampered.content = "CHANGED_AFTER_LOCK";

    await expect(buildReceiverRevealPacket({
      language: "en",
      seriesId: "series-1",
      roundId: "r1",
      participantId: "nemo",
      name: "Nemo",
      target: tampered,
      blind: { participantId: "nemo", status: "sealed", first: "stone", providerAttemptCount: 1 },
      canReadImages: false,
    })).rejects.toThrow(/integrity check failed/);

    const wrongRound = structuredClone(ready);
    await expect(buildSenderRevealPacket({
      language: "en",
      seriesId: "series-1",
      roundId: "r2",
      participantId: "leo",
      name: "Leo",
      target: wrongRound,
    })).rejects.toThrow(/round does not match/);

    const valid = await buildReceiverRevealPacket({
      language: "en",
      seriesId: "series-1",
      roundId: "r1",
      participantId: "nemo",
      name: "Nemo",
      target: ready,
      blind: { participantId: "nemo", status: "sealed", first: "stone", providerAttemptCount: 1 },
      canReadImages: false,
    });
    expect(JSON.stringify(valid.messages)).toContain("SECRET_TARGET_ALPHA");
  });

  it("keeps target text, target filenames, other answers, and hidden topic out of a receiver pre-Reveal provider packet", () => {
    const packet = buildReceiverFirstPacket({
      language: "en",
      seriesId: "series-1",
      roundId: "r1",
      participantId: "nemo",
      name: "Nemo",
      roundNumber: 1,
      topicLabel: "SECRET_TOPIC",
      discloseTopic: false,
    });
    const wire = JSON.stringify(packet.messages);
    expect(wire).not.toContain("SECRET_TARGET_ALPHA");
    expect(wire).not.toContain("secret-castle.png");
    expect(wire).not.toContain("OTHER_RECEIVER_SECRET");
    expect(wire).not.toContain("SECRET_TOPIC");
    expect(wire).toContain("The topic has not been disclosed.");
    expect(packet.messages.every((message) => message.continuationState === undefined)).toBe(true);
  });

  it("rejects inherited provider history and continuation when composing the actual provider message list", () => {
    const packet = buildReceiverSecondPacket({
      language: "en",
      seriesId: "series-1",
      roundId: "r2",
      participantId: "nemo",
      name: "Nemo",
      ownFirst: "cold, vertical",
    });

    expect(() => composeTelepathicProviderMessages(packet, {
      history: [{ roundScopeKey: "telepathic-series:series-1:round:r1:participant:nemo", message: { role: "assistant", content: "PRIOR_ROUND_REVEAL" } }],
    })).toThrow(/without inherited provider history or continuation state/);

    expect(() => composeTelepathicProviderMessages(packet, {
      continuation: { roundScopeKey: "telepathic-series:series-1:round:r2:participant:nemo", state: continuation },
    })).toThrow(/without inherited provider history or continuation state/);

    const messages = composeTelepathicProviderMessages(packet);
    expect(messages.every((message) => message.continuationState === undefined)).toBe(true);
    expect(JSON.stringify(messages)).not.toContain("PRIOR_ROUND_REVEAL");
    expect(JSON.stringify(messages)).toContain("cold, vertical");
  });

  it("treats two technical delivery attempts separately from first/second-look exercise stages", () => {
    let submission = createBlindSubmission("nemo");
    submission = recordTechnicalAttempt(submission);
    expect(submission.providerAttemptCount).toBe(1);
    submission = recordFirstBlindResponse(submission, "vertical, cool");
    submission = recordSecondBlindResponse(submission, "metallic movement");
    expect(submission.providerAttemptCount).toBe(1);
    expect(submission.status).toBe("second_complete");

    let failed = createBlindSubmission("aura");
    failed = recordTechnicalAttempt(failed);
    failed = recordTechnicalAttempt(failed);
    expect(failed.providerAttemptCount).toBe(MAX_TECHNICAL_SUBMISSION_ATTEMPTS);
    expect(failed.status).toBe("no_submission");
  });

  it("delivers other participants' answers only after explicit YES consent", () => {
    const noPacket = buildSharedAnswersPacket({
      language: "en", seriesId: "series-1", roundId: "r1", participantId: "leo", name: "Leo", consent: "no", othersAnswers: "OTHER_RECEIVER_SECRET",
    });
    expect(noPacket).toBeNull();
    const yesPacket = buildSharedAnswersPacket({
      language: "en", seriesId: "series-1", roundId: "r1", participantId: "leo", name: "Leo", consent: "yes", othersAnswers: "OTHER_RECEIVER_SECRET",
    });
    expect(JSON.stringify(yesPacket?.messages)).toContain("OTHER_RECEIVER_SECRET");
  });

  it("starts final-series reflection in a separate fresh context and rejects round continuation/history", () => {
    const finalPacket = buildFinalSeriesPacket({
      language: "en",
      seriesId: "series-1",
      participantId: "nemo",
      name: "Nemo",
      seriesPacket: {
        participantId: "nemo",
        participantName: "Nemo",
        rounds: [{ roundNumber: 1, role: "receiver", revealText: "Target A", ownBlind: { participantId: "nemo", status: "sealed", first: "cold", providerAttemptCount: 1 } }],
      },
    });
    expect(finalPacket.contextPolicy).toBe("final_series_context");
    expect(() => composeTelepathicProviderMessages(finalPacket, {
      history: [{ roundScopeKey: "anything", message: { role: "assistant", content: "old" } }],
    })).toThrow(/without inherited provider history or continuation state/);
  });

  it("separates soft image-inclusive cost estimation from hard-limit eligibility", () => {
    const textOnly = preflightTelepathicMessages({ messages: [{ role: "user", content: "hello" }], model: model(false), reservedOutputTokens: 1000 });
    expect(textOnly.estimatedCostUsd).toBeGreaterThan(0);
    expect(textOnly.hardCostLimitEligibility).toBe("eligible");

    const withImage = preflightTelepathicMessages({
      messages: [{ role: "user", content: "reveal", images: [{ mimeType: "image/png", dataBase64: "AAAA" }] }],
      model: model(true),
      reservedOutputTokens: 1000,
    });
    expect(withImage.estimatedCostUsd).toBeGreaterThan(0);
    expect(withImage.budget.imageCount).toBe(1);
    expect(withImage.hardCostLimitEligibility).toBe("image_billing_not_hard_preflightable");
  });
});
