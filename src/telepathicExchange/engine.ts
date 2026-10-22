import { parseLeadDecisionResponse } from "./leadDecisionResponse";
import { TELEPATHIC_OUTPUT_POLICY_VERSION, scopeOutputBudget, nextDurableTechnicalAttempt, lengthRecoveryUnavailable } from "./outputBudgets";
import { recordTranscript } from "./transcript";
import { ensureFixedLeadGuidance, validateRoundLeadDecision } from "./fixedLeadRuntime";
import type { StoredLeadGuidanceDecision } from "./types";
import { leadInstructions, LEAD_INSTRUCTION_VERSION, leadGuidanceVersion, guidanceInstructions } from "./leadGuidance";
import { assignTargetGeographies } from "./geography";
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
import { TelepathicCheckpointError, executeTelepathicProviderPacket, telepathicRequestFingerprint, type ResolvedTelepathicAiRoute } from "./providerGateway";
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
import { withTelepathicTrainingLearning } from "./trainingLearning";


function assertSeriesNotEnded(state: TelepathicSeriesState): void {
  if (state.termination?.reason === "user_finished" || state.status === "cancelled") throw new Error("Telepathic series was ended and cannot be resumed or changed.");
}

function checkStop(deps: TelepathicExchangeEngineDependencies): void { deps.signal?.throwIfAborted(); }
function combinedSignal(deps: TelepathicExchangeEngineDependencies, seriesId: string): AbortSignal | undefined {
  const signals = [deps.signal, deps.store.telepathicSeriesLeaseSignal(seriesId)].filter((s): s is AbortSignal => Boolean(s));
  return signals.length ? AbortSignal.any(signals) : undefined;
}
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
  signal?: AbortSignal;
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
  // Only construction upgrades the contract. Loading/Resume never calls this.
  if (config.protocolVersion === "fixed_lead_v1") config = { ...config, leadInstructionVersion: LEAD_INSTRUCTION_VERSION };

  if (config.outputBudgetPolicyVersion !== undefined && ![2, 3].includes(config.outputBudgetPolicyVersion)) throw new Error("Unsupported Telepathic output policy version.");
  const plan = planTelepathicSeries(config);
  if (config.protocolVersion === "fixed_lead_v1") {
    const areas = assignTargetGeographies(plan.rounds.length);
    plan.rounds.forEach((round,index) => { round.targetGeography = areas[index]; });
  }
  const rounds: TelepathicRoundState[] = plan.rounds.map((assignment) => ({
    assignment,
    status: "pending",
    blindByParticipant: Object.fromEntries(assignment.receiverParticipantIds.map((id) => [id, createBlindSubmission(id)])),
    reflectionsByParticipant: {},
  }));
  return {
    schemaVersion: 1,
    config: { ...structuredClone(config), ...(config.protocolVersion === "fixed_lead_v1" ? { leadInstruction: leadInstructions(config.language), outputBudgetPolicyVersion: config.outputBudgetPolicyVersion ?? TELEPATHIC_OUTPUT_POLICY_VERSION } : {}) },
    plan,
    currentRoundIndex: 0,
    status: "ready",
    rounds,
    providerCalls: [],
    ...(config.protocolVersion === "fixed_lead_v1" ? { transcript: [], finalization: "pending" as const, activeElapsedMs: 0 } : {}),
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
        blind?.guidanceResponses?.length ? `GUIDANCE: ${JSON.stringify(blind.guidanceResponses)}` : undefined,
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
          ...((reflection?.shareOthersConsent === "yes" || (isSender && state.config.protocolVersion === "fixed_lead_v1")) ? { othersAnswersShared: othersForParticipant(state, round, participantId) } : {}),
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

  checkStop(deps);
  const effectivePacket = state.config.mode === "ai_ai_training" || state.config.protocolVersion === "fixed_lead_v1"
    ? await withTelepathicTrainingLearning({ packet, participant: participantItem, language: state.config.language }) : packet;
  const existing = callsForScope(state, packet.scopeKey);
  const succeeded = [...existing].reverse().find((call) => call.status === "succeeded" && call.responseText !== undefined);
  const validateDecisionResponse = packet.scope.callStage.startsWith("lead_guidance:cycle:") ? (text: string) => {
    const round = state.rounds.find(r=>r.assignment.roundId===packet.scope.roundId)!;
    parseLeadDecisionResponse(text, round, Number(packet.scope.callStage.split(":").at(-1)) as 1|2|3, leadGuidanceVersion(state));
  } : undefined;
  if (succeeded) {
    // Older candidates recorded transport success before domain validation.
    try { validateDecisionResponse?.(succeeded.responseText!); }
    catch (error) {
      succeeded.status = "failed";
      succeeded.errorMessage = error instanceof Error ? error.message : String(error);
      await saveCheckpoint(deps,state);
      throw error;
    }
    return succeeded.responseText!.trim();
  }
  if (existing.some((call) => call.status === "dispatched" || call.status === "uncertain")) {
    throw new Error("Telepathic provider result is uncertain after dispatch. Resume must not automatically repeat this call until the operator resolves it.");
  }

  let technicalAttempt = nextDurableTechnicalAttempt(existing);
  if (technicalAttempt > 2) {
    if (state.config.protocolVersion === "fixed_lead_v1") throw new Error("Telepathic stage attempts exhausted; no complete output was accepted.");
    return null;
  }

  await deps.store.assertTelepathicSeriesLease(packet.scope.seriesId);
  const route = preResolvedRoute ?? await deps.resolveRoute(participantItem);
  assertResolvedRouteMatchesParticipant(participantItem, route);
  const outputBudget = state.config.protocolVersion === "fixed_lead_v1" ? scopeOutputBudget(packet.scope.callStage, route.model.capabilities.maxOutputTokens, existing, state.config.outputBudgetPolicyVersion ?? 2) : undefined;
  const requestHash = await telepathicRequestFingerprint(effectivePacket, route, state.config.protocolVersion === "fixed_lead_v1", outputBudget);
  if (state.config.protocolVersion === "fixed_lead_v1" && existing.some(call => call.requestSha256 !== requestHash)) throw new Error("Telepathic request fingerprint/settings changed after its durable attempt was prepared.");
  await deps.store.assertTelepathicSeriesLease(packet.scope.seriesId);
  if (effectivePacket.scope.callStage === "series_reflection") {
    const preflight = preflightTelepathicPacket({ packet: effectivePacket, model: route.model });
    if (preflight.budget.exceeded) {
      throw new Error(`Telepathic final-series packet exceeds the model context budget (${preflight.budget.estimatedTotalTokens}/${preflight.budget.contextLimit} estimated tokens). No rounds were truncated.`);
    }
  }

  for (; technicalAttempt <= 2; technicalAttempt += 1) {
    if (outputBudget && technicalAttempt === 2 && lengthRecoveryUnavailable(outputBudget, callsForScope(state, packet.scopeKey))) {
      throw new Error("No larger output recovery budget is available for this model.");
    }
    try {
      const result = await executeTelepathicProviderPacket({
        packet: effectivePacket,
        route,
        technicalAttempt,
        attempt: deps.providerAttempt,
        signal: combinedSignal(deps, packet.scope.seriesId),
        fixedLead: state.config.protocolVersion === "fixed_lead_v1",
        outputBudgetSnapshot: outputBudget,
        repetitionGuardLanguage: state.config.language,
        validateResponse: validateDecisionResponse,
        hooks: {
          createCallId: () => nextId(deps, "telepathic-call"),
          now: () => now(deps),
          persist: async (record) => {
            const index = state.providerCalls.findIndex((item) => item.id === record.id);
            if (index >= 0) state.providerCalls[index] = record;
            else state.providerCalls.push(record);
            const recordedInput = state.transcript?.find(e=>e.id===`${record.id}:input`);
            if (recordedInput) recordedInput.providerCallStatus = record.status;
            if (record.status === "dispatched" || record.status === "succeeded" || (record.status === "failed" && record.responseText !== undefined)) {
              recordTranscript(state, { id: `${record.id}:input`, roundId: record.roundId === "series-complete" ? undefined : record.roundId,
                stage: record.callStage, kind: "materials", authorId: "controller", recipientIds: [record.participantId],
                ...(effectivePacket.messages.some(m=>m.images?.length) ? {attachmentRefs:state.rounds.find(r=>r.assignment.roundId===record.roundId)?.target?.assets.map(a=>a.artifactId)} : {}),
                display: effectivePacket.display ? structuredClone(effectivePacket.display) : undefined,
                text: effectivePacket.messages.map(m => `${m.role}\n${m.content}`).join("\n\n"), providerCallId: record.id, providerCallStatus: record.status },now(deps));
              if (record.responseText !== undefined) recordTranscript(state, { id: `${record.id}:output`, roundId: record.roundId === "series-complete" ? undefined : record.roundId,
                stage: record.callStage, kind: record.status === "failed" ? "notice" : record.callStage.includes("reflection") || record.callStage.includes("reveal") ? "reflection" : record.callStage === "sharing_consent" ? "consent" : "response",
                ...(record.status === "failed" && record.errorMessage?.startsWith("Invalid lead decision") ? { decisionRejectionReason: record.errorMessage } : {}),
                authorId: record.participantId, recipientIds: [], text: record.status === "failed" ? `[${record.errorMessage?.startsWith("Invalid lead decision") ? "REJECTED DECISION" : "INCOMPLETE"} · ${record.finishReason ?? "unknown"}]\n${record.responseText ?? ""}` : record.responseText ?? "", providerCallId: record.id, providerCallStatus: record.status },now(deps));
            }
            state.activeElapsedMs = state.providerCalls.reduce((total,c) => total + (c.elapsedMs ?? 0),0);
            state.updatedAt = now(deps);
            await deps.store.saveTelepathicSeries(state);
          },
        },
      });
      checkStop(deps);
      return result.response.content.trim();
    } catch (error) {
      if (error instanceof TelepathicCheckpointError) throw error;
      checkStop(deps);
      if (error instanceof Error && error.message.startsWith("Invalid lead decision")) throw error;
      const call = (error as Error & { telepathicCall?: { status?: string } }).telepathicCall;
      if (call?.status === "uncertain") {
        throw new Error("Telepathic provider result is uncertain after dispatch. Resume must not automatically repeat this call until the operator resolves it.", { cause: error });
      }
      if (technicalAttempt >= 2) {
        if (state.config.protocolVersion === "fixed_lead_v1") throw error;
        return null;
      }
    }
  }
  return null;
}

