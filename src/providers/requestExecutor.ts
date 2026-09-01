import { providerChatAttempt } from "./native";
import { normalizeProviderCallError, ProviderCallError } from "./providerError";
import { providerRetryAllowance, providerRetryDelayMs } from "./retry";
import type { EffectiveGenerationSettings, ProviderChatResponse, ProviderConfig, ProviderMessage } from "./types";

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
  signal?: AbortSignal;
}) => Promise<ProviderChatResponse>;

/**
 * Performs one physical attempt without retry. This is only for per-attempt
 * cost/audit wrappers that are themselves called by executeProviderChat.
 */
export function providerChatOnce(request: Parameters<ProviderChatAttempt>[0], attempt?: ProviderChatAttempt): Promise<ProviderChatResponse> {
  return (attempt ?? providerChatAttempt)(request);
}

export interface ExecuteProviderRequestInput<T> {
  operationId: string;
  configuredRetries?: number;
  signal?: AbortSignal;
  executeAttempt: (context: ProviderAttemptContext) => Promise<T>;
  onAttemptFailure?: (error: ProviderCallError, context: ProviderAttemptContext) => void | Promise<void>;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}

const activeLogicalRequests = new Set<string>();
const PROVIDER_EXECUTOR_BRAND = Symbol("provider-request-executor");

export async function executeProviderRequest<T>(input: ExecuteProviderRequestInput<T>): Promise<ProviderExecutionResult<T>> {
  const logicalRequestId = crypto.randomUUID();
  if (activeLogicalRequests.has(logicalRequestId)) throw new Error(`Nested provider retry context detected: ${logicalRequestId}`);
  activeLogicalRequests.add(logicalRequestId);
  const operationStartedAt = Date.now();
  let physicalAttempts = 0;
  let ambiguousBillingAttempts = 0;
  let recoveredFrom: string | undefined;

  try {
    while (true) {
      if (input.signal?.aborted) throw new DOMException("Provider request cancelled", "AbortError");
      const context: ProviderAttemptContext = {
        operationId: input.operationId,
        logicalRequestId,
        physicalAttempt: physicalAttempts + 1,
        startedAtMs: Date.now(),
      };
      physicalAttempts += 1;
      try {
        const value = await input.executeAttempt(context);
        return {
          value,
          report: {
            operationId: input.operationId,
            logicalRequestId,
            physicalAttempts,
            elapsedMs: Date.now() - operationStartedAt,
            ...(recoveredFrom ? { recoveredFrom } : {}),
            ambiguousBillingAttempts,
          },
        };
      } catch (cause) {
        if (input.signal?.aborted || (cause instanceof DOMException && cause.name === "AbortError")) throw cause;
        const error = normalizeProviderCallError(cause);
        if (["response_body_read", "response_body_decode", "invalid_provider_json"].includes(error.details.code)) {
          ambiguousBillingAttempts += 1;
        }
        await input.onAttemptFailure?.(error, context);
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
          });
        }
        recoveredFrom ??= error.details.code;
        const delayMs = providerRetryDelayMs(failedAttemptIndex, error, input.random);
        await (input.sleep ?? waitForRetry)(delayMs, input.signal);
      }
    }
  } finally {
    activeLogicalRequests.delete(logicalRequestId);
  }
}

export async function executeProviderChat(input: {
  config: ProviderConfig;
  modelId: string;
  messages: ProviderMessage[];
  settings: EffectiveGenerationSettings;
  timeoutMs?: number;
  signal?: AbortSignal;
  configuredRetries?: number;
  operationId?: string;
  attempt?: ProviderChatAttempt;
  onAttemptFailure?: ExecuteProviderRequestInput<ProviderChatResponse>["onAttemptFailure"];
}): Promise<ProviderChatResponse> {
  const attempt = input.attempt ?? providerChatAttempt;
  if ((attempt as ProviderChatAttempt & { [PROVIDER_EXECUTOR_BRAND]?: boolean })[PROVIDER_EXECUTOR_BRAND]) {
    throw new Error("Nested provider retry executor detected. Pass a one-attempt transport callback instead.");
  }
  // Capture the logical payload once. Every physical retry receives the same
  // model, messages and settings, even if a caller later mutates its arrays.
  const messages = input.messages.map((message) => ({
    ...message,
    ...(message.images ? { images: message.images.map((image) => ({ ...image })) } : {}),
  }));
  const settings = structuredClone(input.settings);
  const result = await executeProviderRequest({
    operationId: input.operationId ?? "provider.chat",
    configuredRetries: input.configuredRetries,
    signal: input.signal,
    onAttemptFailure: input.onAttemptFailure,
    executeAttempt: () => attempt({
      config: input.config,
      modelId: input.modelId,
      messages,
      settings,
      timeoutMs: input.timeoutMs,
      signal: input.signal,
    }),
  });
  return { ...result.value, execution: result.report };
}

export function createProviderChatExecutor(options: {
  configuredRetries?: number;
  operationId?: string;
  attempt?: ProviderChatAttempt;
  onAttemptFailure?: ExecuteProviderRequestInput<ProviderChatResponse>["onAttemptFailure"];
}): ProviderChatAttempt {
  const executor: ProviderChatAttempt & { [PROVIDER_EXECUTOR_BRAND]?: boolean } = (request) => executeProviderChat({
    ...request,
    configuredRetries: options.configuredRetries,
    operationId: options.operationId,
    attempt: options.attempt,
    onAttemptFailure: options.onAttemptFailure,
  });
  executor[PROVIDER_EXECUTOR_BRAND] = true;
  return executor;
}

async function waitForRetry(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException("Provider request cancelled", "AbortError");
  await new Promise<void>((resolve, reject) => {
    const finish = () => signal?.removeEventListener("abort", abort);
    const timer = globalThis.setTimeout(() => {
      finish();
      resolve();
    }, milliseconds);
    const abort = () => {
      globalThis.clearTimeout(timer);
      finish();
      reject(new DOMException("Provider request cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}
