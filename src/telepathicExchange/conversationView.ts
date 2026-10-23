import { telepathicRecoveryDecision, type TelepathicRecoveryDecision, type TelepathicRecoveryPolicy } from "./recovery";
import type { TelepathicHistoryPage, TelepathicHistoryCursor } from "./historySummaries";
import { visibleTranscript } from "./transcript";
import { telepathicRuntimeMetrics } from "./runtimeMetrics";
import type { TelepathicExchangeRepository } from "../storage/contracts/telepathicExchangeRepository";
import { telepathicConversationHumanStep, type TelepathicConversationHumanStep } from "./engine";
import type {
  TelepathicBlindSubmission,
  TelepathicLockedTarget,
  TelepathicProviderCallRecord,
  TelepathicReflectionRecord,
  TelepathicRoundAssignment,
  TelepathicSenderPolicy,
  TelepathicSeriesState,
  TelepathicTopic,
} from "./types";

export interface TelepathicConversationParticipantView {
  id: string;
  kind: "human" | "ai";
  displayName: string;
}

export interface TelepathicConversationTargetAssetView {
  artifactId: string;
  kind: "image";
  originalFileName: string;
  mimeType: string;
  size: number;
  sha256: string;
  shortDescription?: string;
}

export interface TelepathicConversationTargetView extends Omit<TelepathicLockedTarget, "assets"> {
  assets: TelepathicConversationTargetAssetView[];
}

export interface TelepathicConversationBlindView {
  participantId: string;
  status: TelepathicBlindSubmission["status"];
  providerAttemptCount: number;
  first?: string;
  second?: string;
  guidanceResponses?: TelepathicBlindSubmission["guidanceResponses"];
  contentSha256?: string;
  sealedAt?: string;
}

export interface TelepathicConversationRoundView {
  assignment: TelepathicRoundAssignment;
  status: TelepathicSeriesState["rounds"][number]["status"];
  target?: TelepathicConversationTargetView;
  blindByParticipant: Record<string, TelepathicConversationBlindView>;
  reflectionsByParticipant: Record<string, TelepathicReflectionRecord>;
  revealedAt?: string;
  completedAt?: string;
  blockedReason?: string;
}

export interface TelepathicConversationRecoveryCallView {
  id: string;
  roundId: string;
  participantId: string;
  callStage: string;
  technicalAttempt: number;
  status: Extract<TelepathicProviderCallRecord["status"], "dispatched" | "uncertain">;
}

export interface TelepathicConversationSeriesView {
  recoveryDecision?: TelepathicRecoveryDecision;
  schemaVersion: 1;
  config: {
    schemaVersion: 1;
    seriesId: string;
    seriesWorkspaceId: string;
    mode: "conversation_exchange";
    recoveryPolicy?: TelepathicRecoveryPolicy;
    language: "pl" | "en";
    participants: TelepathicConversationParticipantView[];
    roundCount: number;
    topic?: TelepathicTopic;
    discloseTopicToReceivers: boolean;
    senderPolicy: TelepathicSenderPolicy;
  };
  plan: TelepathicSeriesState["plan"];
  currentRoundIndex: number;
  status: TelepathicSeriesState["status"];
  rounds: TelepathicConversationRoundView[];
  finalReflections: Record<string, string>;
  humanStep: TelepathicConversationHumanStep;
  recoveryCalls: TelepathicConversationRecoveryCallView[];
  repetitionStopped?: boolean;
  legacyTranscript?: boolean;
  transcript?: TelepathicSeriesState["transcript"];
  metrics?: ReturnType<typeof telepathicRuntimeMetrics>;
  archivedAt?: string;
  finalization?: TelepathicSeriesState["finalization"];
  termination?: TelepathicSeriesState["termination"];
  createdAt: string;
  updatedAt: string;
}

export interface TelepathicConversationSeriesSummary {
  seriesId: string;
  roundCount: number;
  status: TelepathicSeriesState["status"];
  updatedAt: string;
  archivedAt?: string;
}

function assetView(asset: TelepathicLockedTarget["assets"][number]): TelepathicConversationTargetAssetView {
  return {
    artifactId: asset.artifactId,
    kind: asset.kind,
    originalFileName: asset.originalFileName,
    mimeType: asset.mimeType,
    size: asset.size,
    sha256: asset.sha256,
    ...(asset.shortDescription ? { shortDescription: asset.shortDescription } : {}),
  };
}

function targetView(target: TelepathicLockedTarget): TelepathicConversationTargetView {
  return { ...target, assets: target.assets.map(assetView) };
}

function blindStatusOnly(blind: TelepathicBlindSubmission): TelepathicConversationBlindView {
  return { participantId: blind.participantId, status: blind.status, providerAttemptCount: blind.providerAttemptCount };
}

function blindFull(blind: TelepathicBlindSubmission): TelepathicConversationBlindView {
  return {
    participantId: blind.participantId,
    status: blind.status,
    providerAttemptCount: blind.providerAttemptCount,
    ...(blind.guidanceResponses ? { guidanceResponses: structuredClone(blind.guidanceResponses) } : {}),
    ...(blind.first !== undefined ? { first: blind.first } : {}),
    ...(blind.second !== undefined ? { second: blind.second } : {}),
    ...(blind.contentSha256 ? { contentSha256: blind.contentSha256 } : {}),
    ...(blind.sealedAt ? { sealedAt: blind.sealedAt } : {}),
  };
}

