import type { ProviderImageInput, ProviderMessage } from "../providers/types";
import type { ProviderContinuationState } from "../providers/continuationContract";
import {
  buildReceiverFirstPrompt,
  buildRoundGreeting,
  buildReceiverRevealPrompt,
  buildMissingResponseRevealPrompt,
  buildReceiverSecondLookPrompt,
  buildSenderRevealPrompt,
  buildSenderTargetPrompt,
  buildTargetLockedConfirmation,
  buildSeriesReflectionPrompt,
  buildSharedAnswersPrompt,
  buildSharingConsentPrompt,
  hiddenTopicLabel,
} from "./prompts";
import type {
  TelepathicBlindSubmission,
  TelepathicLanguage,
  TelepathicLockedTarget,
  TelepathicProviderScope,
  TelepathicSeriesParticipantPacket,
} from "./types";
import { telepathicProviderScopeKey } from "./types";
import { assertTelepathicTargetIntegrity } from "./target";

export interface TelepathicProviderPacket {
  scope: TelepathicProviderScope;
  scopeKey: string;
  contextPolicy: "fresh_round_context" | "final_series_context";
  continuationPolicy: "none";
  messages: ProviderMessage[];
}

export interface TelepathicScopedProviderMessage {
  roundScopeKey: string;
  message: ProviderMessage;
}

export interface TelepathicScopedContinuation {
  roundScopeKey: string;
  state: ProviderContinuationState;
}

/**
 * Compose the concrete provider message list for one telepathic call.
 * Current-round history may be supplied only when it is explicitly tagged with
 * the same series/round/participant scope. Prior-round or cross-participant
 * history is rejected rather than silently filtered. Final-series reflection
 * always starts a separate context and accepts no continuation/history.
 */
export function composeTelepathicProviderMessages(
  packet: TelepathicProviderPacket,
  options: {
    history?: TelepathicScopedProviderMessage[];
    continuation?: TelepathicScopedContinuation;
  } = {},
): ProviderMessage[] {
  const history = options.history ?? [];
  if (history.length || options.continuation) {
    throw new Error("Telepathic provider calls must use an explicitly rebuilt packet without inherited provider history or continuation state.");
  }
  return packet.messages.map((message) => ({ ...message }));
}

function packet(scope: TelepathicProviderScope, content: string, contextPolicy: TelepathicProviderPacket["contextPolicy"] = "fresh_round_context", images?: ProviderImageInput[]): TelepathicProviderPacket {
  return {
    scope,
    scopeKey: telepathicProviderScopeKey(scope),
    contextPolicy,
    continuationPolicy: "none",
    messages: [{ role: "user", content, ...(images?.length ? { images: images.map((image) => ({ ...image })) } : {}) }],
  };
}

export function topicForReceiver(language: TelepathicLanguage, disclosed: boolean, topicLabel: string): string {
  return disclosed ? topicLabel : hiddenTopicLabel(language);
}

export function buildSenderTargetPacket(input: {
  language: TelepathicLanguage;
  seriesId: string;
  roundId: string;
  participantId: string;
  name: string;
  roundNumber: number;
  topicLabel: string;
}): TelepathicProviderPacket {
  const role = input.language === "pl" ? "nadawcą" : "the sender";
  return packet(
    { seriesId: input.seriesId, roundId: input.roundId, participantId: input.participantId, callStage: "sender_target" },
    [
      buildRoundGreeting(input.language, { name: input.name, role, round: input.roundNumber, topicOrHidden: input.topicLabel }),
      buildSenderTargetPrompt(input.language, { name: input.name, topicOrHidden: input.topicLabel }),
    ].join("\n\n"),
  );
}

export function buildSenderTransmissionConfirmationPacket(input: {
  language: TelepathicLanguage;
  seriesId: string;
  roundId: string;
  participantId: string;
  name: string;
}): TelepathicProviderPacket {
  return packet(
    { seriesId: input.seriesId, roundId: input.roundId, participantId: input.participantId, callStage: "sender_transmission_confirmation" },
    buildTargetLockedConfirmation(input.language, input.name),
  );
}

export function buildReceiverFirstPacket(input: {
  language: TelepathicLanguage;
  seriesId: string;
  roundId: string;
  participantId: string;
  name: string;
  roundNumber: number;
  topicLabel: string;
  discloseTopic: boolean;
}): TelepathicProviderPacket {
  const topic = topicForReceiver(input.language, input.discloseTopic, input.topicLabel);
  const role = input.language === "pl" ? "odbiorcą" : "a receiver";
  return packet(
    { seriesId: input.seriesId, roundId: input.roundId, participantId: input.participantId, callStage: "receiver_first" },
    [
      buildRoundGreeting(input.language, { name: input.name, role, round: input.roundNumber, topicOrHidden: topic }),
      buildReceiverFirstPrompt(input.language, {
        name: input.name,
        round: input.roundNumber,
        topicOrHidden: topic,
      }),
    ].join("\n\n"),
  );
}

