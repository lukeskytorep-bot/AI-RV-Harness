import { createBlindSubmission, recordFirstBlindResponse, recordSecondBlindResponse, sealBlindSubmission } from "./blind";
import { parseTelepathicSharingConsent } from "./consent";
import {
  buildFinalSeriesPacket,
  buildReceiverFirstPacket,
  buildReceiverRevealPacket,
  buildReceiverSecondPacket,
  buildSenderRevealPacket,
  buildSenderTargetPacket,
  buildSenderTransmissionConfirmationPacket,
  buildSharedAnswersPacket,
  buildSharingConsentPacket,
} from "./packets";
import { planTelepathicSeries } from "./planner";
import { preflightTelepathicPacket } from "./preflight";
import { executeTelepathicProviderPacket, type ResolvedTelepathicAiRoute } from "./providerGateway";
import { loadRevealImageForJudge } from "../artifacts/native";
import type { ProviderChatAttempt } from "../providers/requestExecutor";
import type {
  TelepathicParticipant,
  TelepathicReflectionRecord,
  TelepathicRoundState,
  TelepathicSeriesConfig,
  TelepathicSeriesParticipantPacket,
  TelepathicSeriesState,
  TelepathicTargetDraft,
} from "./types";
import type { TelepathicExchangeStore } from "./store";
import { lockTelepathicTarget, markTelepathicTargetTransmissionReady } from "./target";


const activeSeriesRuns = new Set<string>();

async function withTelepathicSeriesRunLock<T>(deps: TelepathicExchangeEngineDependencies, seriesId: string, task: () => Promise<T>): Promise<T> {
  if (activeSeriesRuns.has(seriesId)) {
    throw new Error("Telepathic series is already running in this application instance. Wait for the active operation to finish before starting or resuming it again.");
  }
  activeSeriesRuns.add(seriesId);
  try {
    return await deps.store.withTelepathicSeriesLease(seriesId, task);
  } finally {
    activeSeriesRuns.delete(seriesId);
  }
}

export interface TelepathicExchangeEngineDependencies {
  store: TelepathicExchangeStore;
  resolveRoute(participant: TelepathicParticipant): Promise<ResolvedTelepathicAiRoute>;
  providerAttempt?: ProviderChatAttempt;
  now?: () => string;
  createId?: (prefix: string) => string;
}

function now(deps: TelepathicExchangeEngineDependencies): string {
  return deps.now?.() ?? new Date().toISOString();
}

function nextId(deps: TelepathicExchangeEngineDependencies, prefix: string): string {
  return deps.createId?.(prefix) ?? `${prefix}-${crypto.randomUUID()}`;
}

