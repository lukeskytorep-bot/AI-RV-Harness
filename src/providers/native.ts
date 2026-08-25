import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../storage";
import { normalizeModelDiscovery } from "./capabilities";
import { detailedProviderDiagnosticsEnabled, recordProviderDebug } from "./debug";
import type {
  EffectiveGenerationSettings,
  ProviderChatResponse,
  ProviderConfig,
  ProviderKind,
  ProviderMessage,
  ProviderModel,
} from "./types";

type NativeChatResponse = {
  content: string;
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
  debug_payload?: {
    endpoint: string;
    request: unknown;
    response: unknown;
  } | null;
};

function requireDesktop(): void {
  if (!isTauriRuntime()) throw new Error("Provider operations require the desktop runtime.");
}

export async function storeCredentialSecret(credentialId: string, secret: string): Promise<void> {
  requireDesktop();
  await invoke("store_credential", { credentialId, secret });
}

export async function deleteCredentialSecret(credentialId: string): Promise<void> {
  requireDesktop();
  await invoke("delete_credential", { credentialId });
}

export async function hasCredentialSecret(credentialId: string): Promise<boolean> {
  requireDesktop();
  return invoke<boolean>("has_credential", { credentialId });
}

export async function discoverModels(config: ProviderConfig): Promise<ProviderModel[]> {
  requireDesktop();
  const payload = await invoke<unknown>("provider_discover_models", {
    request: nativeConfig(config),
  });
  return normalizeModelDiscovery(config, payload);
}

export async function providerChat(input: {
  config: ProviderConfig;
  modelId: string;
  messages: ProviderMessage[];
  settings: EffectiveGenerationSettings;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<ProviderChatResponse> {
  requireDesktop();
  if (input.signal?.aborted) throw new DOMException("Provider request cancelled", "AbortError");
  const requestId = crypto.randomUUID();
  const cancel = () => {
    void invoke("cancel_provider_request", { requestId }).catch(() => undefined);
  };
  input.signal?.addEventListener("abort", cancel, { once: true });
  let response: NativeChatResponse;
  try {
    response = await invoke<NativeChatResponse>("provider_chat", {
      request: {
        ...nativeConfig(input.config),
        requestId,
        modelId: input.modelId,
        messages: input.messages,
        reasoningEffort: input.settings.effective.reasoningEffort,
        reasoningTransportKind: input.settings.reasoningResolution?.transport.kind,
        reasoningTransportValue: input.settings.reasoningResolution?.transport.value,
        temperature: input.settings.effective.temperature,
        maxOutputTokens: input.settings.effective.maxOutputTokens,
        timeoutMs: input.timeoutMs,
        detailedDiagnostics: detailedProviderDiagnosticsEnabled(),
      },
    });
  } catch (cause) {
    recordProviderDebug({
      provider: input.config.provider,
      modelId: input.modelId,
      status: "error",
      error: cause instanceof Error ? cause.message : String(cause),
    });
    throw cause;
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
  });
  return {
    content: response.content,
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