/** Carries the unsaved snapshot without starting another recovery budget. */
export class TelepathicSeriesCheckpointError extends Error {
  readonly state: TelepathicSeriesState;

  constructor(cause: unknown, state: TelepathicSeriesState) {
    super(`Telepathic series checkpoint could not be saved: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "TelepathicSeriesCheckpointError";
    this.state = structuredClone(state);
  }
}

function isCheckpointFailure(error: unknown): boolean {
  return error instanceof TelepathicCheckpointError || error instanceof TelepathicSeriesCheckpointError;
}

async function saveCheckpoint(deps: TelepathicExchangeEngineDependencies, state: TelepathicSeriesState): Promise<void> {
  state.updatedAt = now(deps);
  try { await deps.store.saveTelepathicSeries(state); }
  catch (cause) { throw new TelepathicSeriesCheckpointError(cause, state); }
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
      geographyLabel: state.config.language === "pl" ? round.assignment.targetGeography?.labelPl : round.assignment.targetGeography?.labelEn,
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
    checkStop(deps);
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

    if (state.config.protocolVersion === "fixed_lead_v1") continue;

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
  checkStop(deps);
  if (!round.target) throw new Error("Reveal requires the frozen target.");
  if (!round.revealedAt) {
    round.status = "revealed";
    round.revealedAt = now(deps);
    recordTranscript(state,{id:`${round.assignment.roundId}:reveal`,roundId:round.assignment.roundId,stage:"reveal",kind:"reveal",authorId:"controller",recipientIds:state.config.participants.map(p=>p.id),text:round.target.content},now(deps));
    await saveCheckpoint(deps, state);
  }
  round.status = "reflections";
  await saveCheckpoint(deps, state);

  const reflectionOrder = state.config.protocolVersion === "fixed_lead_v1"
    ? [...state.config.participants.filter(p => p.id !== sender.id), sender] : state.config.participants;
  for (const item of reflectionOrder) {
    checkStop(deps);
    if (item.kind !== "ai") continue;
    if (state.config.protocolVersion === "fixed_lead_v1" && item.id === sender.id && round.assignment.receiverParticipantIds.some(id => !Object.prototype.hasOwnProperty.call(round.reflectionsByParticipant[id] ?? {}, "reflection"))) return;
    const existing = round.reflectionsByParticipant[item.id];
    if (existing && Object.prototype.hasOwnProperty.call(existing, "reflection")) continue;
    const isSender = item.id === sender.id;
    const route = await deps.resolveRoute(item);
    assertResolvedRouteMatchesParticipant(item, route);
    const revealMaterial = isSender ? { canReadImages: false, images: [] } : await revealImagesForParticipant(round.target, route);
    const revealPacket = isSender
      ? await buildSenderRevealPacket({ language: state.config.language, seriesId: state.config.seriesId, roundId: round.assignment.roundId, participantId: item.id, name: item.displayName, target: round.target })
      : await buildReceiverRevealPacket({ language: state.config.language, seriesId: state.config.seriesId, roundId: round.assignment.roundId, participantId: item.id, name: item.displayName, target: round.target, blind: round.blindByParticipant[item.id], canReadImages: revealMaterial.canReadImages, images: revealMaterial.images });
    if (state.config.protocolVersion === "fixed_lead_v1" && isSender) revealPacket.messages.push({ role: "user", content: `RECEIVER ANSWERS AND REFLECTIONS:\n${othersForParticipant(state,round,item.id)}` });
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
    checkStop(deps);
    if (item.kind !== "ai") continue;
    const reflection = round.reflectionsByParticipant[item.id] ?? { participantId: item.id, role: round.assignment.senderParticipantId === item.id ? "sender" : "receiver", reflection: "" };
    round.reflectionsByParticipant[item.id] = reflection;
    if (state.config.protocolVersion === "fixed_lead_v1" && item.id === round.assignment.senderParticipantId) {
      reflection.shareOthersConsent = "yes";
      reflection.sharedAnswersComment ??= reflection.reflection;
      await saveCheckpoint(deps,state);
      continue;
    }
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
  | { kind: "lead_guidance"; roundNumber: number; cycle: 1 | 2 | 3; activeIds: string[] }
  | { kind: "receiver_guidance"; roundNumber: number; cycle: 1 | 2 | 3; instruction: string }
  | { kind: "sharing_consent"; roundNumber: number }
  | { kind: "sharing_comment"; roundNumber: number; sharedText: string }
  | { kind: "none" };

function currentHumanParticipant(state: TelepathicSeriesState): TelepathicParticipant | null {
  return state.config.participants.find((item) => item.kind === "human") ?? null;
}

export function telepathicConversationHumanStep(state: TelepathicSeriesState): TelepathicConversationHumanStep {
  if (state.archivedAt || state.status === "completed" || state.status === "cancelled" || state.status === "blocked") return { kind: "none" };
  const round = state.rounds[state.currentRoundIndex];
  if (!round) return { kind: "none" };
  const human = currentHumanParticipant(state);
  if (!human) return { kind: "none" };
  const isSender = round.assignment.senderParticipantId === human.id;
  if (state.config.protocolVersion === "fixed_lead_v1" && !round.revealedAt && round.target?.status === "transmission_ready") {
    if (isSender && round.assignment.receiverParticipantIds.every(id => round.blindByParticipant[id]?.first) && !round.guidance?.closed) {
      const pending = round.guidance?.decisions.at(-1);
      const answered = !pending || (!pending.finishRound && pending.finishParticipantIds.every(id=>round.guidance?.finishedParticipantIds.includes(id)) && guidanceInstructions(pending, leadGuidanceVersion(state)).map(i => i.participantId).every(id => round.blindByParticipant[id]?.guidanceResponses?.some(r => r.cycle === pending.cycle)));
      if (answered && (pending?.cycle ?? 0) < 3) return { kind: "lead_guidance", roundNumber: round.assignment.roundNumber, cycle: ((pending?.cycle ?? 0)+1) as 1|2|3, activeIds: round.assignment.receiverParticipantIds.filter(id => !round.guidance?.finishedParticipantIds.includes(id)) };
    }
    if (!isSender) {
      const d = round.guidance?.decisions.find(d => !round.blindByParticipant[human.id]?.guidanceResponses?.some(r => r.cycle === d.cycle) && guidanceInstructions(d, leadGuidanceVersion(state)).some(i => i.participantId === human.id));
      const instruction = d ? guidanceInstructions(d, leadGuidanceVersion(state)).find(i => i.participantId === human.id)?.instruction : undefined;
      if (d && instruction) return { kind: "receiver_guidance", roundNumber: round.assignment.roundNumber, cycle: d.cycle, instruction };
    }
  }
  if (isSender) {
    if (!round.target) return { kind: "prepare_target", roundNumber: round.assignment.roundNumber };
    if (round.target.status === "locked") return { kind: "confirm_transmission", roundNumber: round.assignment.roundNumber };
  } else if (round.assignment.receiverParticipantIds.includes(human.id) && !round.revealedAt) {
    const blind = round.blindByParticipant[human.id] ?? createBlindSubmission(human.id);
    if (!blind.first) return { kind: "blind_first", roundNumber: round.assignment.roundNumber };
    if (state.config.protocolVersion !== "fixed_lead_v1" && blind.status !== "sealed" && blind.status !== "no_submission") return { kind: "blind_second", roundNumber: round.assignment.roundNumber, first: blind.first };
  }
  if (round.revealedAt) {
    const reflection = round.reflectionsByParticipant[human.id];
    if (!reflection || !Object.prototype.hasOwnProperty.call(reflection, "reflection")) {
      return { kind: "reflection", roundNumber: round.assignment.roundNumber, role: isSender ? "sender" : "receiver" };
    }
  }
  if (state.config.protocolVersion === "fixed_lead_v1" && round.revealedAt && !isSender) {
    const reflection=round.reflectionsByParticipant[human.id];
    if (!reflection?.shareOthersConsent) return {kind:"sharing_consent",roundNumber:round.assignment.roundNumber};
    if (reflection.shareOthersConsent==="yes" && reflection.sharedAnswersComment===undefined) return {kind:"sharing_comment",roundNumber:round.assignment.roundNumber,sharedText:othersForParticipant(state,round,human.id)};
  }
  return { kind: "none" };
}

async function mutateTelepathicSeries<T>(deps: TelepathicExchangeEngineDependencies, seriesId: string, task: (state: TelepathicSeriesState, round: TelepathicRoundState, human: TelepathicParticipant) => Promise<T>): Promise<T> {
  return withTelepathicSeriesRunLock(deps, seriesId, async () => {
    const state = await deps.store.getTelepathicSeries(seriesId);
    if (!state) throw new Error("Telepathic series not found.");
    assertSeriesNotEnded(state);
    if (state.archivedAt) throw new Error("Telepathic series is archived. Restore it before changing it.");
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
    recordTranscript(state,{id:`${round.assignment.roundId}:human-target`,roundId:round.assignment.roundId,stage:"sender_target",kind:"response",authorId:human.id,recipientIds:[],text:draft.content},now(deps));
    state.status = "paused";
    return structuredClone(state);
  });
}

export async function confirmHumanTelepathicTransmission(deps: TelepathicExchangeEngineDependencies, seriesId: string): Promise<TelepathicSeriesState> {
  return mutateTelepathicSeries(deps, seriesId, async (state, round, human) => {
    if (round.assignment.senderParticipantId !== human.id) throw new Error("The human participant is not the sender in this round.");
    if (!round.target) throw new Error("Lock the target before confirming transmission.");
    round.target = await markTelepathicTargetTransmissionReady(round.target, now(deps));
    recordTranscript(state,{id:`${round.assignment.roundId}:human-ready`,roundId:round.assignment.roundId,stage:"sender_transmission_confirmation",kind:"response",authorId:human.id,recipientIds:[],text:state.config.language==="pl"?"Przekaz gotowy":"Transmission ready"},now(deps));
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
    recordTranscript(state,{id:`${round.assignment.roundId}:human-first`,roundId:round.assignment.roundId,stage:"receiver_first",kind:"response",authorId:human.id,recipientIds:[],text},now(deps));
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
    recordTranscript(state,{id:`${round.assignment.roundId}:human-reflection`,roundId:round.assignment.roundId,stage:"reflection",kind:"reflection",authorId:human.id,recipientIds:[],text:text.trim()},now(deps));
    state.status = "paused";
    return structuredClone(state);
  });
}

export async function saveHumanTelepathicSharing(deps:TelepathicExchangeEngineDependencies,seriesId:string,consent:"yes"|"no",comment?:string):Promise<TelepathicSeriesState> {
  return mutateTelepathicSeries(deps,seriesId,async(state,round,human)=>{
    if(state.config.protocolVersion!=="fixed_lead_v1"||!round.revealedAt||round.assignment.senderParticipantId===human.id) throw new Error("Human sharing action unavailable.");
    const reflection=round.reflectionsByParticipant[human.id];
    if(!reflection||reflection.reflection===undefined)throw new Error("Save your own reflection first.");
    if(reflection.shareOthersConsent && comment===undefined)throw new Error("Sharing choice is already saved.");
    if(comment!==undefined && reflection.shareOthersConsent!=="yes")throw new Error("Sharing comment requires prior consent.");
    reflection.shareOthersConsent=consent;
    if(comment!==undefined)reflection.sharedAnswersComment=comment;
    recordTranscript(state,{id:`${round.assignment.roundId}:human-consent`,roundId:round.assignment.roundId,stage:"sharing_consent",kind:"consent",authorId:human.id,recipientIds:[],text:consent},now(deps));
    if(consent==="yes")recordTranscript(state,{id:`${round.assignment.roundId}:human-shared`,roundId:round.assignment.roundId,stage:"shared_answers",kind:"materials",authorId:"controller",recipientIds:[human.id],text:othersForParticipant(state,round,human.id)},now(deps));
    if(comment!==undefined)recordTranscript(state,{id:`${round.assignment.roundId}:human-comment`,roundId:round.assignment.roundId,stage:"shared_answers_comment",kind:"response",authorId:human.id,recipientIds:[],text:comment},now(deps));
    state.status="paused";return state;
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

async function ensureGuidance(deps: TelepathicExchangeEngineDependencies, state: TelepathicSeriesState, round: TelepathicRoundState): Promise<boolean> {
  return ensureFixedLeadGuidance(state,round,{ invoke: (p,packet) => invokeAi(deps,state,p,packet), save: () => saveCheckpoint(deps,state), now: () => now(deps), checkStop: () => checkStop(deps) });
}

export async function saveHumanLeadGuidance(deps: TelepathicExchangeEngineDependencies, seriesId: string, decision: StoredLeadGuidanceDecision): Promise<TelepathicSeriesState> {
  return mutateTelepathicSeries(deps,seriesId,async(state,round,human) => {
    if (telepathicConversationHumanStep(state).kind !== "lead_guidance" || unresolvedTelepathicProviderCalls(state).length) throw new Error("Human lead guidance requires the current ready checkpoint.");
    if (state.config.protocolVersion !== "fixed_lead_v1" || round.assignment.senderParticipantId !== human.id || round.revealedAt) throw new Error("Human lead decision is unavailable.");
    round.guidance ??= { decisions: [], finishedParticipantIds: [], closed: false };
    if (round.guidance.closed || round.assignment.receiverParticipantIds.some(id => !round.blindByParticipant[id]?.first)) throw new Error("Guidance is closed or initial answers are missing.");
    const last = round.guidance.decisions.at(-1);
    if (last && guidanceInstructions(last, leadGuidanceVersion(state)).map(i => i.participantId).some(id => !round.blindByParticipant[id]?.guidanceResponses?.some(r => r.cycle === last.cycle))) throw new Error("Previous guidance is not complete.");
    const cycle = ((last?.cycle ?? 0)+1) as 1|2|3;
    if (cycle > 3) throw new Error("No fourth guidance cycle.");
    round.guidance.decisions.push(validateRoundLeadDecision(state,round,decision,cycle));
    recordTranscript(state,{id:`${round.assignment.roundId}:human-lead:${cycle}`,roundId:round.assignment.roundId,stage:"lead_guidance",kind:"response",authorId:human.id,recipientIds:[],text:JSON.stringify(decision),cycle},now(deps));
    state.status="paused"; return state;
  });
}
export async function saveHumanGuidanceResponse(deps: TelepathicExchangeEngineDependencies, seriesId: string, text: string): Promise<TelepathicSeriesState> {
  return mutateTelepathicSeries(deps,seriesId,async(state,round,human) => {
    const step=telepathicConversationHumanStep(state);
    if (step.kind!=="receiver_guidance" || !text.trim()) throw new Error("A pending human guidance response is required.");
    const blind=round.blindByParticipant[human.id]; blind.guidanceResponses ??= [];
    blind.guidanceResponses.push({cycle:step.cycle,instruction:step.instruction,response:text.trim()});
    recordTranscript(state,{id:`${round.assignment.roundId}:human-response:${step.cycle}`,roundId:round.assignment.roundId,stage:"receiver_guidance",kind:"response",authorId:human.id,recipientIds:[],text:text.trim(),cycle:step.cycle},now(deps));
    state.status="paused"; return state;
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
    assertSeriesNotEnded(state);
    if (state.config.mode !== "conversation_exchange") throw new Error("This controller runs Conversation telepathic exchange only.");
    if (state.config.protocolVersion === "fixed_lead_v1" && state.currentRoundIndex >= state.rounds.length && state.finalization !== "completed") return finalizeSeries(deps,state);
  if (state.archivedAt) throw new Error("Restore the archived series before Resume.");
  if (state.status === "completed" || state.status === "cancelled") return state;
    if (state.status === "blocked") throw new Error("Telepathic series is blocked and requires operator resolution before Resume.");
    if (state.archivedAt) throw new Error("Telepathic series is archived. Restore it before changing it.");
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
          recordTranscript(state,{id:`${round.assignment.roundId}:human-target-instruction`,roundId:round.assignment.roundId,stage:"sender_target",kind:"instruction",authorId:"controller",recipientIds:[sender.id],text:state.config.language==="pl"?`Przygotuj i opisz jeden własny cel. Kategoria: ${state.config.topic ?? "any"}. Zapisz i zamroź go, następnie potwierdź przekaz.`:`Prepare and describe one target of your own. Category: ${state.config.topic ?? "any"}. Save and lock it, then confirm transmission.`},now(deps));
          state.status = "paused";
          await saveCheckpoint(deps, state);
          return structuredClone(state);
        } else round.status = "blind";
      }

      if (round.status === "blind") {
        await ensureBlind(deps, state, round);
        if (state.config.protocolVersion === "fixed_lead_v1") await ensureGuidance(deps,state,round);
        if (!allBlindClosed(state, round)) {
          const human=state.config.participants.find(p=>p.kind==="human");
          if(human&&round.assignment.receiverParticipantIds.includes(human.id)&&!round.blindByParticipant[human.id]?.first) {
            const instruction=buildReceiverFirstPacket({language:state.config.language,seriesId:state.config.seriesId,roundId:round.assignment.roundId,participantId:human.id,name:human.displayName,roundNumber:round.assignment.roundNumber,topicLabel:topicLabel(state.config),discloseTopic:state.config.discloseTopicToReceivers});
            recordTranscript(state,{id:`${round.assignment.roundId}:human-first-instruction`,roundId:round.assignment.roundId,stage:"receiver_first",kind:"instruction",authorId:"controller",recipientIds:[human.id],text:instruction.messages.map(m=>m.content).join("\n\n")},now(deps));
          }
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
      if (state.config.protocolVersion === "fixed_lead_v1" && ["sharing_consent","sharing_comment"].includes(telepathicConversationHumanStep(state).kind)) { state.status="paused";await saveCheckpoint(deps,state);return structuredClone(state); }

      round.status = "completed";
      round.completedAt ??= now(deps);
      state.currentRoundIndex += 1;
      state.status = state.currentRoundIndex >= state.rounds.length && state.config.protocolVersion !== "fixed_lead_v1" ? "completed" : "paused";
      await saveCheckpoint(deps, state);
      if (state.config.protocolVersion === "fixed_lead_v1" && state.currentRoundIndex >= state.rounds.length) return await finalizeSeries(deps,state);
      return structuredClone(state);
    } catch (error) {
      if (isCheckpointFailure(error)) throw error;
      round.blockedReason = error instanceof Error ? error.message : String(error);
      state.status = deps.signal?.aborted ? "paused" : "blocked";
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
    assertSeriesNotEnded(state);
    if (state.config.protocolVersion === "fixed_lead_v1" && state.currentRoundIndex >= state.rounds.length && state.finalization !== "completed") return finalizeSeries(deps,state);
  if (state.archivedAt) throw new Error("Restore the archived series before Resume.");
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
    if (round.status === "blind") {
      await ensureBlind(deps, state, round);
      if (state.config.protocolVersion === "fixed_lead_v1" && !await ensureGuidance(deps,state,round)) throw new Error("AI guidance could not close blind.");
    }
    if (["blind", "revealed", "reflections"].includes(round.status)) await ensureRevealAndReflections(deps, state, round, sender);
    if (["reflections", "sharing"].includes(round.status)) await ensureSharing(deps, state, round);

    round.status = "completed";
    round.completedAt ??= now(deps);
    state.currentRoundIndex += 1;
    state.status = state.currentRoundIndex >= state.rounds.length && state.config.protocolVersion !== "fixed_lead_v1" ? "completed" : "paused";
    await saveCheckpoint(deps, state);
    if (state.config.protocolVersion === "fixed_lead_v1" && state.currentRoundIndex >= state.rounds.length) return await finalizeSeries(deps,state);
    return structuredClone(state);
  } catch (error) {
    if (isCheckpointFailure(error)) throw error;
    round.blockedReason = error instanceof Error ? error.message : String(error);
    state.status = deps.signal?.aborted ? "paused" : "blocked";
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
    assertSeriesNotEnded(state);
    if (state.archivedAt) throw new Error("Restore the archived series before recovery.");
    if (state.status !== "blocked") return state;
    const unresolved = unresolvedTelepathicProviderCalls(state);
    if (unresolved.length) throw new Error("An uncertain or dispatched provider call requires an explicit operator decision before Resume.");
    const round = state.rounds[state.currentRoundIndex];
    if (!round && state.config.protocolVersion === "fixed_lead_v1" && state.currentRoundIndex >= state.rounds.length) { state.status="paused"; await saveCheckpoint(deps,state); return structuredClone(state); }
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
    assertSeriesNotEnded(state);
    if (state.archivedAt) throw new Error("Restore the archived series before recovery.");
    const call = state.providerCalls.find((item) => item.id === callId);
    if (!call || (call.status !== "uncertain" && call.status !== "dispatched")) throw new Error("The selected provider call is not awaiting operator resolution.");
    call.status = "failed";
    call.errorMessage = `${call.errorMessage ?? "Delivery outcome was uncertain."} Operator explicitly allowed a retry.`;
    call.updatedAt = now(deps);
    const isFinalSeriesReflection = call.callStage === "series_reflection" || call.roundId === "series-complete";
    if (isFinalSeriesReflection) {
      // Final-reflection recovery must not reopen completed rounds. The operator
      // resolves only this provider attempt, then can rerun final reflections.
      state.status = state.config.protocolVersion === "fixed_lead_v1" ? "paused" : "completed";
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

async function finalizeSeries(deps: TelepathicExchangeEngineDependencies, state: TelepathicSeriesState): Promise<TelepathicSeriesState> {
  assertSeriesNotEnded(state);
  const seriesId=state.config.seriesId;
  checkStop(deps);
  if(state.archivedAt)throw new Error("Restore the archived series before Resume.");
  if (state.status !== "completed" && !(state.config.protocolVersion === "fixed_lead_v1" && state.currentRoundIndex >= state.rounds.length)) throw new Error("Final series reflection requires all rounds to be complete.");
  if (state.config.protocolVersion === "fixed_lead_v1") { state.finalization="running"; state.status="paused"; await saveCheckpoint(deps,state); }
  try {
  for (const item of state.config.participants) {
    checkStop(deps);
    if (item.kind !== "ai" || state.finalReflections[item.id]) continue;
    const packet = buildFinalSeriesPacket({ language: state.config.language, seriesId, participantId: item.id, name: item.displayName, seriesPacket: participantSeriesPacket(state, item.id) });
    const persistedSuccess = [...callsForScope(state, packet.scopeKey)].reverse().find((call) => call.status === "succeeded" && call.responseText !== undefined);
    if (persistedSuccess && state.config.protocolVersion !== "fixed_lead_v1") {
      state.finalReflections[item.id] = persistedSuccess.responseText!.trim();
      await saveCheckpoint(deps, state);
      continue;
    }

    // `invokeAi` first reuses any durably succeeded series_reflection response,
    // closing the crash window between provider success and finalReflections save.
    // If a new call is needed it applies the participant's frozen training
    // learning (AI-AI mode) before the final context-budget preflight.
    const reflection = await invokeAi(deps, state, item, packet);
    if (reflection !== null) state.finalReflections[item.id] = reflection;
    await saveCheckpoint(deps, state);
  }
  if (state.config.protocolVersion === "fixed_lead_v1") { state.finalization="completed"; state.status="completed"; await saveCheckpoint(deps,state); }
  return structuredClone(state);
  } catch(error) { if (isCheckpointFailure(error)) throw error; if (state.config.protocolVersion === "fixed_lead_v1") { state.finalization="blocked"; state.status=deps.signal?.aborted ? "paused" : "blocked"; await saveCheckpoint(deps,state); } throw error; }
}

export async function runTelepathicFinalReflections(deps: TelepathicExchangeEngineDependencies, seriesId: string): Promise<TelepathicSeriesState> {
  return withTelepathicSeriesRunLock(deps,seriesId,async()=>{
    const state=await deps.store.getTelepathicSeries(seriesId);
    if(!state) throw new Error("Telepathic series not found.");
    assertSeriesNotEnded(state);
    return finalizeSeries(deps,state);
  });
}

/** End the whole series, including interrupted finalization, without resolving
 * uncertain delivery or invoking any participant. The same run lease fences it. */
export async function endTelepathicSeries(deps: TelepathicExchangeEngineDependencies, seriesId: string): Promise<TelepathicSeriesState> {
  return withTelepathicSeriesRunLock(deps, seriesId, async () => {
    const state = await deps.store.getTelepathicSeries(seriesId);
    if (!state) throw new Error("Telepathic series not found.");
    if (state.termination?.reason === "user_finished") return state;
    if (state.archivedAt) throw new Error("Restore the archived series before ending it.");
    if (state.status === "cancelled" || (state.status === "completed" && state.finalization !== "pending" && state.finalization !== "blocked" && state.finalization !== "running" && Object.keys(state.finalReflections).length >= state.config.participants.filter(p => p.kind === "ai").length)) throw new Error("This series has no unfinished work to end.");
    state.termination = { reason: "user_finished", endedAt: now(deps) };
    state.status = "cancelled";
    await saveCheckpoint(deps, state);
    const persisted = await deps.store.getTelepathicSeries(seriesId);
    if (!persisted?.termination || persisted.status !== "cancelled") throw new Error("Telepathic series end marker was not persisted.");
    return persisted;
  });
}
