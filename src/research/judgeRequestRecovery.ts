import { sha256Text } from "../application/sha256";
import { assertAbortOwnership } from "../application/abortOwnership";
import type { JudgeProviderRequest } from "../judge/engine";
import { ProviderExecutionError } from "../providers/requestExecutor";
import { providerErrorDetails } from "../providers/providerError";
import { isStandardRetryHttpStatus } from "../providers/retry";
import type { ProviderChatResponse } from "../providers/types";
import type { AppRepository } from "../storage/repository";
import type { SessionEventRecord } from "../sessions/types";

export const RESEARCH_JUDGE_REQUEST = "RESEARCH_JUDGE_REQUEST_V1";
type Status = "prepared" | "dispatched" | "received" | "failed" | "retry_granted" | "paused";
interface Receipt {
  version: 1; maxTransportRetries: 1; ordinal: number; judgeIndex: number; modelRoute: string; hash: string; status: Status;
  retryUsed: boolean; retryable?: boolean; retryAfterMs?: number; response?: ProviderChatResponse;
}
const buffers = new WeakMap<object, Map<string, Receipt>>();
export class ResearchJudgeCheckpointError extends Error {
  constructor(cause: unknown) { super("Research Judge checkpoint failed; no provider retry was started.", { cause }); this.name = "ResearchJudgeCheckpointError"; }
}
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
function records(events: SessionEventRecord[], route: string, ordinal: number, judgeIndex = 1): Receipt[] {
  const all = events.filter(e => e.eventType === RESEARCH_JUDGE_REQUEST && e.metadata?.modelRoute === route);
  if (all.some(e => !Number.isInteger(e.metadata?.judgeIndex) || Number(e.metadata?.judgeIndex) < 1 || Number(e.metadata?.judgeIndex) > 3)) throw new Error("Invalid Research Judge slot identity.");
  const journal = all.filter(e => e.metadata?.judgeIndex === judgeIndex);
  if (journal.some(e => !Number.isSafeInteger(e.metadata?.ordinal) || Number(e.metadata?.ordinal) < 0)) throw new Error("Invalid Research Judge journal ordinal.");
  let used = false, grants = 0, dispatches = 0;
  const entries = journal.filter(e => e.metadata?.ordinal === ordinal);
  for (const e of entries) {
    const r = e.metadata!;
    if (used && r.retryUsed !== true || r.status === "retry_granted" && r.retryUsed !== true) throw new Error("Research Judge recovery allowance cannot be reset.");
    used ||= r.retryUsed === true;
    if (r.status === "retry_granted") grants++;
    if (r.status === "dispatched") dispatches++;
    if (grants > 1 || dispatches > 2) throw new Error("Research Judge recovery allowance was exceeded.");
  }
  return events.filter(e => e.eventType === RESEARCH_JUDGE_REQUEST && e.metadata?.modelRoute === route && e.metadata.ordinal === ordinal && e.metadata.judgeIndex === judgeIndex).map(e => {
    const value = e.metadata as unknown as Receipt;
    if (value.version !== 1 || value.maxTransportRetries !== 1 || typeof value.retryUsed !== "boolean" || !/^[a-f0-9]{64}$/.test(value.hash)
      || !["prepared", "dispatched", "received", "failed", "retry_granted", "paused"].includes(value.status)
      || value.status === "received" && typeof value.response?.content !== "string") throw new Error("Invalid Research Judge recovery journal; no request was sent.");
    return value;
  });
}
async function persist(repository: AppRepository, sessionId: string, receipt: Receipt) {
  try { await repository.appendSessionEvent(sessionId, { eventType: RESEARCH_JUDGE_REQUEST, role: "controller", metadata: { ...receipt } }); }
  catch (cause) { throw new ResearchJudgeCheckpointError(cause); }
}
async function inspect(repository: AppRepository, sessionId: string) {
  try { return await repository.listSessionEvents(sessionId); }
  catch (cause) { throw new ResearchJudgeCheckpointError(cause); }
}
async function wait(signal?: AbortSignal, delay = 250) {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, Math.max(250, Math.min(30_000, delay)));
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** One journal per session/Judge run. Ordinals also cover output escalation,
 * JSON repair and language correction, so a restart cannot repurchase them. */
