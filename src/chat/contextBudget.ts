import {
  CONTINUATION_BYTES_PER_TOKEN,
  CONTINUATION_TOKEN_SAFETY_FACTOR,
  IMAGE_TOKEN_RESERVE,
  TOKENIZER_SAFETY_FACTOR,
  estimateProviderInputTokens,
} from "../providers/inputTokenEstimate";
import type { ProviderMessage } from "../providers/types";

export const DEFAULT_UNKNOWN_OUTPUT_LIMIT = 8192;
export { IMAGE_TOKEN_RESERVE, TOKENIZER_SAFETY_FACTOR, CONTINUATION_BYTES_PER_TOKEN, CONTINUATION_TOKEN_SAFETY_FACTOR };

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

export function estimateContextBudget(
  messages: ProviderMessage[],
  contextLimit: number | undefined,
  reservedOutputTokens: number,
  options: ContextBudgetOptions = {},
): ContextBudget {
  const input = estimateProviderInputTokens(messages, options);
  const reserved = Math.max(1, Math.floor(reservedOutputTokens));
  const estimatedTotalTokens = input.estimatedInputTokens + reserved;
  if (!contextLimit || contextLimit <= 0) {
    return {
      ...input,
      reservedOutputTokens: reserved,
      estimatedTotalTokens,
      level: "unknown",
      exceeded: false,
    };
  }
  const percent = Math.ceil((estimatedTotalTokens / contextLimit) * 100);
  const exceeded = estimatedTotalTokens > contextLimit;
  const level = exceeded ? "exceeded" : percent >= 90 ? "critical" : percent >= 75 ? "warning" : "safe";
  return {
    ...input,
    reservedOutputTokens: reserved,
    estimatedTotalTokens,
    contextLimit,
    remainingTokens: Math.max(0, contextLimit - estimatedTotalTokens),
    percent,
    level,
    exceeded,
  };
}