function participant(config: TelepathicSeriesConfig, id: string): TelepathicParticipant {
  const item = config.participants.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Telepathic participant not found: ${id}`);
  return item;
}

function topicLabel(config: TelepathicSeriesConfig): string {
  return config.topic.replaceAll("_", " ");
}

export function createTelepathicSeriesState(config: TelepathicSeriesConfig, timestamp = new Date().toISOString()): TelepathicSeriesState {
  const plan = planTelepathicSeries(config);
  const rounds: TelepathicRoundState[] = plan.rounds.map((assignment) => ({
    assignment,
    status: "pending",
    blindByParticipant: Object.fromEntries(assignment.receiverParticipantIds.map((id) => [id, createBlindSubmission(id)])),
    reflectionsByParticipant: {},
  }));
  return {
    schemaVersion: 1,
    config: structuredClone(config),
    plan,
    currentRoundIndex: 0,
    status: "ready",
    rounds,
    providerCalls: [],
    finalReflections: {},
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function othersForParticipant(state: TelepathicSeriesState, round: TelepathicRoundState, ownId: string): string {
  return state.config.participants
    .filter((item) => item.id !== ownId)
    .map((item) => {
      const blind = round.blindByParticipant[item.id];
      const reflection = round.reflectionsByParticipant[item.id]?.reflection;
      const sections = [
        blind?.first ? `FIRST BLIND: ${blind.first}` : undefined,
        blind?.second ? `SECOND LOOK: ${blind.second}` : undefined,
        reflection ? `REFLECTION: ${reflection}` : undefined,
      ].filter(Boolean);
      return `${item.displayName}\n${sections.length ? sections.join("\n") : "NO BLIND SUBMISSION"}`;
    })
    .join("\n\n");
}

function participantSeriesPacket(state: TelepathicSeriesState, participantId: string): TelepathicSeriesParticipantPacket {
  const item = participant(state.config, participantId);
  return {
    participantId,
    participantName: item.displayName,
    rounds: state.rounds
      .filter((round) => round.status === "completed")
      .map((round) => {
        const isSender = round.assignment.senderParticipantId === participantId;
        const reflection = round.reflectionsByParticipant[participantId];
        return {
          roundNumber: round.assignment.roundNumber,
          role: isSender ? "sender" : "receiver",
          ...(isSender ? { target: round.target } : { ownBlind: round.blindByParticipant[participantId] }),
          revealText: round.target?.content ?? "",
          reflection: reflection?.reflection,
          ...(reflection?.shareOthersConsent === "yes" ? { othersAnswersShared: othersForParticipant(state, round, participantId) } : {}),
          postSharingComment: reflection?.sharedAnswersComment,
        };
      }),
  };
}

function assertResolvedRouteMatchesParticipant(participantItem: TelepathicParticipant, route: ResolvedTelepathicAiRoute): void {
  const expected = participantItem.ai;
  if (!expected) throw new Error("AI participant route snapshot is missing.");
  const actual = route.snapshot;
  if (
    actual.profileId !== expected.profileId
    || actual.workspaceId !== expected.workspaceId
    || actual.aiIdentityId !== expected.aiIdentityId
    || actual.providerConfigId !== expected.providerConfigId
    || actual.credentialId !== expected.credentialId
    || actual.credentialFingerprint !== expected.credentialFingerprint
    || actual.modelId !== expected.modelId
    || actual.route !== expected.route
  ) throw new Error("Resolved telepathic AI route does not match the participant's frozen route snapshot.");
}

function callsForScope(state: TelepathicSeriesState, scopeKey: string) {
  return state.providerCalls.filter((call) => call.scopeKey === scopeKey);
}

/**
 * Idempotent stage invocation. A durable successful provider result is reused
 * after Resume instead of being billed again. A dispatched/uncertain call is
 * never repeated automatically. Failed attempts count toward the two-attempt
 * ceiling across process restarts.
 */
async function invokeAi(
  deps: TelepathicExchangeEngineDependencies,
  state: TelepathicSeriesState,
  participantItem: TelepathicParticipant,
  packet: Parameters<typeof executeTelepathicProviderPacket>[0]["packet"],
  preResolvedRoute?: ResolvedTelepathicAiRoute,
): Promise<string | null> {
  if (participantItem.kind !== "ai" || !participantItem.ai) throw new Error("This telepathic provider call requires an AI participant.");

  const existing = callsForScope(state, packet.scopeKey);
  const succeeded = [...existing].reverse().find((call) => call.status === "succeeded" && call.responseText !== undefined);
  if (succeeded) return succeeded.responseText!.trim();
  if (existing.some((call) => call.status === "dispatched" || call.status === "uncertain")) {
    throw new Error("Telepathic provider result is uncertain after dispatch. Resume must not automatically repeat this call until the operator resolves it.");
  }

  const failedAttempts = existing.filter((call) => call.status === "failed").map((call) => call.technicalAttempt);
  let technicalAttempt = failedAttempts.length ? Math.max(...failedAttempts) + 1 : 1;
  if (technicalAttempt > 2) return null;

  await deps.store.assertTelepathicSeriesLease(packet.scope.seriesId);
  const route = preResolvedRoute ?? await deps.resolveRoute(participantItem);
  assertResolvedRouteMatchesParticipant(participantItem, route);
  await deps.store.assertTelepathicSeriesLease(packet.scope.seriesId);

  for (; technicalAttempt <= 2; technicalAttempt += 1) {
    try {
      const result = await executeTelepathicProviderPacket({
        packet,
        route,
        technicalAttempt,
        attempt: deps.providerAttempt,
        signal: deps.store.telepathicSeriesLeaseSignal(packet.scope.seriesId),
        hooks: {
          createCallId: () => nextId(deps, "telepathic-call"),
          now: () => now(deps),
          persist: async (record) => {
            const index = state.providerCalls.findIndex((item) => item.id === record.id);
            if (index >= 0) state.providerCalls[index] = record;
            else state.providerCalls.push(record);
            state.updatedAt = now(deps);
            await deps.store.saveTelepathicSeries(state);
          },
        },
      });
      return result.response.content.trim();
    } catch (error) {
      const call = (error as Error & { telepathicCall?: { status?: string } }).telepathicCall;
      if (call?.status === "uncertain") {
        throw new Error("Telepathic provider result is uncertain after dispatch. Resume must not automatically repeat this call until the operator resolves it.", { cause: error });
      }
      if (technicalAttempt >= 2) return null;
    }
  }
  return null;
}

async function saveCheckpoint(deps: TelepathicExchangeEngineDependencies, state: TelepathicSeriesState): Promise<void> {
  state.updatedAt = now(deps);
  await deps.store.saveTelepathicSeries(state);
}

async function ensureTarget(
  deps: TelepathicExchangeEngineDependencies,
  state: TelepathicSeriesState,
  round: TelepathicRoundState,
  sender: TelepathicParticipant,
): Promise<void> {
  round.status = "preparing_target";
  await saveCheckpoint(deps, state);

  if (!round.target) {
    const senderTargetText = await invokeAi(deps, state, sender, buildSenderTargetPacket({
      language: state.config.language,
      seriesId: state.config.seriesId,
      roundId: round.assignment.roundId,
      participantId: sender.id,
      name: sender.displayName,
      roundNumber: round.assignment.roundNumber,
      topicLabel: topicLabel(state.config),
    }));
    if (!senderTargetText) throw new Error("AI sender failed to provide a target after two technical attempts; the round remains blocked before blind and no Reveal is created.");
    round.target = await lockTelepathicTarget(round.assignment.roundId, sender.id, { content: senderTargetText }, now(deps));
    await saveCheckpoint(deps, state);
  }

  if (round.target.status === "locked") {
    const confirmation = await invokeAi(deps, state, sender, buildSenderTransmissionConfirmationPacket({
      language: state.config.language,
      seriesId: state.config.seriesId,
      roundId: round.assignment.roundId,
      participantId: sender.id,
      name: sender.displayName,
    }));
    if (!confirmation) throw new Error("AI sender did not confirm transmission after the target was locked; the round remains blocked before blind and no Reveal is created.");
    round.target = await markTelepathicTargetTransmissionReady(round.target, now(deps));
    await saveCheckpoint(deps, state);
  }

  round.status = "blind";
  await saveCheckpoint(deps, state);
}

async function ensureBlind(
  deps: TelepathicExchangeEngineDependencies,
  state: TelepathicSeriesState,
  round: TelepathicRoundState,
): Promise<void> {
  if (!round.target) throw new Error("Telepathic blind cannot begin without a frozen target.");
  round.status = "blind";
  await saveCheckpoint(deps, state);

  for (const receiverId of round.assignment.receiverParticipantIds) {
    const receiver = participant(state.config, receiverId);
    if (receiver.kind !== "ai") continue;
    let blind = round.blindByParticipant[receiverId] ?? createBlindSubmission(receiverId);
    if (blind.status === "sealed" || blind.status === "no_submission") continue;

    if (!blind.first) {
      const firstPacket = buildReceiverFirstPacket({
        language: state.config.language,
        seriesId: state.config.seriesId,
        roundId: round.assignment.roundId,
        participantId: receiver.id,
        name: receiver.displayName,
        roundNumber: round.assignment.roundNumber,
        topicLabel: topicLabel(state.config),
        discloseTopic: state.config.discloseTopicToReceivers,
      });
      const first = await invokeAi(deps, state, receiver, firstPacket);
      const attempts = callsForScope(state, firstPacket.scopeKey).filter((call) => call.status === "failed" || call.status === "succeeded").length;
      if (!first) {
        round.blindByParticipant[receiverId] = { ...blind, providerAttemptCount: Math.min(2, attempts), status: "no_submission", sealedAt: now(deps) };
        await saveCheckpoint(deps, state);
        continue;
      }
      blind = recordFirstBlindResponse({ ...blind, providerAttemptCount: Math.min(2, Math.max(1, attempts)) }, first);
      round.blindByParticipant[receiverId] = blind;
      await saveCheckpoint(deps, state);
    }

    if (!blind.second) {
      const second = await invokeAi(deps, state, receiver, buildReceiverSecondPacket({
        language: state.config.language,
        seriesId: state.config.seriesId,
        roundId: round.assignment.roundId,
        participantId: receiver.id,
        name: receiver.displayName,
        ownFirst: blind.first!,
      }));
      if (second) blind = recordSecondBlindResponse(blind, second);
    }
    round.blindByParticipant[receiverId] = await sealBlindSubmission(blind, now(deps));
    await saveCheckpoint(deps, state);
  }
}

async function revealImagesForParticipant(
  target: NonNullable<TelepathicRoundState["target"]>,
  route: ResolvedTelepathicAiRoute,
): Promise<{ canReadImages: boolean; images: Array<{ mimeType: string; dataBase64: string }> }> {
  if (!target.assets.length || !route.model.capabilities.supportsVision || !route.model.capabilities.inputModalities.includes("image")) {
    return { canReadImages: false, images: [] };
  }
  const usable = target.assets.filter((asset) => Boolean(asset.path));
  if (usable.length !== target.assets.length) return { canReadImages: false, images: [] };
  try {
    const images = await Promise.all(usable.map((asset) => loadRevealImageForJudge({
      artifactId: asset.artifactId,
      path: asset.path!,
      originalFileName: asset.originalFileName,
      mimeType: asset.mimeType,
      size: asset.size,
      sha256: asset.sha256,
    })));
    return { canReadImages: true, images };
  } catch {
    return { canReadImages: false, images: [] };
  }
}

async function ensureRevealAndReflections(
  deps: TelepathicExchangeEngineDependencies,
  state: TelepathicSeriesState,
  round: TelepathicRoundState,
  sender: TelepathicParticipant,
): Promise<void> {
  if (!round.target) throw new Error("Reveal requires the frozen target.");
  if (!round.revealedAt) {
    round.status = "revealed";
    round.revealedAt = now(deps);
    await saveCheckpoint(deps, state);
  }
  round.status = "reflections";
  await saveCheckpoint(deps, state);

  for (const item of state.config.participants) {
    if (item.kind !== "ai") continue;
    const existing = round.reflectionsByParticipant[item.id];
    if (existing && Object.prototype.hasOwnProperty.call(existing, "reflection")) continue;
    const isSender = item.id === sender.id;
    const route = await deps.resolveRoute(item);
    assertResolvedRouteMatchesParticipant(item, route);
    const revealMaterial = isSender ? { canReadImages: false, images: [] } : await revealImagesForParticipant(round.target, route);
    const revealPacket = isSender
      ? await buildSenderRevealPacket({ language: state.config.language, seriesId: state.config.seriesId, roundId: round.assignment.roundId, participantId: item.id, name: item.displayName, target: round.target })
      : await buildReceiverRevealPacket({ language: state.config.language, seriesId: state.config.seriesId, roundId: round.assignment.roundId, participantId: item.id, name: item.displayName, target: round.target, blind: round.blindByParticipant[item.id], canReadImages: revealMaterial.canReadImages, images: revealMaterial.images });
    const reflectionText = await invokeAi(deps, state, item, revealPacket, route);
    const reflection: TelepathicReflectionRecord = {
      participantId: item.id,
      role: isSender ? "sender" : "receiver",
      reflection: reflectionText ?? "",
    };
    round.reflectionsByParticipant[item.id] = reflection;
    await saveCheckpoint(deps, state);
  }
}

async function ensureSharing(
  deps: TelepathicExchangeEngineDependencies,
  state: TelepathicSeriesState,
  round: TelepathicRoundState,
): Promise<void> {
  round.status = "sharing";
  await saveCheckpoint(deps, state);
  for (const item of state.config.participants) {
    if (item.kind !== "ai") continue;
    const reflection = round.reflectionsByParticipant[item.id] ?? { participantId: item.id, role: round.assignment.senderParticipantId === item.id ? "sender" : "receiver", reflection: "" };
    round.reflectionsByParticipant[item.id] = reflection;
    if (!reflection.shareOthersConsent) {
      const names = state.config.participants.filter((other) => other.id !== item.id).map((other) => other.displayName);
      const consentRaw = await invokeAi(deps, state, item, buildSharingConsentPacket({ language: state.config.language, seriesId: state.config.seriesId, roundId: round.assignment.roundId, participantId: item.id, name: item.displayName, participantNames: names }));
      reflection.shareOthersConsent = parseTelepathicSharingConsent(consentRaw ?? "");
      await saveCheckpoint(deps, state);
    }
    if (reflection.shareOthersConsent === "yes" && reflection.sharedAnswersComment === undefined) {
      const sharingPacket = buildSharedAnswersPacket({ language: state.config.language, seriesId: state.config.seriesId, roundId: round.assignment.roundId, participantId: item.id, name: item.displayName, consent: "yes", othersAnswers: othersForParticipant(state, round, item.id) });
      if (sharingPacket) {
        const comment = await invokeAi(deps, state, item, sharingPacket);
        reflection.sharedAnswersComment = comment ?? "";
        await saveCheckpoint(deps, state);
      }
    }
  }
}


export type TelepathicConversationHumanStep =
  | { kind: "prepare_target"; roundNumber: number }
  | { kind: "confirm_transmission"; roundNumber: number }
  | { kind: "blind_first"; roundNumber: number }
  | { kind: "blind_second"; roundNumber: number; first: string }
  | { kind: "reflection"; roundNumber: number; role: "sender" | "receiver" }
  | { kind: "none" };

function currentHumanParticipant(state: TelepathicSeriesState): TelepathicParticipant | null {
  return state.config.participants.find((item) => item.kind === "human") ?? null;
}

export function telepathicConversationHumanStep(state: TelepathicSeriesState): TelepathicConversationHumanStep {
  if (state.status === "completed" || state.status === "cancelled" || state.status === "blocked") return { kind: "none" };
  const round = state.rounds[state.currentRoundIndex];
  if (!round) return { kind: "none" };
  const human = currentHumanParticipant(state);
  if (!human) return { kind: "none" };
  const isSender = round.assignment.senderParticipantId === human.id;
  if (isSender) {
    if (!round.target) return { kind: "prepare_target", roundNumber: round.assignment.roundNumber };
    if (round.target.status === "locked") return { kind: "confirm_transmission", roundNumber: round.assignment.roundNumber };
  } else if (round.assignment.receiverParticipantIds.includes(human.id) && !round.revealedAt) {
    const blind = round.blindByParticipant[human.id] ?? createBlindSubmission(human.id);
    if (!blind.first) return { kind: "blind_first", roundNumber: round.assignment.roundNumber };
    if (blind.status !== "sealed" && blind.status !== "no_submission") return { kind: "blind_second", roundNumber: round.assignment.roundNumber, first: blind.first };
  }
  if (round.revealedAt) {
    const reflection = round.reflectionsByParticipant[human.id];
    if (!reflection || !Object.prototype.hasOwnProperty.call(reflection, "reflection")) {
      return { kind: "reflection", roundNumber: round.assignment.roundNumber, role: isSender ? "sender" : "receiver" };
    }
  }
  return { kind: "none" };
}

async function mutateTelepathicSeries<T>(deps: TelepathicExchangeEngineDependencies, seriesId: string, task: (state: TelepathicSeriesState, round: TelepathicRoundState, human: TelepathicParticipant) => Promise<T>): Promise<T> {
  return withTelepathicSeriesRunLock(deps, seriesId, async () => {
    const state = await deps.store.getTelepathicSeries(seriesId);
    if (!state) throw new Error("Telepathic series not found.");
    const round = state.rounds[state.currentRoundIndex];
    if (!round) throw new Error("Telepathic series has no current round.");
    if (round.revealedAt && round.status === "cancelled") throw new Error("A revealed round cannot be changed.");
    const human = currentHumanParticipant(state);
    if (!human) throw new Error("Conversation telepathic exchange requires a human participant.");
    const result = await task(state, round, human);
    await saveCheckpoint(deps, state);
    return result;
  });
}

export async function saveHumanTelepathicTarget(deps: TelepathicExchangeEngineDependencies, seriesId: string, draft: TelepathicTargetDraft): Promise<TelepathicSeriesState> {
  return mutateTelepathicSeries(deps, seriesId, async (state, round, human) => {
    if (round.assignment.senderParticipantId !== human.id) throw new Error("The human participant is not the sender in this round.");
    if (round.revealedAt) throw new Error("The target cannot be changed after Reveal.");
    if (round.target) throw new Error("The target has already been locked for this round.");
    round.status = "preparing_target";
    round.target = await lockTelepathicTarget(round.assignment.roundId, human.id, draft, now(deps));
    state.status = "paused";
    return structuredClone(state);
  });
}

export async function confirmHumanTelepathicTransmission(deps: TelepathicExchangeEngineDependencies, seriesId: string): Promise<TelepathicSeriesState> {
  return mutateTelepathicSeries(deps, seriesId, async (state, round, human) => {
    if (round.assignment.senderParticipantId !== human.id) throw new Error("The human participant is not the sender in this round.");
    if (!round.target) throw new Error("Lock the target before confirming transmission.");
    round.target = await markTelepathicTargetTransmissionReady(round.target, now(deps));
    round.status = "blind";
    state.status = "paused";
    return structuredClone(state);
  });
}

export async function saveHumanTelepathicFirstBlind(deps: TelepathicExchangeEngineDependencies, seriesId: string, text: string): Promise<TelepathicSeriesState> {
  return mutateTelepathicSeries(deps, seriesId, async (state, round, human) => {
    if (!round.assignment.receiverParticipantIds.includes(human.id)) throw new Error("The human participant is not a receiver in this round.");
    if (!round.target || round.target.status !== "transmission_ready" || round.revealedAt) throw new Error("Human blind input is only allowed before Reveal after transmission is ready.");
    const blind = round.blindByParticipant[human.id] ?? createBlindSubmission(human.id);
    round.blindByParticipant[human.id] = recordFirstBlindResponse(blind, text);
    round.status = "blind";
    state.status = "paused";
    return structuredClone(state);
  });
}

export async function sealHumanTelepathicBlind(deps: TelepathicExchangeEngineDependencies, seriesId: string, secondLook = ""): Promise<TelepathicSeriesState> {
  return mutateTelepathicSeries(deps, seriesId, async (state, round, human) => {
    if (!round.assignment.receiverParticipantIds.includes(human.id)) throw new Error("The human participant is not a receiver in this round.");
    if (round.revealedAt) throw new Error("Human blind input cannot be changed after Reveal.");
    let blind = round.blindByParticipant[human.id] ?? createBlindSubmission(human.id);
    if (!blind.first) throw new Error("Save the first blind description before closing the blind record.");
    if (secondLook.trim()) blind = recordSecondBlindResponse(blind, secondLook.trim());
    round.blindByParticipant[human.id] = await sealBlindSubmission(blind, now(deps));
    round.status = "blind";
    state.status = "paused";
    return structuredClone(state);
  });
}

export async function saveHumanTelepathicReflection(deps: TelepathicExchangeEngineDependencies, seriesId: string, text: string): Promise<TelepathicSeriesState> {
  return mutateTelepathicSeries(deps, seriesId, async (state, round, human) => {
    if (!round.revealedAt) throw new Error("Human reflection is available only after Reveal.");
    const role: "sender" | "receiver" = round.assignment.senderParticipantId === human.id ? "sender" : "receiver";
    round.reflectionsByParticipant[human.id] = { participantId: human.id, role, reflection: text.trim() };
    state.status = "paused";
    return structuredClone(state);
  });
}

export async function cancelCurrentTelepathicRoundBeforeReveal(deps: TelepathicExchangeEngineDependencies, seriesId: string): Promise<TelepathicSeriesState> {
  return mutateTelepathicSeries(deps, seriesId, async (state, round) => {
    if (round.revealedAt) throw new Error("A telepathic round cannot be cancelled without Reveal after Reveal has already occurred.");
    round.status = "cancelled";
    round.completedAt = now(deps);
    state.currentRoundIndex += 1;
    state.status = state.currentRoundIndex >= state.rounds.length ? "completed" : "paused";
    return structuredClone(state);
  });
}

function allBlindClosed(_state: TelepathicSeriesState, round: TelepathicRoundState): boolean {
  return round.assignment.receiverParticipantIds.every((id) => {
    const blind = round.blindByParticipant[id];
    return blind?.status === "sealed" || blind?.status === "no_submission";
  });
}

/**
 * Runs the automatic AI portions of one Conversation exchange round and stops
 * at the next human action. No ordinary Conversation history or continuation is
 * used; all provider calls pass through the telepathic packet gateway.
 */
export async function advanceTelepathicConversationSeries(deps: TelepathicExchangeEngineDependencies, seriesId: string): Promise<TelepathicSeriesState> {
  return withTelepathicSeriesRunLock(deps, seriesId, async () => {
    const state = await deps.store.getTelepathicSeries(seriesId);
    if (!state) throw new Error("Telepathic series not found.");
    if (state.config.mode !== "conversation_exchange") throw new Error("This controller runs Conversation telepathic exchange only.");
    if (state.status === "completed" || state.status === "cancelled") return state;
    if (state.status === "blocked") throw new Error("Telepathic series is blocked and requires operator resolution before Resume.");
    const round = state.rounds[state.currentRoundIndex];
    if (!round) throw new Error("Telepathic series has no current round.");
    if (round.status === "cancelled") return state;
    if (round.status === "blocked") throw new Error("Telepathic round requires operator resolution before Resume.");
    const sender = participant(state.config, round.assignment.senderParticipantId);

    state.status = "running";
    await saveCheckpoint(deps, state);
    try {
      if (["pending", "preparing_target"].includes(round.status)) {
        if (sender.kind === "ai") await ensureTarget(deps, state, round, sender);
        else if (!round.target || round.target.status !== "transmission_ready") {
          round.status = "preparing_target";
          state.status = "paused";
          await saveCheckpoint(deps, state);
          return structuredClone(state);
        } else round.status = "blind";
      }

      if (round.status === "blind") {
        await ensureBlind(deps, state, round);
        if (!allBlindClosed(state, round)) {
          state.status = "paused";
          await saveCheckpoint(deps, state);
          return structuredClone(state);
        }
      }

      if (["blind", "revealed", "reflections"].includes(round.status)) {
        await ensureRevealAndReflections(deps, state, round, sender);
        const humanStep = telepathicConversationHumanStep(state);
        if (humanStep.kind === "reflection") {
          state.status = "paused";
          await saveCheckpoint(deps, state);
          return structuredClone(state);
        }
      }

      if (["reflections", "sharing"].includes(round.status)) await ensureSharing(deps, state, round);

      round.status = "completed";
      round.completedAt ??= now(deps);
      state.currentRoundIndex += 1;
      state.status = state.currentRoundIndex >= state.rounds.length ? "completed" : "paused";
      await saveCheckpoint(deps, state);
      return structuredClone(state);
    } catch (error) {
      round.blockedReason = error instanceof Error ? error.message : String(error);
      state.status = "blocked";
      await saveCheckpoint(deps, state);
      throw error;
    }
  });
}

/**
 * Runs or resumes the current AI-only round from its last durable checkpoint.
 * Completed provider stages are reconstructed from the call ledger and are not
 * sent again. `uncertain`/dispatched calls remain a manual-resolution barrier.
 */
export async function runNextTelepathicAiRound(deps: TelepathicExchangeEngineDependencies, seriesId: string): Promise<TelepathicSeriesState> {
  return withTelepathicSeriesRunLock(deps, seriesId, async () => {
  const state = await deps.store.getTelepathicSeries(seriesId);
  if (!state) throw new Error("Telepathic series not found.");
  if (state.status === "completed" || state.status === "cancelled") return state;
  if (state.status === "blocked") throw new Error("Telepathic series is blocked and requires operator resolution before Resume.");
  const round = state.rounds[state.currentRoundIndex];
  if (!round) throw new Error("Telepathic series has no current round.");
  if (round.status === "cancelled" || round.status === "blocked") throw new Error("Telepathic round requires operator resolution before Resume.");
  const sender = participant(state.config, round.assignment.senderParticipantId);
  if (sender.kind !== "ai") throw new Error("STEP 3A executable engine currently runs AI-sender rounds; human interaction is connected in STEP 3B.");

  state.status = "running";
  await saveCheckpoint(deps, state);

  try {
    if (["pending", "preparing_target"].includes(round.status)) await ensureTarget(deps, state, round, sender);
    if (round.status === "blind") await ensureBlind(deps, state, round);
    if (["blind", "revealed", "reflections"].includes(round.status)) await ensureRevealAndReflections(deps, state, round, sender);
    if (["reflections", "sharing"].includes(round.status)) await ensureSharing(deps, state, round);

    round.status = "completed";
    round.completedAt ??= now(deps);
    state.currentRoundIndex += 1;
    state.status = state.currentRoundIndex >= state.rounds.length ? "completed" : "paused";
    await saveCheckpoint(deps, state);
    return structuredClone(state);
  } catch (error) {
    round.blockedReason = error instanceof Error ? error.message : String(error);
    state.status = "blocked";
    await saveCheckpoint(deps, state);
    throw error;
  }

  });
}

export function unresolvedTelepathicProviderCalls(state: TelepathicSeriesState): Array<TelepathicSeriesState["providerCalls"][number]> {
  return state.providerCalls.filter((call) => call.status === "uncertain" || call.status === "dispatched");
}

function inferBlockedRoundStatus(round: TelepathicRoundState): TelepathicRoundState["status"] {
  if (round.status !== "blocked") return round.status;
  if (!round.target || round.target.status !== "transmission_ready") return "preparing_target";
  if (!allBlindClosed({} as TelepathicSeriesState, round)) return "blind";
  if (!round.revealedAt) return "blind";
  return "reflections";
}

export async function resumeBlockedTelepathicSeries(deps: TelepathicExchangeEngineDependencies, seriesId: string): Promise<TelepathicSeriesState> {
  return withTelepathicSeriesRunLock(deps, seriesId, async () => {
    const state = await deps.store.getTelepathicSeries(seriesId);
    if (!state) throw new Error("Telepathic series not found.");
    if (state.status !== "blocked") return state;
    const unresolved = unresolvedTelepathicProviderCalls(state);
    if (unresolved.length) throw new Error("An uncertain or dispatched provider call requires an explicit operator decision before Resume.");
    const round = state.rounds[state.currentRoundIndex];
    if (!round) throw new Error("Telepathic series has no current round.");
    round.status = inferBlockedRoundStatus(round);
    round.blockedReason = undefined;
    state.status = "paused";
    await saveCheckpoint(deps, state);
    return structuredClone(state);
  });
}

export async function allowRetryForUncertainTelepathicCall(deps: TelepathicExchangeEngineDependencies, seriesId: string, callId: string): Promise<TelepathicSeriesState> {
  return withTelepathicSeriesRunLock(deps, seriesId, async () => {
    const state = await deps.store.getTelepathicSeries(seriesId);
    if (!state) throw new Error("Telepathic series not found.");
    const call = state.providerCalls.find((item) => item.id === callId);
    if (!call || (call.status !== "uncertain" && call.status !== "dispatched")) throw new Error("The selected provider call is not awaiting operator resolution.");
    call.status = "failed";
    call.errorMessage = `${call.errorMessage ?? "Delivery outcome was uncertain."} Operator explicitly allowed a retry.`;
    call.updatedAt = now(deps);
    const isFinalSeriesReflection = call.callStage === "series_reflection" || call.roundId === "series-complete";
    if (isFinalSeriesReflection) {
      // Final-reflection recovery must not reopen completed rounds. The operator
      // resolves only this provider attempt, then can rerun final reflections.
      state.status = "completed";
    } else {
      const round = state.rounds.find((item) => item.assignment.roundId === call.roundId) ?? state.rounds[state.currentRoundIndex];
      if (round) {
        round.status = inferBlockedRoundStatus(round);
        round.blockedReason = undefined;
      }
      state.status = "paused";
    }
    await saveCheckpoint(deps, state);
    return structuredClone(state);
  });
}

export async function runTelepathicFinalReflections(deps: TelepathicExchangeEngineDependencies, seriesId: string): Promise<TelepathicSeriesState> {
  return withTelepathicSeriesRunLock(deps, seriesId, async () => {
  const state = await deps.store.getTelepathicSeries(seriesId);
  if (!state) throw new Error("Telepathic series not found.");
  if (state.status !== "completed") throw new Error("Final series reflection requires all rounds to be complete.");
  for (const item of state.config.participants) {
    if (item.kind !== "ai" || state.finalReflections[item.id]) continue;
    const packet = buildFinalSeriesPacket({ language: state.config.language, seriesId, participantId: item.id, name: item.displayName, seriesPacket: participantSeriesPacket(state, item.id) });
    const persistedSuccess = [...callsForScope(state, packet.scopeKey)].reverse().find((call) => call.status === "succeeded" && call.responseText !== undefined);
    if (persistedSuccess) {
      state.finalReflections[item.id] = persistedSuccess.responseText!.trim();
      await saveCheckpoint(deps, state);
      continue;
    }

    const route = await deps.resolveRoute(item);
    assertResolvedRouteMatchesParticipant(item, route);
    const preflight = preflightTelepathicPacket({ packet, model: route.model });
    if (preflight.budget.exceeded) {
      throw new Error(`Telepathic final-series packet exceeds the model context budget (${preflight.budget.estimatedTotalTokens}/${preflight.budget.contextLimit} estimated tokens). No rounds were truncated.`);
    }

    // `invokeAi` first reuses any durably succeeded series_reflection response,
    // closing the crash window between provider success and finalReflections save.
    const reflection = await invokeAi(deps, state, item, packet);
    if (reflection !== null) state.finalReflections[item.id] = reflection;
    await saveCheckpoint(deps, state);
  }
  return structuredClone(state);

  });
}
