import { Channel, invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../storage";
import { normalizeModelDiscovery } from "./capabilities";
import type { EffectiveRequestEnvelope } from "./effectiveRequestEnvelope";
import { detailedProviderDiagnosticsEnabled, recordProviderDebug } from "./debug";
import { normalizeProviderCallError } from "./providerError";
import type {
  EffectiveGenerationSettings,
  ProviderChatResponse,
  ProviderConfig,
  ProviderKind,
  ProviderMessage,
  ProviderModel,
  ProviderStreamEvent,
  OpenRouterProviderRouting,
} from "./types";
import type { ProviderTimeoutPolicy } from "./streamingPolicy";

type NativeChatResponse = {
  content: string;
  reasoning_content?: string | null;
  reasoning_details?: unknown[] | null;
  reasoning_source?: string | null;
  finish_reason?: string | null;
  actual_model?: string | null;
  usage?: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    reasoning_tokens?: number | null;
    total_tokens?: number | null;
    cost_usd?: number | null;
  };
  provider_request_id?: string | null;
  actual_provider?: string | null;
  debug_payload?: {
    endpoint: string;
    request: unknown;
    response: unknown;
  } | null;
};

function requireDesktop(): void {
  if (!isTauriRuntime()) throw new Error("Provider operations require the desktop runtime.");
}

export async function storeCredentialSecret(
  credentialId: string,
  secret: string,
  provider: ProviderKind,
  baseUrl?: string,
): Promise<void> {
  requireDesktop();
  await invoke("store_credential", { credentialId, secret, provider, baseUrl });
}

export async function rebindCredentialSecret(
  credentialId: string,
  secret: string,
  provider: ProviderKind,
  baseUrl?: string,
): Promise<void> {
  requireDesktop();
  await invoke("rebind_credential", { credentialId, secret, provider, baseUrl });
}

export async function deleteCredentialSecret(credentialId: string): Promise<void> {
  requireDesktop();
  await invoke("delete_credential", { credentialId });
}

export async function hasCredentialSecret(credentialId: string): Promise<boolean> {
  requireDesktop();
  return invoke<boolean>("has_credential", { credentialId });
}

export async function credentialIdentityFingerprint(credentialId: string): Promise<string> {
  requireDesktop();
  return invoke<string>("credential_identity_fingerprint", { credentialId });
}


export async function providerBindingEndpoint(config: ProviderConfig): Promise<string> {
  requireDesktop();
  return invoke<string>("provider_binding_endpoint", { provider: config.provider, baseUrl: config.baseUrl });
}

export async function discoverModels(config: ProviderConfig): Promise<ProviderModel[]> {
  requireDesktop();
  const payload = await invoke<unknown>("provider_discover_models", {
    request: nativeConfig(config),
  });
  return normalizeModelDiscovery(config, payload);
}

export async function discoverOpenRouterModelEndpoints(config: ProviderConfig, modelId: string): Promise<unknown> {
  requireDesktop();
  if (config.provider !== "openrouter") throw new Error("Endpoint capability discovery is available only for OpenRouter.");
  return invoke<unknown>("provider_discover_model_endpoints", {
    request: { ...nativeConfig(config), modelId },
  });
}

