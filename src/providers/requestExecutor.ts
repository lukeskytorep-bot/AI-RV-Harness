import { classifyProviderAttempt, parseProviderResponseEvidence, type ProviderAttemptOutcome, type ProviderResponseEvidence } from "./responseEvidence";
import { assertAbortOwnership, providerAbortFromSignal } from "../application/abortOwnership";
import { discoverOpenRouterModelEndpoints, providerChatAttempt } from "./native";
import { normalizeProviderCallError, ProviderCallError } from "./providerError";
import {
  OPENROUTER_UNKNOWN_CAPACITY_ERROR,
  isOpenRouterContextCapacityError,
  type OpenRouterEndpointDiscovery,
} from "./openRouterEndpointCapability";
import { providerRetryAllowance, providerRetryDelayMs } from "./retry";
import { resolveEffectiveRequestEnvelope, type EffectiveRequestEnvelope } from "./effectiveRequestEnvelope";
import type { OperationKind } from "./operationResourceProfiles";
import type { StreamWorkflowContext } from "./streamPresentation";
import type { ProviderTimeoutPolicy } from "./streamingPolicy";
import type { EffectiveGenerationSettings, OpenRouterProviderRouting, ProviderChatResponse, ProviderConfig, ProviderMessage, ProviderStreamEvent } from "./types";

export interface ProviderAttemptContext {
  operationId: string;
  logicalRequestId: string;
  physicalAttempt: number;
  startedAtMs: number;
}

export interface ProviderExecutionReport {
  operationId: string;
  logicalRequestId: string;
  physicalAttempts: number;
  elapsedMs: number;
  recoveredFrom?: string;
  ambiguousBillingAttempts: number;
  attemptOutcomes?: ProviderAttemptOutcome[];
}

export interface ProviderExecutionResult<T> {
  value: T;
  report: ProviderExecutionReport;
}

export class ProviderExecutionError extends Error {
  readonly causeError: ProviderCallError;
  readonly report: ProviderExecutionReport;

  constructor(causeError: ProviderCallError, report: ProviderExecutionReport) {
    super(causeError.message, { cause: causeError });
    this.name = "ProviderExecutionError";
    this.causeError = causeError;
    this.report = report;
  }
}

export type ProviderChatAttempt = (request: {
  config: ProviderConfig;
  modelId: string;
  messages: ProviderMessage[];
  settings: EffectiveGenerationSettings;
  timeoutMs?: number;
  timeoutPolicy?: ProviderTimeoutPolicy;
  signal?: AbortSignal;
  providerRouting?: OpenRouterProviderRouting;
  onStreamEvent?: (event: ProviderStreamEvent) => void;
  internalOnStreamEvent?: (event: ProviderStreamEvent) => void;
  transportEnvelope?: EffectiveRequestEnvelope;
}) => Promise<ProviderChatResponse>;

/**
 * Performs one physical attempt without retry. This is only for per-attempt
 * cost/audit wrappers that are themselves called by executeProviderChat.
 */
export function providerChatOnce(request: Parameters<ProviderChatAttempt>[0], attempt?: ProviderChatAttempt): Promise<ProviderChatResponse> {
  return (attempt ?? providerChatAttempt)(request);
}

export interface ExecuteProviderRequestInput<T> {
  rejectResponseAfterAbort?: boolean;
  operationId: string;
  configuredRetries?: number;
  signal?: AbortSignal;
  executeAttempt: (context: ProviderAttemptContext) => Promise<T>;
  responseEvidence?: (value: T) => ProviderResponseEvidence | undefined;
  onAttemptFailure?: (error: ProviderCallError, context: ProviderAttemptContext) => void | Promise<void>;
  onAttemptStart?: (context: ProviderAttemptContext) => void | Promise<void>;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}

const PROVIDER_EXECUTOR_BRAND = Symbol("provider-request-executor");

