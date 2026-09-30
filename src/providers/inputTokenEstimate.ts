import { CONTINUATION_LIMITS_V1, validateProviderContinuationState } from "./continuationContract";
import type { ProviderMessage } from "./types";

export const IMAGE_TOKEN_RESERVE = 2048;
export const TOKENIZER_SAFETY_FACTOR = 1.15;
// Continuation payloads can contain signatures/encrypted/base64-like high-entropy data.
// Estimate them more conservatively than natural-language text: 2 UTF-8 bytes/token,
// then add a 25% safety margin. This is a preflight guard, not a billing tokenizer.
export const CONTINUATION_BYTES_PER_TOKEN = 2;
export const CONTINUATION_TOKEN_SAFETY_FACTOR = 1.25;

export interface ProviderInputTokenEstimate {
  estimatedInputTokens: number;
  imageCount: number;
  continuationStateBytes: number;
  estimatedContinuationTokens: number;
}

export interface ProviderInputTokenEstimateOptions {
  additionalContinuationStateBytes?: number;
}

function continuationStateBytes(messages: ProviderMessage[]): number {
  return messages.reduce((total, message) => {
    if (!message.continuationState) return total;
    const checked = validateProviderContinuationState(message.continuationState);
    return total + (checked.ok ? checked.sizeBytes : CONTINUATION_LIMITS_V1.maxStateBytes);
  }, 0);
}

/**
 * Central provider-input estimator shared by context preflight and endpoint routing.
 * It intentionally remains conservative and tokenizer-agnostic.
 */
export function estimateProviderInputTokens(
  messages: ProviderMessage[],
  options: ProviderInputTokenEstimateOptions = {},
): ProviderInputTokenEstimate {
  const textCharacters = messages.reduce((total, message) => total + message.content.length, 0);
  const imageCount = messages.reduce((total, message) => total + (message.images?.length ?? 0), 0);
  const textTokens = Math.ceil((textCharacters / 3.5 + messages.length * 6) * TOKENIZER_SAFETY_FACTOR);
  const extraContinuationBytes = Number.isFinite(options.additionalContinuationStateBytes)
    ? Math.max(0, Math.floor(options.additionalContinuationStateBytes ?? 0))
    : 0;
  const continuationBytes = continuationStateBytes(messages) + extraContinuationBytes;
  const estimatedContinuationTokens = continuationBytes === 0
    ? 0
    : Math.ceil((continuationBytes / CONTINUATION_BYTES_PER_TOKEN) * CONTINUATION_TOKEN_SAFETY_FACTOR);
  return {
    estimatedInputTokens: textTokens + imageCount * IMAGE_TOKEN_RESERVE + estimatedContinuationTokens,
    imageCount,
    continuationStateBytes: continuationBytes,
    estimatedContinuationTokens,
  };
}
