import { sha256Text } from "../application/sha256";
import { assertCompleteAnalyticalResponse } from "../providers/outputRecovery";
import type { ProviderChatResponse, ProviderConfig, ProviderModel } from "../providers/types";
import type { AppRepository } from "../storage/repository";
import type { SessionEventRecord } from "./types";
export const POST_REVEAL_RECEIPT = "POST_REVEAL_RESPONSE_RECEIPT_V1";
export class PostRevealCheckpointError extends Error {
  constructor(cause: unknown) { super(`Post-Reveal checkpoint failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause }); this.name = "PostRevealCheckpointError"; }
}
export function isPostRevealCheckpointFailure(cause: unknown, depth = 0): boolean {
  if (cause instanceof PostRevealCheckpointError) return true;
  if (!cause || typeof cause !== "object" || depth > 5) return false;
  const error = cause as { cause?: unknown; causeError?: unknown };
  return isPostRevealCheckpointFailure(error.cause, depth + 1) || isPostRevealCheckpointFailure(error.causeError, depth + 1);
}
type Receipt = { hash: string; stage: "viewer" | "monitor"; automatic: boolean; response: ProviderChatResponse; requiresProviderState: boolean };
const buffers = new WeakMap<object, Map<string, Receipt>>();
const owner = (repository: object) => (repository as { recoveryOwner?: object }).recoveryOwner ?? repository;
export function postRevealReceiptRoute(config: ProviderConfig, model: ProviderModel) {
  return { provider: config.provider, providerId: config.id, credentialId: config.credentialId, credentialFingerprint: config.credentialFingerprint,
    baseUrl: config.baseUrl, outputTokenField: config.customOutputTokenField, modelId: model.modelId, route: model.route,
    capabilities: Object.fromEntries(Object.entries(model.capabilities).filter(([key]) => !["capturedAt", "source"].includes(key))) };
}
export function hasPostRevealReceipt(repository: object, sessionId: string, stage: "viewer" | "monitor", events: SessionEventRecord[]) {
  return events.some(e => e.eventType === POST_REVEAL_RECEIPT && e.metadata?.stage === stage && e.metadata.automatic === true && !e.metadata.requiresProviderState)
    || [...(buffers.get(owner(repository))?.entries() ?? [])].some(([key, r]) => key.startsWith(`${sessionId}:`) && r.stage === stage && r.automatic);
}
/** Cache only an accepted analytical response. Provider continuation secrets
 * remain in RAM or in the existing encrypted provider-state storage. */
export async function withPostRevealReceipt(input: {
  repository: object; sessionId: string; stage: "viewer" | "monitor"; automatic: boolean;
  signature: unknown; requiresProviderState?: boolean; send(): Promise<ProviderChatResponse>;
}): Promise<ProviderChatResponse> {
  const repository = input.repository as Partial<Pick<AppRepository, "listSessionEvents" | "appendSessionEvent">>;
  const hash = await sha256Text(JSON.stringify(input.signature));
  const key = `${input.sessionId}:${input.stage}:${hash}`;
  let ram = buffers.get(owner(repository)); if (!ram) { ram = new Map(); buffers.set(owner(repository), ram); }
  if (input.automatic && [...ram.entries()].some(([k, r]) => k.startsWith(`${input.sessionId}:`) && r.automatic && r.stage === input.stage && r.hash !== hash)) throw new PostRevealCheckpointError(new Error("Buffered Post-Reveal request/settings changed; no request was sent."));
  let events: SessionEventRecord[];
  try { events = await repository.listSessionEvents?.(input.sessionId) ?? []; } catch (cause) { throw new PostRevealCheckpointError(cause); }
  const durable = events.filter(e => e.eventType === POST_REVEAL_RECEIPT && e.metadata?.stage === input.stage && e.metadata.hash === hash).at(-1);
  if (input.automatic && events.some(e => e.eventType === POST_REVEAL_RECEIPT && e.metadata?.stage === input.stage && e.metadata.automatic === true && e.metadata.hash !== hash)) throw new Error("Post-Reveal frozen request/settings changed before receipt recovery.");
  let receipt = ram.get(key);
  if (receipt && durable && (durable.content !== receipt.response.content || durable.metadata?.providerRequestId !== receipt.response.providerRequestId)) throw new PostRevealCheckpointError(new Error("Conflicting Post-Reveal receipt; no overwrite was performed."));
  if (!receipt && durable) {
    if (durable.metadata?.requiresProviderState) throw new PostRevealCheckpointError(new Error("Saved response requires unavailable provider continuation state; no new request was sent."));
    receipt = { hash, stage: input.stage, automatic: input.automatic, requiresProviderState: false, response: { content: durable.content ?? "", usage: durable.metadata?.usage as ProviderChatResponse["usage"] ?? {}, finishReason: durable.metadata?.finishReason as string | undefined, providerRequestId: durable.metadata?.providerRequestId as string | undefined } };
  }
  if (!receipt) {
    const response = await input.send();
    receipt = { hash, stage: input.stage, automatic: input.automatic, requiresProviderState: Boolean(input.requiresProviderState), response };
    ram.set(key, receipt);
  }
  try { assertCompleteAnalyticalResponse(receipt.response); }
  catch (cause) { throw new PostRevealCheckpointError(cause); }
  if (!durable && repository.appendSessionEvent) {
    try { await repository.appendSessionEvent(input.sessionId, { eventType: POST_REVEAL_RECEIPT, role: "controller", content: receipt.response.content, metadata: { hash, stage: input.stage, automatic: input.automatic, requiresProviderState: receipt.requiresProviderState, usage: receipt.response.usage, finishReason: receipt.response.finishReason, providerRequestId: receipt.response.providerRequestId } }); }
    catch (cause) { throw new PostRevealCheckpointError(cause); }
  }
  // Keep the one receipt until the terminal transcript append has succeeded.
  ram.set(key, receipt);
  return receipt.response;
}
export function releasePostRevealReceipt(repository: object, sessionId: string, response: ProviderChatResponse) {
  const ram = buffers.get(owner(repository));
  for (const [key, receipt] of ram ?? []) if (key.startsWith(`${sessionId}:`) && receipt.response === response) ram?.delete(key);
}