/**
 * Builds the only Conversation-facing representation of a telepathic series.
 * The full durable state, provider ledger, route snapshots, hidden target and
 * other receivers' pre-Reveal text stay behind the controller/repository boundary.
 */
export function buildTelepathicConversationView(state: TelepathicSeriesState): TelepathicConversationSeriesView {
  if (state.config.mode !== "conversation_exchange") throw new Error("Conversation view requires a Conversation telepathic series.");
  const human = state.config.participants.find((item) => item.kind === "human") ?? null;
  const rounds = state.rounds.map((round): TelepathicConversationRoundView => {
    const revealed = Boolean(round.revealedAt);
    const humanIsSender = Boolean(human && round.assignment.senderParticipantId === human.id);
    const blindByParticipant = Object.fromEntries(Object.entries(round.blindByParticipant).map(([participantId, blind]) => {
      const maySeeOwnBlind = Boolean(human && participantId === human.id);
      return [participantId, revealed || humanIsSender || maySeeOwnBlind ? blindFull(blind) : blindStatusOnly(blind)];
    }));
    return {
      assignment: { ...structuredClone(round.assignment), ...(!revealed && !humanIsSender ? { targetGeography: undefined } : {}) },
      status: round.status,
      ...(round.target && (revealed || humanIsSender) ? { target: targetView(round.target) } : {}),
      blindByParticipant,
      reflectionsByParticipant: revealed ? structuredClone(round.reflectionsByParticipant) : {},
      ...(round.revealedAt ? { revealedAt: round.revealedAt } : {}),
      ...(round.completedAt ? { completedAt: round.completedAt } : {}),
      ...(round.blockedReason ? { blockedReason: round.blockedReason } : {}),
    };
  });
  const recoveryCalls = state.providerCalls
    .filter((call): call is TelepathicProviderCallRecord & { status: "dispatched" | "uncertain" } => call.status === "dispatched" || call.status === "uncertain")
    .map((call) => ({ id: call.id, roundId: call.roundId, participantId: call.participantId, callStage: call.callStage, technicalAttempt: call.technicalAttempt, status: call.status }));

  return {
    schemaVersion: 1,
    config: {
      schemaVersion: 1,
      seriesId: state.config.seriesId,
      seriesWorkspaceId: state.config.seriesWorkspaceId,
      mode: "conversation_exchange",
      ...(state.config.recoveryPolicy ? { recoveryPolicy: structuredClone(state.config.recoveryPolicy) } : {}),
      language: state.config.language,
      participants: state.config.participants.map((item) => ({ id: item.id, kind: item.kind, displayName: item.displayName })),
      roundCount: state.config.roundCount,
      ...((state.config.discloseTopicToReceivers || state.rounds.every(r=>r.revealedAt || r.assignment.senderParticipantId===human?.id)) ? {topic:state.config.topic} : {}),
      discloseTopicToReceivers: state.config.discloseTopicToReceivers,
      senderPolicy: structuredClone(state.config.senderPolicy),
    },
    plan: { ...structuredClone(state.plan), rounds: rounds.map(r => structuredClone(r.assignment)) },
    transcript: visibleTranscript(state), legacyTranscript: state.transcript === undefined, metrics: telepathicRuntimeMetrics(state), archivedAt: state.archivedAt, finalization: state.finalization, termination: state.termination,
    currentRoundIndex: state.currentRoundIndex,
    status: state.status,
    rounds,
    finalReflections: structuredClone(state.finalReflections),
    humanStep: telepathicConversationHumanStep(state),
    recoveryCalls,
    recoveryDecision: telepathicRecoveryDecision(state),
    ...(state.status === "blocked" && state.providerCalls.at(-1)?.finishReason === "repetition_runaway" ? { repetitionStopped: true } : {}),
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
  };
}

export function telepathicConversationSummary(state: TelepathicSeriesState | TelepathicConversationSeriesView): TelepathicConversationSeriesSummary {
  return { seriesId: state.config.seriesId, roundCount: state.config.roundCount, status: state.status, updatedAt: state.updatedAt, archivedAt: state.archivedAt };
}

export async function loadTelepathicConversationView(repository: TelepathicExchangeRepository, seriesId: string): Promise<TelepathicConversationSeriesView | null> {
  const state = await repository.getTelepathicSeries(seriesId);
  return state ? buildTelepathicConversationView(state) : null;
}

export async function listTelepathicConversationSummaries(repository: TelepathicExchangeRepository, seriesWorkspaceId: string, includeArchived = false, cursor?: TelepathicHistoryCursor): Promise<TelepathicHistoryPage> {
  const page = await repository.listTelepathicSeriesSummaries({ mode: "conversation_exchange", seriesWorkspaceId, archive: includeArchived ? "all" : "active", limit: 50, ...(cursor ? { cursor } : {}) });
  return page;
}

export async function runTelepathicConversationUiAction(task: () => Promise<TelepathicSeriesState>): Promise<TelepathicConversationSeriesView> {
  return buildTelepathicConversationView(await task());
}
