import { CONTINUATION_LIMITS_V1, validateProviderContinuationState } from "../providers/continuationContract";
import type { ProviderMessage } from "../providers/types";

export const DEFAULT_UNKNOWN_OUTPUT_LIMIT = 8192;
export const IMAGE_TOKEN_RESERVE = 2048;
export const TOKENIZER_SAFETY_FACTOR = 1.15;
// Continuation payloads can contain signatures/encrypted/base64-like high-entropy data.
// Estimate them more conservatively than natural-language text: 2 UTF-8 bytes/token,
// then add a 25% safety margin. This is a preflight guard, not a billing tokenizer.
export const CONTINUATION_BYTES_PER_TOKEN = 2;
export const CONTINUATION_TOKEN_SAFETY_FACTOR = 1.25;

export interface ContextBudget {
  estimatedInputTokens: number;
  reservedOutputTokens: number;
  estimatedTotalTokens: number;
  contextLimit?: number;
  remainingTokens?: number;
  percent?: number;
  level: "unknown" | "safe" | "warning" | "critical" | "exceeded";
  exceeded: boolean;
  imageCount: number;
  continuationStateBytes: number;
  estimatedContinuationTokens: number;
}

export interface ContextBudgetOptions {
  additionalContinuationStateBytes?: number;
}

function continuationStateBytes(messages: ProviderMessage[]): number {
  return messages.reduce((total, message) => {
    if (!message.continuationState) return total;
    const checked = validateProviderContinuationState(message.continuationState);
    return total + (checked.ok ? checked.sizeBytes : CONTINUATION_LIMITS_V1.maxStateBytes);
  }, 0);
}

export function estimateContextBudget(
  messages: ProviderMessage[],
  contextLimit: number | undefined,
  reservedOutputTokens: number,
  options: ContextBudgetOptions = {},
): ContextBudget {
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
  const estimatedInputTokens = textTokens + imageCount * IMAGE_TOKEN_RESERVE + estimatedContinuationTokens;
  const reserved = Math.max(1, Math.floor(reservedOutputTokens));
  const estimatedTotalTokens = estimatedInputTokens + reserved;
  if (!contextLimit || contextLimit <= 0) {
    return {
      estimatedInputTokens,
      reservedOutputTokens: reserved,
      estimatedTotalTokens,
      level: "unknown",
      exceeded: false,
      imageCount,
      continuationStateBytes: continuationBytes,
      estimatedContinuationTokens,
    };
  }
  const percent = Math.ceil((estimatedTotalTokens / contextLimit) * 100);
  const exceeded = estimatedTotalTokens > contextLimit;
  const level = exceeded ? "exceeded" : percent >= 90 ? "critical" : percent >= 75 ? "warning" : "safe";
  return {
    estimatedInputTokens,
    reservedOutputTokens: reserved,
    estimatedTotalTokens,
    contextLimit,
    remainingTokens: Math.max(0, contextLimit - estimatedTotalTokens),
    percent,
    level,
    exceeded,
    imageCount,
    continuationStateBytes: continuationBytes,
    estimatedContinuationTokens,
  };
}
