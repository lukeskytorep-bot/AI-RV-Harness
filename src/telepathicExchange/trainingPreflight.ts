import type { ProviderModel } from "../providers/types";
import type { AppRepository } from "../storage/repository";
import { buildReceiverFirstPacket, buildSenderTargetPacket } from "./packets";
import { preflightTelepathicPacket, type TelepathicHardCostLimitEligibility } from "./preflight";
import { freezeTelepathicTrainingLearning, withTelepathicTrainingLearning } from "./trainingLearning";
import type { TelepathicParticipant, TelepathicSeriesConfig } from "./types";

export interface TelepathicTrainingParticipantPreflight {
  participantId: string;
  displayName: string;
  modelId: string;
  route: string;
  estimatedInputTokens: number;
  estimatedTotalTokens: number;
  contextLimit: number;
  estimatedCostPerRepresentativeCallUsd?: number;
  hardCostLimitEligibility: TelepathicHardCostLimitEligibility;
  exceeded: boolean;
}

export interface TelepathicTrainingConfigPreflight {
  ok: boolean;
  estimatedProviderCalls: number;
  estimatedBaselineCostUsd?: number;
  pricingComplete: boolean;
  participants: TelepathicTrainingParticipantPreflight[];
  frozenLearningSignature: string;
}

/**
 * Configuration-time preflight for AI-AI telepathic training.
 *
 * It intentionally does not claim to predict the exact cost of a finished
 * series: target/reveal text and provider output sizes do not exist yet.
 * Instead it freezes the exact current Viewer Learning, runs the normal
 * context estimator against representative sender/receiver packets, and
 * reports a baseline cost using the more expensive representative packet.
 *
 * The engine still performs its authoritative per-call/final-series checks.
 */
export async function preflightTelepathicTrainingConfig(input: {
  repository: AppRepository;
  config: TelepathicSeriesConfig;
  modelByParticipantId: Record<string, ProviderModel>;
}): Promise<TelepathicTrainingConfigPreflight> {
  if (input.config.mode !== "ai_ai_training") {
    throw new Error("Telepathic Training preflight requires mode=ai_ai_training.");
  }

  const frozen = await freezeTelepathicTrainingLearning({
    repository: input.repository,
    config: input.config,
  });

  const participants: TelepathicTrainingParticipantPreflight[] = [];
  let totalBaselineCost = 0;
  let pricingComplete = true;

  for (const participant of frozen.participants) {
    if (participant.kind !== "ai" || !participant.ai) {
      throw new Error("Telepathic Training preflight requires AI participants.");
    }
    const model = input.modelByParticipantId[participant.id];
    if (!model) throw new Error(`Preflight model is missing for ${participant.displayName}.`);

    const common = {
      language: frozen.language,
      seriesId: frozen.seriesId,
      roundId: "preflight-round",
      participantId: participant.id,
      name: participant.displayName,
      roundNumber: 1,
      topicLabel: frozen.topic,
    };

    const senderPacket = await withTelepathicTrainingLearning({
      participant,
      language: frozen.language,
      packet: buildSenderTargetPacket(common),
    });
    const receiverPacket = await withTelepathicTrainingLearning({
      participant,
      language: frozen.language,
      packet: buildReceiverFirstPacket({
        ...common,
        discloseTopic: frozen.discloseTopicToReceivers,
      }),
    });

    const sender = preflightTelepathicPacket({ packet: senderPacket, model });
    const receiver = preflightTelepathicPacket({ packet: receiverPacket, model });
    const representative = sender.budget.estimatedTotalTokens >= receiver.budget.estimatedTotalTokens ? sender : receiver;

    const representativeCost = Math.max(
      sender.estimatedCostUsd ?? 0,
      receiver.estimatedCostUsd ?? 0,
    );
    if (sender.estimatedCostUsd === undefined || receiver.estimatedCostUsd === undefined) {
      pricingComplete = false;
    } else {
      // Maximum normal workflow is 5 AI calls per participant per round
      // (sender/receiver path including optional post-sharing comment),
      // plus one final-series reflection per participant.
      totalBaselineCost += representativeCost * (frozen.roundCount * 5 + 1);
    }

    participants.push({
      participantId: participant.id,
      displayName: participant.displayName,
      modelId: model.modelId,
      route: model.route,
      estimatedInputTokens: Math.max(sender.budget.estimatedInputTokens, receiver.budget.estimatedInputTokens),
      estimatedTotalTokens: representative.budget.estimatedTotalTokens,
      contextLimit: representative.budget.contextLimit,
      estimatedCostPerRepresentativeCallUsd: sender.estimatedCostUsd === undefined || receiver.estimatedCostUsd === undefined
        ? undefined
        : representativeCost,
      hardCostLimitEligibility: sender.hardCostLimitEligibility === "eligible"
        ? receiver.hardCostLimitEligibility
        : sender.hardCostLimitEligibility,
      exceeded: sender.budget.exceeded || receiver.budget.exceeded,
    });
  }

  const signature = frozen.participants.map((participant: TelepathicParticipant) => [
    participant.id,
    participant.fieldGuide?.id ?? "",
    participant.fieldGuide?.contentSha256 ?? "",
    participant.viewerNotes?.id ?? "",
    participant.viewerNotes?.contentSha256 ?? "",
  ].join(":")).join("|");

  return {
    ok: participants.every((item) => !item.exceeded),
    estimatedProviderCalls: frozen.roundCount * frozen.participants.length * 5 + frozen.participants.length,
    estimatedBaselineCostUsd: pricingComplete ? totalBaselineCost : undefined,
    pricingComplete,
    participants,
    frozenLearningSignature: signature,
  };
}
