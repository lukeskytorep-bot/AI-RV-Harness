import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../storage";
import { normalizeModelDiscovery } from "./capabilities";
import { recordProviderDebug } from "./debug";
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
}): Promise<ProviderChatResponse> {
  requireDesktop();
  let response: NativeChatResponse;
  try {
    response = await invoke<NativeChatResponse>("provider_chat", {
      request: {
        ...nativeConfig(input.config),
        modelId: input.modelId,
        messages: input.messages,
        reasoningEffort: input.settings.effective.reasoningEffort,
        temperature: input.settings.effective.temperature,
        maxOutputTokens: input.settings.effective.maxOutputTokens,
        timeoutMs: input.timeoutMs,
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
  }
  recordProviderDebug({
    provider: input.config.provider,
    modelId: input.modelId,
    status: "ok",
    providerRequestId: response.provider_request_id ?? undefined,
    endpoint: response.debug_payload?.endpoint,
    request: response.debug_payload?.request,
    response: response.debug_payload?.response,
  });
  return {
    content: response.content,
    finishReason: response.finish_reason ?? undefined,
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