export async function executeProviderRequest<T>(input: ExecuteProviderRequestInput<T>): Promise<ProviderExecutionResult<T>> {
  const logicalRequestId = crypto.randomUUID();
  const operationStartedAt = Date.now();
  let physicalAttempts = 0;
  let ambiguousBillingAttempts = 0;
  let recoveredFrom: string | undefined;
  const attemptOutcomes: ProviderAttemptOutcome[] = [];
  const attachOutcomes = (cause: unknown) => Object.assign(cause !== null && typeof cause === "object" ? cause : new Error(String(cause)), { providerAttemptOutcomes: structuredClone(attemptOutcomes) });

  while (true) {
    if (input.signal?.aborted) throw attachOutcomes(providerAbortFromSignal(input.signal));
    try { await assertAbortOwnership(input.signal); } catch (failure) { throw attachOutcomes(failure); }
    const context: ProviderAttemptContext = {
      operationId: input.operationId,
      logicalRequestId,
      physicalAttempt: physicalAttempts + 1,
      startedAtMs: Date.now(),
    };
    physicalAttempts += 1;
    let dispatchStarted = false;
    let receivedEvidence: ProviderResponseEvidence | undefined;
    let responseReturned = false;
    const identity = { attemptId: `${logicalRequestId}:${context.physicalAttempt}`, logicalRequestId, physicalAttempt: context.physicalAttempt };
    try {
      await input.onAttemptStart?.(context);
      input.signal?.throwIfAborted();
      await assertAbortOwnership(input.signal);
      dispatchStarted = true;
      const value = await input.executeAttempt(context);
      responseReturned = true;
      receivedEvidence = parseProviderResponseEvidence(input.responseEvidence?.(value));
      if (input.rejectResponseAfterAbort && input.signal?.aborted) throw Object.assign(providerAbortFromSignal(input.signal), { providerResponse: value });
      attemptOutcomes.push({ ...identity, outcome: classifyProviderAttempt({ responseEvidence: receivedEvidence }), validation: "accepted", ...(receivedEvidence ? { responseEvidence: receivedEvidence } : {}) });
      return {
        value,
        report: {
          operationId: input.operationId,
          logicalRequestId,
          physicalAttempts,
          elapsedMs: Date.now() - operationStartedAt,
          ...(recoveredFrom ? { recoveredFrom } : {}),
          ambiguousBillingAttempts,
          attemptOutcomes: structuredClone(attemptOutcomes),
        },
      };
    } catch (cause) {
      const normalized = normalizeProviderCallError(cause);
      const error = new ProviderCallError({ ...normalized.details, ...identity, ...(receivedEvidence ? { responseEvidence: receivedEvidence } : {}) }, { cause: normalized });
      const evidence = parseProviderResponseEvidence(error.details.responseEvidence);
      const outcome = dispatchStarted ? classifyProviderAttempt(error.details) : "not_dispatched";
      attemptOutcomes.push({ ...identity, ...(error.details.transportRequestId ? { transportRequestId: error.details.transportRequestId } : {}), outcome, validation: responseReturned ? "accepted" : evidence ? "rejected" : "not_evaluated", ...(evidence ? { responseEvidence: evidence } : {}) });
      if (input.signal?.aborted || (cause instanceof DOMException && cause.name === "AbortError")) throw attachOutcomes(cause);
      if (["response_body_read", "response_body_decode", "invalid_provider_json"].includes(error.details.code)) {
        ambiguousBillingAttempts += 1;
      }
      try { await input.onAttemptFailure?.(error, context); } catch (failure) { throw attachOutcomes(failure); }
      const allowance = providerRetryAllowance(error, input.configuredRetries ?? 2);
      const failedAttemptIndex = physicalAttempts - 1;
      if (failedAttemptIndex >= allowance) {
        throw new ProviderExecutionError(error, {
          operationId: input.operationId,
          logicalRequestId,
          physicalAttempts,
          elapsedMs: Date.now() - operationStartedAt,
          ...(recoveredFrom ? { recoveredFrom } : {}),
          ambiguousBillingAttempts,
          attemptOutcomes: structuredClone(attemptOutcomes),
        });
      }
      recoveredFrom ??= error.details.code;
      const delayMs = providerRetryDelayMs(failedAttemptIndex, error, input.random);
      try { await (input.sleep ?? waitForRetry)(delayMs, input.signal); } catch (failure) { throw attachOutcomes(failure); }
    }
  }
}