/** One physical HTTP attempt. Domain code must use requestExecutor instead. */
export async function providerChatAttempt(input: {
  config: ProviderConfig;
  modelId: string;
  messages: ProviderMessage[];
  settings: EffectiveGenerationSettings;
  timeoutMs?: number;
  timeoutPolicy?: ProviderTimeoutPolicy;
  signal?: AbortSignal;
  providerRouting?: OpenRouterProviderRouting;
  onStreamEvent?: (event: ProviderStreamEvent) => void;
  transportEnvelope?: EffectiveRequestEnvelope;
}): Promise<ProviderChatResponse> {
  requireDesktop();
  if (input.signal?.aborted) throw new DOMException("Provider request cancelled", "AbortError");
  const requestId = crypto.randomUUID();
  const cancel = () => {
    void invoke("cancel_provider_request", { requestId }).catch(() => undefined);
  };
  input.signal?.addEventListener("abort", cancel, { once: true });
  const onStream = new Channel<ProviderStreamEvent>();
  onStream.onmessage = input.onStreamEvent ?? (() => {});
  let response: NativeChatResponse;
  try {
    response = await invoke<NativeChatResponse>("provider_chat", {
      request: {
        ...nativeConfig(input.config),
        providerConfigId: input.config.id,
        requestId,
        modelId: input.modelId,
        messages: input.messages,
        reasoningEffort: input.settings.effective.reasoningEffort,
        reasoningTransportKind: input.settings.reasoningResolution?.transport.kind,
        reasoningTransportValue: input.settings.reasoningResolution?.transport.value,
        temperature: input.settings.effective.temperature,
        maxOutputTokens: input.settings.effective.maxOutputTokens,
        ...(input.config.provider === "custom_openai" && input.config.customOutputTokenField ? { customOutputTokenField: input.config.customOutputTokenField } : {}),
        timeoutMs: input.timeoutMs,
        timeoutPolicy: input.timeoutPolicy,
        detailedDiagnostics: detailedProviderDiagnosticsEnabled(),
        providerRouting: input.providerRouting,
      },
      onStream,
      emitStreamEvents: Boolean(input.onStreamEvent),
    });
  } catch (cause) {
    const normalized = normalizeProviderCallError(cause);
    recordProviderDebug({
      provider: input.config.provider,
      modelId: input.modelId,
      status: "error",
      error: normalized.message,
      ...(input.transportEnvelope ? { transport: structuredClone(input.transportEnvelope) } : {}),
    });
    throw normalized;
  } finally {
    input.signal?.removeEventListener("abort", cancel);
  }
  recordProviderDebug({
    provider: input.config.provider,
    modelId: input.modelId,
    status: "ok",
    providerRequestId: response.provider_request_id ?? undefined,
    endpoint: response.debug_payload?.endpoint,
    request: response.debug_payload?.request,
    response: response.debug_payload?.response,
    usage: {
      inputTokens: response.usage?.input_tokens ?? undefined,
      outputTokens: response.usage?.output_tokens ?? undefined,
      reasoningTokens: response.usage?.reasoning_tokens ?? undefined,
      totalTokens: response.usage?.total_tokens ?? undefined,
      costUsd: response.usage?.cost_usd ?? undefined,
    },
    reasoning: response.reasoning_content ? {
      source: response.reasoning_source ?? "unavailable",
      characterCount: response.reasoning_content.length,
      detailCount: response.reasoning_details?.length ?? 0,
    } : undefined,
    ...(input.transportEnvelope ? { transport: structuredClone(input.transportEnvelope) } : {}),
  });
  return {
    content: response.content,
    reasoningContent: response.reasoning_content ?? undefined,
    reasoningDetails: response.reasoning_details ?? undefined,
    reasoningSource: response.reasoning_source ?? undefined,
    finishReason: response.finish_reason ?? undefined,
    actualModel: response.actual_model ?? undefined,
    usage: {
      inputTokens: response.usage?.input_tokens ?? undefined,
      outputTokens: response.usage?.output_tokens ?? undefined,
      reasoningTokens: response.usage?.reasoning_tokens ?? undefined,
      totalTokens: response.usage?.total_tokens ?? undefined,
      costUsd: response.usage?.cost_usd ?? undefined,
    },
    providerRequestId: response.provider_request_id ?? undefined,
    actualProvider: response.actual_provider ?? undefined,
  };
}

function nativeConfig(config: ProviderConfig): {
  provider: ProviderKind;
  credentialId: string;
  baseUrl?: string;
} {
  return {
    provider: config.provider,
    credentialId: config.credentialId,
    ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
  };
}
