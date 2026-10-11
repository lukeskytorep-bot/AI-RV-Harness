import { sha256Text } from "../application/sha256";
import type { ProviderConfig, ProviderModel, EffectiveGenerationSettings, ProviderUsage } from "../providers/types";
import type { AppRepository } from "../storage/repository";
import type { SessionSnapshot, SessionEventRecord, RvSession } from "./types";
import type { InterfaceLanguage } from "../types";
import { emptySessionRequestMetrics, recordProviderRequest, type SessionRequestMetrics } from "./metrics";
import { validateSessionFocus, focusPasses, focusHeading, focusMetadata, SESSION_FOCUS_INSTRUCTION_VERSION, type SessionFocusPlan } from "./sessionFocus";

type Repository = Pick<AppRepository, "listSessionEvents" | "appendSessionEvent"> & Partial<Pick<AppRepository, "getSessionSnapshot" | "getReveal">>;
type FocusInput = {
  sessionFocus?: SessionFocusPlan;
  resumeSession?: RvSession;
  repository: Repository;
  monitor?: unknown;
  researchProjectId?: string;
  operationKind?: string;
  providerConfig: ProviderConfig;
  model: ProviderModel;
  sessionLanguage: InterfaceLanguage;
  protocol: { id?: string; protocolId?: string; contentSha256?: string; contentHash?: string };
  requestedSettings: unknown;
};

export function focusRoute(config: ProviderConfig, model: ProviderModel) {
  return {
    providerConfigId: config.id, provider: config.provider, modelId: model.modelId, modelRoute: model.route,
    baseUrl: config.baseUrl ?? "", customOutputTokenField: config.customOutputTokenField ?? "",
  };
}

export async function prepareSessionFocus(input: FocusInput): Promise<SessionFocusPlan | undefined> {
  let plan = input.resumeSession ? undefined : validateSessionFocus(input.sessionFocus);
  if (input.resumeSession) {
    if (!input.repository.getSessionSnapshot) {
      if (input.sessionFocus) throw new Error("Focus Resume requires the frozen snapshot.");
      return undefined;
    }
    const snapshot = await input.repository.getSessionSnapshot(input.resumeSession.id);
    if (!snapshot) throw new Error("The frozen Session Snapshot required for Resume is unavailable.");
    plan = validateSessionFocus(snapshot.sessionFocus); // Old records always remain single-pass.
    if (plan) {
      if (await input.repository.getReveal?.(input.resumeSession.id) || ["Revealed", "Completed"].includes(input.resumeSession.state)) {
        throw new Error("The focused session already has an accepted Reveal; blind Resume is disabled.");
      }
      if (snapshot.sessionFocusInstructionVersion !== SESSION_FOCUS_INSTRUCTION_VERSION) throw new Error("Unsupported focus instruction version.");
      const changed = snapshot.sessionLanguage !== input.sessionLanguage
        || snapshot.protocol.id !== (input.protocol.id ?? input.protocol.protocolId)
        || snapshot.protocol.contentSha256 !== (input.protocol.contentSha256 ?? input.protocol.contentHash)
        || snapshot.providerConfigId !== input.providerConfig.id
        || snapshot.credentialId !== input.providerConfig.credentialId
        || snapshot.modelRoute !== input.model.route
        || JSON.stringify(snapshot.generationSettings.requested) !== JSON.stringify(input.requestedSettings)
        || JSON.stringify(snapshot.sessionFocusRoute) !== JSON.stringify(focusRoute(input.providerConfig, input.model));
      if (changed) throw new Error("Frozen focused session configuration changed; Resume blocked before dispatch.");
    }
  }
  if (plan && (input.monitor || input.researchProjectId || input.operationKind && input.operationKind !== "rv_session_viewer")) {
    throw new Error("Session focus is only available in automatic RV Sessions without a Monitor.");
  }
  return plan;
}

export function focusSnapshotFields(plan: SessionFocusPlan | undefined, config: ProviderConfig, model: ProviderModel): Partial<SessionSnapshot> {
  return plan ? { sessionFocus: plan, sessionFocusInstructionVersion: SESSION_FOCUS_INSTRUCTION_VERSION, sessionFocusRoute: focusRoute(config, model) } : {};
}

export function focusFingerprint(base: string, plan: SessionFocusPlan | undefined, passIndex: 1 | 2, settings: EffectiveGenerationSettings, config: ProviderConfig, model: ProviderModel, language: InterfaceLanguage, protocolHash: string): string {
  return plan ? JSON.stringify({ messages: JSON.parse(base), ...focusMetadata(plan, passIndex), plan, settings, route: focusRoute(config, model), language, protocolHash }) : base;
}