export async function executeProviderChat(input: {
  config: ProviderConfig;
  modelId: string;
  messages: ProviderMessage[];
  settings: EffectiveGenerationSettings;
  timeoutMs?: number;
  signal?: AbortSignal;
  rejectResponseAfterAbort?: boolean;
  configuredRetries?: number;
  operationId?: string;
  operationKind?: OperationKind;
  attempt?: ProviderChatAttempt;
  providerRouting?: OpenRouterProviderRouting;
  endpointDiscovery?: OpenRouterEndpointDiscovery;
  capacityProtectedRouting?: boolean;
  streamWorkflowContext?: StreamWorkflowContext;
  onStreamEvent?: (event: ProviderStreamEvent) => void;
  internalOnStreamEvent?: (event: ProviderStreamEvent) => void;
  onAttemptFailure?: ExecuteProviderRequestInput<ProviderChatResponse>["onAttemptFailure"];
  onAttemptStart?: ExecuteProviderRequestInput<ProviderChatResponse>["onAttemptStart"];
}): Promise<ProviderChatResponse> {
  input.signal?.throwIfAborted();
  const attempt = input.attempt ?? providerChatAttempt;
  if ((attempt as ProviderChatAttempt & { [PROVIDER_EXECUTOR_BRAND]?: boolean })[PROVIDER_EXECUTOR_BRAND]) {
    throw new Error("Nested provider retry executor detected. Pass a one-attempt transport callback instead.");
  }
  // Capture the logical payload once. Every physical retry receives the same
  // model, messages and settings, even if a caller later mutates its arrays.
  const messages = input.messages.map((message) => ({
    ...message,
    ...(message.images ? { images: message.images.map((image) => ({ ...image })) } : {}),
    ...(message.continuationState ? { continuationState: structuredClone(message.continuationState) } : {}),
  }));
  const settings = structuredClone(input.settings);
  const dispatch = await resolveEffectiveRequestEnvelope({
    config: input.config,
    modelId: input.modelId,
    messages,
    settings,
    timeoutMs: input.timeoutMs,
    operationId: input.operationId,
    operationKind: input.operationKind,
    providerRouting: input.providerRouting ? structuredClone(input.providerRouting) : undefined,
    endpointDiscovery: input.config.provider === "openrouter"
      ? input.endpointDiscovery ?? ((modelId) => discoverOpenRouterModelEndpoints(input.config, modelId))
      : undefined,
    capacityProtectedRouting: input.capacityProtectedRouting,
    streamWorkflowContext: input.streamWorkflowContext,
  });
  const providerRouting = dispatch.providerRouting;
  const timeoutPolicy = dispatch.timeoutPolicy;
  const transportEnvelope = dispatch.envelope;
  const openRouterRoutingMode = dispatch.endpointRoutingMode;
  if (dispatch.localStopMessage) {
    throw new ProviderCallError({
      code: "configuration",
      message: dispatch.localStopMessage,
      phase: "before_dispatch",
    });
  }
  const presentLiveStream = transportEnvelope.presentationMode === "live" && Boolean(input.onStreamEvent);
  const internalStreamHandler = input.internalOnStreamEvent || presentLiveStream
    ? (event: ProviderStreamEvent) => {
        if (input.signal?.aborted) return;
        input.internalOnStreamEvent?.(event);
        if (presentLiveStream) input.onStreamEvent?.(event);
      }
    : undefined;
  let result: ProviderExecutionResult<ProviderChatResponse>;
  try {
    result = await executeProviderRequest({
      operationId: input.operationId ?? "provider.chat",
      configuredRetries: input.configuredRetries,
      signal: input.signal,
      rejectResponseAfterAbort: input.rejectResponseAfterAbort,
      onAttemptFailure: input.onAttemptFailure,
      onAttemptStart: input.onAttemptStart,
      responseEvidence: response => response.responseEvidence,
      executeAttempt: () => attempt({
        config: input.config,
        modelId: input.modelId,
        messages: messages.map((message) => ({
          ...message,
          ...(message.images ? { images: message.images.map((image) => ({ ...image })) } : {}),
          ...(message.continuationState ? { continuationState: structuredClone(message.continuationState) } : {}),
        })),
        settings: structuredClone(settings),
        timeoutMs: input.timeoutMs,
        timeoutPolicy: structuredClone(timeoutPolicy),
        signal: input.signal,
        providerRouting: providerRouting ? structuredClone(providerRouting) : undefined,
        transportEnvelope: structuredClone(transportEnvelope),
        ...(internalStreamHandler ? { onStreamEvent: internalStreamHandler } : {}),
      }),
    });
  } catch (cause) {
    if (
      input.config.provider === "openrouter"
      && openRouterRoutingMode === "unknown_attempt"
      && cause instanceof ProviderExecutionError
      && (
        cause.causeError.details.httpStatus === 413
        || isOpenRouterContextCapacityError([
          cause.causeError.details.message,
          cause.causeError.details.providerCode,
          cause.causeError.details.providerErrorType,
        ].filter(Boolean).join(" "))
      )
    ) {
      throw new ProviderExecutionError(new ProviderCallError({
        ...cause.causeError.details,
        message: OPENROUTER_UNKNOWN_CAPACITY_ERROR,
      }, { cause: cause.causeError }), cause.report);
    }
    throw cause;
  }
  return { ...result.value, execution: result.report };
}

export function createProviderChatExecutor(options: {
  configuredRetries?: number | (() => number);
  operationId?: string;
  operationKind?: OperationKind;
  attempt?: ProviderChatAttempt;
  endpointDiscovery?: OpenRouterEndpointDiscovery;
  capacityProtectedRouting?: boolean;
  streamWorkflowContext?: StreamWorkflowContext;
  onAttemptFailure?: ExecuteProviderRequestInput<ProviderChatResponse>["onAttemptFailure"];
}): ProviderChatAttempt {
  const executor: ProviderChatAttempt & { [PROVIDER_EXECUTOR_BRAND]?: boolean } = (request) => executeProviderChat({
    ...request,
    configuredRetries: typeof options.configuredRetries === "function" ? options.configuredRetries() : options.configuredRetries,
    operationId: options.operationId,
    operationKind: options.operationKind,
    attempt: options.attempt,
    endpointDiscovery: options.endpointDiscovery,
    capacityProtectedRouting: options.capacityProtectedRouting,
    streamWorkflowContext: options.streamWorkflowContext,
    onAttemptFailure: options.onAttemptFailure,
  });
  executor[PROVIDER_EXECUTOR_BRAND] = true;
  return executor;
}

async function waitForRetry(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw providerAbortFromSignal(signal);
  await new Promise<void>((resolve, reject) => {
    const finish = () => signal?.removeEventListener("abort", abort);
    const timer = globalThis.setTimeout(() => {
      finish();
      resolve();
    }, milliseconds);
    const abort = () => {
      globalThis.clearTimeout(timer);
      finish();
      reject(signal?.aborted ? providerAbortFromSignal(signal) : new DOMException("Provider request cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}