export function buildReceiverSecondPacket(input: {
  language: TelepathicLanguage;
  seriesId: string;
  roundId: string;
  participantId: string;
  name: string;
  ownFirst: string;
}): TelepathicProviderPacket {
  return packet(
    { seriesId: input.seriesId, roundId: input.roundId, participantId: input.participantId, callStage: "receiver_second" },
    [
      `OWN_FIRST_BLIND_RECORD:\n${input.ownFirst}`,
      buildReceiverSecondLookPrompt(input.language, { name: input.name }),
    ].join("\n\n"),
  );
}

function targetFilesForModel(target: TelepathicLockedTarget, canReadImages: boolean, language: TelepathicLanguage): string {
  if (!target.assets.length) return "";
  const descriptions = target.assets.map((asset) => asset.shortDescription?.trim()).filter(Boolean).join("; ");
  if (canReadImages) {
    return language === "pl"
      ? `Do Revealu dołączono ${target.assets.length} obraz(y). ${descriptions}`.trim()
      : `${target.assets.length} image(s) are attached to the Reveal. ${descriptions}`.trim();
  }
  return language === "pl"
    ? `Obraz nie jest dostępny dla tego modelu. Opis tekstowy obrazu: ${descriptions || "brak dodatkowego opisu"}`
    : `The image is unavailable to this model. Text description of the image: ${descriptions || "no additional description"}`;
}

export async function buildReceiverRevealPacket(input: {
  language: TelepathicLanguage;
  seriesId: string;
  roundId: string;
  participantId: string;
  name: string;
  target: TelepathicLockedTarget;
  blind: TelepathicBlindSubmission;
  canReadImages: boolean;
  images?: ProviderImageInput[];
}): Promise<TelepathicProviderPacket> {
  await assertTelepathicTargetIntegrity(input.target, { expectedRoundId: input.roundId, requireTransmissionReady: true });
  const files = targetFilesForModel(input.target, input.canReadImages, input.language);
  const revealPrompt = input.blind.status === "no_submission"
    ? [buildMissingResponseRevealPrompt(input.language, input.target.content), files].filter(Boolean).join("\n\n")
    : buildReceiverRevealPrompt(input.language, {
        name: input.name,
        target: input.target.content,
        targetFiles: files,
        ownFirst: input.blind.first ?? "",
        ownSecond: input.blind.second ?? "",
      });
  return packet(
    { seriesId: input.seriesId, roundId: input.roundId, participantId: input.participantId, callStage: "receiver_reveal" },
    revealPrompt,
    "fresh_round_context",
    input.images,
  );
}

export async function buildSenderRevealPacket(input: {
  language: TelepathicLanguage;
  seriesId: string;
  roundId: string;
  participantId: string;
  name: string;
  target: TelepathicLockedTarget;
}): Promise<TelepathicProviderPacket> {
  await assertTelepathicTargetIntegrity(input.target, { expectedRoundId: input.roundId, requireTransmissionReady: true });
  return packet(
    { seriesId: input.seriesId, roundId: input.roundId, participantId: input.participantId, callStage: "sender_reveal" },
    buildSenderRevealPrompt(input.language, { name: input.name, target: input.target.content }),
  );
}

export function buildSharingConsentPacket(input: {
  language: TelepathicLanguage;
  seriesId: string;
  roundId: string;
  participantId: string;
  name: string;
  participantNames: string[];
}): TelepathicProviderPacket {
  return packet(
    { seriesId: input.seriesId, roundId: input.roundId, participantId: input.participantId, callStage: "sharing_consent" },
    buildSharingConsentPrompt(input.language, { name: input.name, participants: input.participantNames.join(", ") }),
  );
}

export function buildSharedAnswersPacket(input: {
  language: TelepathicLanguage;
  seriesId: string;
  roundId: string;
  participantId: string;
  name: string;
  consent: "yes" | "no";
  othersAnswers: string;
}): TelepathicProviderPacket | null {
  if (input.consent === "no") return null;
  return packet(
    { seriesId: input.seriesId, roundId: input.roundId, participantId: input.participantId, callStage: "shared_answers_comment" },
    buildSharedAnswersPrompt(input.language, { name: input.name, othersAnswers: input.othersAnswers }),
  );
}

export function serializeSeriesParticipantPacket(seriesPacket: TelepathicSeriesParticipantPacket): string {
  return JSON.stringify(seriesPacket, null, 2);
}

export function buildFinalSeriesPacket(input: {
  language: TelepathicLanguage;
  seriesId: string;
  participantId: string;
  name: string;
  seriesPacket: TelepathicSeriesParticipantPacket;
}): TelepathicProviderPacket {
  const serialized = serializeSeriesParticipantPacket(input.seriesPacket);
  return packet(
    { seriesId: input.seriesId, roundId: "series-complete", participantId: input.participantId, callStage: "series_reflection" },
    buildSeriesReflectionPrompt(input.language, { name: input.name, seriesPacket: serialized }),
    "final_series_context",
  );
}