export async function startFocusPass(repository: Repository, id: string, plan: SessionFocusPlan | undefined, passIndex: 1 | 2, transcript: string, language: InterfaceLanguage): Promise<string> {
  if (!plan) return transcript;
  const events = await repository.listSessionEvents(id);
  if (!events.some(event => event.eventType === "FOCUS_PASS_STARTED" && event.metadata?.passIndex === passIndex)) {
    await repository.appendSessionEvent(id, { eventType: "FOCUS_PASS_STARTED", role: "controller", metadata: focusMetadata(plan, passIndex) });
  }
  return `${transcript}${transcript ? "\n\n" : ""}${focusHeading(plan, passIndex, language)}`;
}

export async function completeFocusPass(repository: Repository, id: string, plan: SessionFocusPlan | undefined, passIndex: 1 | 2, material: string): Promise<void> {
  if (!plan) return;
  const events = await repository.listSessionEvents(id);
  const hash = await sha256Text(material);
  const existing = events.find(event => event.eventType === "FOCUS_PASS_COMPLETED" && event.metadata?.passIndex === passIndex);
  if (existing) {
    if (existing.metadata?.sha256 !== hash) throw new Error("Focused session evidence changed on replay.");
    return;
  }
  const evidence = events.filter(event => event.metadata?.passIndex === passIndex
    && ["CONTROLLER_STEP", "VIEWER_RESPONSE", "VIEWER_SPECIAL_TASK_RESPONSE", "SPECIAL_TASK_INJECTED"].includes(event.eventType));
  await repository.appendSessionEvent(id, {
    eventType: "FOCUS_PASS_COMPLETED", role: "controller",
    metadata: { ...focusMetadata(plan, passIndex), sha256: hash, materialLength: material.length, eventStart: evidence[0]?.sequenceNumber, eventEnd: evidence.at(-1)?.sequenceNumber },
  });
}

/** Use durable lengths, not headings supplied by an untrusted model, to locate each part. */
export async function verifyFocusEvidence(snapshot: SessionSnapshot | null, events: SessionEventRecord[], transcript: string, session?: RvSession | null): Promise<void> {
  const plan = validateSessionFocus(snapshot?.sessionFocus);
  if (!plan || !snapshot) return;
  if (session && (session.runType !== "automatic" || session.researchProjectId)) throw new Error("Invalid focused session route.");
  let cursor = 0;
  for (const passIndex of focusPasses(plan)) {
    const heading = focusHeading(plan, passIndex, snapshot.sessionLanguage);
    if (!transcript.slice(cursor).startsWith(passIndex === 1 ? heading : `\n\n${heading}`)) {
      throw new Error("Focused session boundary is missing from sealed evidence.");
    }
    const completion = events.find(event => event.eventType === "FOCUS_PASS_COMPLETED" && event.metadata?.passIndex === passIndex);
    const length = Number(completion?.metadata?.materialLength);
    if (!Number.isSafeInteger(length) || length < 1 || cursor + length > transcript.length
      || completion?.metadata?.sha256 !== await sha256Text(transcript.slice(cursor, cursor + length))) {
      throw new Error("Focused session evidence does not match its durable completion hash.");
    }
    cursor += length;
  }
  if (cursor !== transcript.length) throw new Error("Focused session evidence extends beyond the completed parts.");
}

export async function focusResumeMetrics(repository: Repository, session?: RvSession, plan?: SessionFocusPlan): Promise<SessionRequestMetrics> {
  let metrics = emptySessionRequestMetrics();
  if (!session || !plan) return metrics;
  const events = await repository.listSessionEvents(session.id);
  for (const event of events) {
    const failedPhysicalAttempt = event.eventType === "PROVIDER_ATTEMPT_FAILED";
    const otherwiseUnrecordedError = event.eventType === "PROVIDER_ERROR"
      && !events.some(failed => failed.eventType === "PROVIDER_ATTEMPT_FAILED" && failed.metadata?.attemptId === event.metadata?.attemptId);
    if (event.eventType === "VIEWER_OUTPUT_INCOMPLETE" || failedPhysicalAttempt || otherwiseUnrecordedError) {
      metrics = recordProviderRequest(metrics, event.metadata?.usage as ProviderUsage | undefined, Number(event.metadata?.requestDurationMs ?? 0));
    } else if (["VIEWER_RESPONSE", "VIEWER_SPECIAL_TASK_RESPONSE"].includes(event.eventType)) {
      // Accepted usage/count is replayed once; historical request duration is preserved here.
      metrics.requestDurationMs += Number(event.metadata?.requestDurationMs ?? 0);
    }
  }
  return metrics;
}