export function createResearchJudgeRequestRecovery(input: {
  repository: AppRepository; owner: object; sessionId: string; modelRoute: string; judgeIndex?: number; allowLegacyResponse?: boolean; signal?: AbortSignal;
}) {
  let ordinal = 0;
  return async (request: JudgeProviderRequest, send: () => Promise<ProviderChatResponse>): Promise<ProviderChatResponse> => {
    input.signal?.throwIfAborted();
    await assertAbortOwnership(input.signal);
    const index = ordinal++, judgeIndex = input.judgeIndex ?? 1;
    const hash = await sha256Text(JSON.stringify(canonical({ version: 1, modelRoute: input.modelRoute, judgeIndex,
      provider: request.config.provider, providerId: request.config.id, credentialId: request.config.credentialId,
      credentialFingerprint: request.config.credentialFingerprint, baseUrl: request.config.baseUrl,
      outputTokenField: request.config.customOutputTokenField, modelId: request.modelId, messages: request.messages, settings: request.settings })));
    const key = `${input.sessionId}:${input.modelRoute}:${judgeIndex}:${index}`;
    let ram = buffers.get(input.owner);
    if (!ram) { ram = new Map(); buffers.set(input.owner, ram); }
    let events = await inspect(input.repository, input.sessionId);
    if (events.some(e => e.eventType === "RESEARCH_JUDGE_VALIDATION_BLOCK" && e.metadata?.modelRoute === input.modelRoute)) throw new Error("Research Judge response validation exhausted; saved responses were retained.");
    let saved = records(events, input.modelRoute, index, judgeIndex).at(-1);
    if (saved && saved.hash !== hash) throw new Error("Research Judge frozen request/route/settings changed; no request was sent.");
    const buffered = ram.get(key);
    if (buffered) {
      if (buffered.hash !== hash || saved?.response && JSON.stringify(canonical(saved.response)) !== JSON.stringify(canonical(buffered.response))) throw new Error("Research Judge buffered receipt conflicts with its durable checkpoint.");
      if (saved?.status !== "received") await persist(input.repository, input.sessionId, buffered);
      saved = buffered; ram.delete(key);
    }
    if (saved?.status === "received" && saved.response) return structuredClone(saved.response);
    // Historical callbacks durably recorded a response before validation/freeze.
    // Replay it through the unchanged Judge validators, never accept scores here.
    const legacy = index === 0 && !saved && input.allowLegacyResponse !== false && !events.some(e => e.eventType === RESEARCH_JUDGE_REQUEST && e.metadata?.modelRoute === input.modelRoute) ? events.filter(e => e.eventType === "RESEARCH_JUDGE_RESPONSE" && e.metadata?.modelRoute === input.modelRoute).at(-1) : undefined;
    if (legacy?.content) {
      const response = { content: legacy.content, usage: legacy.metadata?.usage, finishReason: legacy.metadata?.finishReason, providerRequestId: legacy.metadata?.providerRequestId } as ProviderChatResponse;
      const receipt: Receipt = { version: 1, maxTransportRetries: 1, ordinal: index, judgeIndex, modelRoute: input.modelRoute, hash, status: "received", retryUsed: false, response };
      ram.set(key, receipt); await persist(input.repository, input.sessionId, receipt); ram.delete(key); return response;
    }
    const legacyUncertain = index === 0 && !saved && events.some(e => e.metadata?.modelRoute === input.modelRoute && (e.eventType === "RESEARCH_JUDGE_LEGACY_UNKNOWN" || e.eventType === "RESEARCH_JUDGE_ATTEMPT" && ["dispatched", "uncertain"].includes(String(e.metadata.status))));
    let receipt: Receipt = saved ?? { version: 1, maxTransportRetries: 1, ordinal: index, judgeIndex, modelRoute: input.modelRoute, hash, status: "prepared", retryUsed: false };
    if (!saved) await persist(input.repository, input.sessionId, receipt);
    if (saved && ["dispatched", "paused", "failed"].includes(saved.status) || legacyUncertain) {
      if (receipt.retryUsed || saved?.status === "failed" && !saved.retryable) throw new Error("Research Judge recovery exhausted or failure is not retryable.");
      receipt = { ...receipt, status: "retry_granted", retryUsed: true };
      await persist(input.repository, input.sessionId, receipt);
    }
    while (true) {
      input.signal?.throwIfAborted(); await assertAbortOwnership(input.signal);
      if (receipt.status === "retry_granted") await wait(input.signal, receipt.retryAfterMs);
      receipt = { ...receipt, status: "dispatched" };
      await persist(input.repository, input.sessionId, receipt); // must precede dispatch
      let response: ProviderChatResponse;
      try { response = await send(); }
      catch (cause) {
        const details = providerErrorDetails(cause instanceof ProviderExecutionError ? cause.causeError : cause);
        const retryable = Boolean(details && (["connect", "timeout", "request_send", "response_body_read"].includes(details.code) || details.code === "http_status" && isStandardRetryHttpStatus(details.httpStatus)));
        receipt = { ...receipt, status: input.signal?.aborted ? "paused" : "failed", retryable, retryAfterMs: details?.retryAfterMs };
        await persist(input.repository, input.sessionId, receipt);
        if (input.signal?.aborted || !retryable || receipt.retryUsed) throw cause;
        // The operation has settled; inspect the durable record before granting.
        events = await inspect(input.repository, input.sessionId);
        if (JSON.stringify(canonical(records(events, input.modelRoute, index, judgeIndex).at(-1))) !== JSON.stringify(canonical(receipt))) throw new ResearchJudgeCheckpointError(new Error("Research Judge checkpoint changed before recovery."));
        receipt = { ...receipt, status: "retry_granted", retryUsed: true };
        await persist(input.repository, input.sessionId, receipt);
        continue;
      }
      // Transport catch ends before receipt persistence. Preserve even partial
      // responses so the existing analytical/JSON recovery is deterministic.
      receipt = { ...receipt, status: "received", response: structuredClone(response) };
      ram.set(key, receipt);
      await persist(input.repository, input.sessionId, receipt);
      ram.delete(key);
      return response;
    }
  };
}

/** Availability for existing Resume UI; actual grants remain lease-fenced. */
export function researchJudgeRequestBlocked(events: SessionEventRecord[], route: string): boolean {
  if (events.some(e => e.eventType === "RESEARCH_JUDGE_VALIDATION_BLOCK" && e.metadata?.modelRoute === route)) return true;
  const latest = new Map<string, Receipt>();
  for (const e of events) if (e.eventType === RESEARCH_JUDGE_REQUEST && e.metadata?.modelRoute === route) latest.set(`${e.metadata.judgeIndex}:${e.metadata.ordinal}`, e.metadata as unknown as Receipt);
  try { for (const receipt of latest.values()) { if (!Number.isInteger(receipt.judgeIndex) || receipt.judgeIndex < 1 || receipt.judgeIndex > 3) return true; records(events, route, receipt.ordinal, receipt.judgeIndex); } } catch { return true; }
  return [...latest.values()].some(r => r.status !== "received" && (r.status === "failed" && !r.retryable || ["dispatched", "paused", "failed"].includes(r.status) && r.retryUsed));
}
