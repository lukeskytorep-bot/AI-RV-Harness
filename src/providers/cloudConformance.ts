import { sha256Text } from "../application/sha256";
import type { AppRepository } from "../storage/repository";
import { credentialIdentityFingerprint } from "./native";
import { providerErrorDetails } from "./providerError";
import { executeProviderChat, ProviderExecutionError } from "./requestExecutor";
import { CLOUD_CONFORMANCE_BUDGET, CLOUD_CONFORMANCE_OPERATION, CLOUD_CONFORMANCE_RECALL, cloudConformanceFirstMessage } from "./cloudConformanceContract";
import type { ProviderChatResponse, ProviderMessage, ProviderUsage } from "./types";
import type { ProviderResponseEvidence } from "./responseEvidence";

export interface CloudConformanceTurn {
  turn: number;
  messagesSha256: string;
  messageCount: number;
  requestedMaxOutputTokens: number;
  transportRequestId?: string;
  providerRequestId?: string;
  responseEvidence?: ProviderResponseEvidence;
  finishReason?: string;
  usage?: ProviderUsage;
  thinkingObserved?: boolean;
  replyMatched?: boolean;
  expectedReplySha256?: string;
  responseTextSha256?: string;
  nativeFinalCandidateSha256?: string;
  dispatch: "not_dispatched" | "response_received" | "unknown";
}
export interface CloudConformanceReport {
  version: 1;
  test: "ollama_cloud_two_turn_v1";
  replyComparison: "trim_exact_v1";
  id: string;
  startedAt: string;
  completedAt?: string;
  providerConfigId: string;
  endpoint: "https://ollama.com/api/chat";
  modelId: string;
  cachedModelMetadataSha256?: string;
  cachedModelDigest?: string;
  cachedModelCapturedAt?: string;
  serverVersion: null;
  outcome: "not_completed" | "two_turn_recall_observed" | "not_observed" | "cancelled" | "request_failed" | "connection_changed";
  turns: CloudConformanceTurn[];
  fullInputPreservation: "unverified";
  oversizedRejection: "unverified";
  automaticGenerationEnabled: false;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)]));
  return value;
}
/** Explicit UI diagnostic only. No automatic retries, no activation, no input-size probe. */
export async function runCloudConformance(input: {
  repository: Pick<AppRepository, "listProviderConfigs" | "listProviderModels">;
  providerConfigId: string;
  modelId: string;
  signal: AbortSignal;
}): Promise<CloudConformanceReport> {
  const report: CloudConformanceReport = { version: 1, test: "ollama_cloud_two_turn_v1", replyComparison: "trim_exact_v1", id: crypto.randomUUID(), startedAt: new Date().toISOString(), providerConfigId: input.providerConfigId, modelId: input.modelId, endpoint: "https://ollama.com/api/chat", serverVersion: null, outcome: "not_completed", turns: [], fullInputPreservation: "unverified", oversizedRejection: "unverified", automaticGenerationEnabled: false };
  let binding: string | undefined;
  let stage: "binding" | "request" = "binding";
  const resolve = async () => {
    stage = "binding";
    input.signal.throwIfAborted();
    const config = (await input.repository.listProviderConfigs()).find(c => c.id === input.providerConfigId);
    const model = (await input.repository.listProviderModels(input.providerConfigId)).find(m => m.modelId === input.modelId && m.providerConfigId === input.providerConfigId);
    if (!config || config.provider !== "ollama_cloud" || !config.enabled || !model || model.provider !== "ollama_cloud" || (config.baseUrl && config.baseUrl.replace(/\/+$/, "") !== "https://ollama.com")) throw new Error("Cloud route changed");
    const metadataHash = await sha256Text(JSON.stringify(canonical(model.rawMetadata)));
    // A genuine native fingerprint is compared in memory only. No key, hint or fingerprint is exported.
    const keyIdentity = await credentialIdentityFingerprint(config.credentialId);
    const current = JSON.stringify([config.id, config.credentialId, keyIdentity, model.modelId, model.route, metadataHash]);
    if (binding !== undefined && current !== binding) throw new Error("Cloud route changed");
    binding = current;
    report.cachedModelMetadataSha256 = metadataHash;
    report.cachedModelCapturedAt ??= model.refreshedAt;
    if (typeof (model.rawMetadata as Record<string, unknown>)?.digest === "string") report.cachedModelDigest = (model.rawMetadata as Record<string, string>).digest;
    input.signal.throwIfAborted();
    return config;
  };
  const marker = `rvh_cloud_${crypto.randomUUID().replaceAll("-", "")}`;
  const messages: ProviderMessage[] = [cloudConformanceFirstMessage(marker)];
  try {
    for (const expected of ["READY", marker]) {
      const config = await resolve();
      const turn: CloudConformanceTurn = { turn: report.turns.length + 1, messageCount: messages.length, messagesSha256: await sha256Text(JSON.stringify(messages)), requestedMaxOutputTokens: CLOUD_CONFORMANCE_BUDGET, dispatch: "not_dispatched" };
      report.turns.push(turn);
      input.signal.throwIfAborted();
      stage = "request";
      // Mark possible dispatch conservatively before calling the executor. Failure never triggers a second request.
      turn.dispatch = "unknown";
      const response: ProviderChatResponse = await executeProviderChat({ config, modelId: input.modelId, messages, settings: { requested: { maxOutputTokens: CLOUD_CONFORMANCE_BUDGET }, effective: { maxOutputTokens: CLOUD_CONFORMANCE_BUDGET }, omitted: [] }, configuredRetries: 0, operationKind: "cloud_conformance", operationId: CLOUD_CONFORMANCE_OPERATION, signal: input.signal });
      turn.dispatch = "response_received";
      turn.transportRequestId = response.transportRequestId;
      turn.providerRequestId = response.providerRequestId;
      turn.responseEvidence = response.responseEvidence;
      turn.finishReason = response.finishReason;
      turn.usage = response.usage;
      turn.thinkingObserved = Boolean(response.reasoningContent?.trim());
      turn.expectedReplySha256 = await sha256Text(expected);
      turn.responseTextSha256 = await sha256Text(response.content.trim());
      turn.nativeFinalCandidateSha256 = response.finalCandidate?.contentSha256;
      turn.replyMatched = response.finishReason === "stop" && response.content.trim() === expected;
      input.signal.throwIfAborted();
      if (!turn.replyMatched) { report.outcome = "not_observed"; break; }
      if (report.turns.length === 1) messages.push({ role: "assistant", content: response.content.trim() }, { role: "user", content: CLOUD_CONFORMANCE_RECALL });
      else { await resolve(); report.outcome = "two_turn_recall_observed"; }
    }
  } catch (cause) {
    if (stage === "request") {
      const details = cause instanceof ProviderExecutionError ? cause.causeError.details : providerErrorDetails(cause);
      const turn = report.turns.at(-1);
      if (turn && details) {
        turn.dispatch = details.phase === "before_dispatch" ? "not_dispatched" : details.responseEvidence ? "response_received" : "unknown";
        turn.transportRequestId = details.transportRequestId;
        turn.providerRequestId = details.providerRequestId;
        turn.responseEvidence = details.responseEvidence;
      }
    }
    // No untrusted provider text, private thinking or raw error body is copied into diagnostics.
    report.outcome = input.signal.aborted ? "cancelled" : stage === "binding" ? "connection_changed" : "request_failed";
  }
  report.completedAt = new Date().toISOString();
  return report;
}
