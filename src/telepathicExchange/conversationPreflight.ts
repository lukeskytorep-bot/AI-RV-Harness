import type { ProviderModel } from "../providers/types";
import { buildReceiverFirstPacket, buildSenderTargetPacket } from "./packets";
import { preflightTelepathicPacket, type TelepathicHardCostLimitEligibility } from "./preflight";
import type { TelepathicSeriesConfig } from "./types";

export interface TelepathicConversationParticipantPreflight {
  participantId: string;
  displayName: string;
  modelId: string;
  route: string;
  estimatedInputTokens: number;
  estimatedTotalTokens: number;
  contextLimit?: number;
  estimatedCostPerRepresentativeCallUsd?: number;
  hardCostLimitEligibility: TelepathicHardCostLimitEligibility;
  exceeded: boolean;
}

export interface TelepathicConversationConfigPreflight {
  ok: boolean;
  estimatedProviderCalls: number;
  estimatedBaselineCostUsd?: number;
  pricingComplete: boolean;
  participants: TelepathicConversationParticipantPreflight[];
}

/**
 * Configuration-time estimate for Conversation Telepathic Exchange.
 *
 * This is intentionally a preview, not the authoritative dispatch guard.
 * Actual target/reveal text and model outputs do not exist before Start, while
 * the shared provider executor still performs the real context-capacity check
 * for every concrete request. We use representative sender/receiver packets to
 * give the operator a useful pre-start view of route capacity and baseline cost.
 */
export function preflightTelepathicConversationConfig(input: {
  config: TelepathicSeriesConfig;
  modelByParticipantId: Record<string, ProviderModel>;
}): TelepathicConversationConfigPreflight {
  if (input.config.mode !== "conversation_exchange") {
    throw new Error("Conversation telepathic preflight requires mode=conversation_exchange.");
  }

  const aiParticipants = input.config.participants.filter((participant) => participant.kind === "ai");
  const participants: TelepathicConversationParticipantPreflight[] = [];
  let estimatedBaselineCostUsd = 0;
  let pricingComplete = true;

  for (const participant of aiParticipants) {
    if (!participant.ai) throw new Error("Conversation telepathic AI participant route snapshot is missing.");
    const model = input.modelByParticipantId[participant.id];
    if (!model) throw new Error(`Conversation preflight model is missing for ${participant.displayName}.`);

    const common = {
      language: input.config.language,
      seriesId: input.config.seriesId,
      roundId: "preflight-round",
      participantId: participant.id,
      name: participant.displayName,
      roundNumber: 1,
      topicLabel: input.config.topic,
    };

    const sender = preflightTelepathicPacket({
      packet: buildSenderTargetPacket(common),
      model,
    });
    const receiver = preflightTelepathicPacket({
      packet: buildReceiverFirstPacket({
        ...common,
        discloseTopic: input.config.discloseTopicToReceivers,
      }),
      model,
    });

    const representative = sender.budget.estimatedTotalTokens >= receiver.budget.estimatedTotalTokens ? sender : receiver;
    const representativeCost = Math.max(sender.estimatedCostUsd ?? 0, receiver.estimatedCostUsd ?? 0);
    if (sender.estimatedCostUsd === undefined || receiver.estimatedCostUsd === undefined) {
      pricingComplete = false;
    } else {
      // Upper-bound workflow estimate: up to five AI calls per participant per
      // round, plus one final-series reflection after all rounds.
      estimatedBaselineCostUsd += representativeCost * (input.config.roundCount * 5 + 1);
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

  return {
    ok: participants.every((item) => !item.exceeded),
    estimatedProviderCalls: input.config.roundCount * aiParticipants.length * 5 + aiParticipants.length,
    estimatedBaselineCostUsd: pricingComplete ? estimatedBaselineCostUsd : undefined,
    pricingComplete,
    participants,
  };
}
