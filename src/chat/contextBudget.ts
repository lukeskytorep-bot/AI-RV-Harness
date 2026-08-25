import type { ProviderMessage } from "../providers/types";

export const DEFAULT_UNKNOWN_OUTPUT_LIMIT = 8192;
export const IMAGE_TOKEN_RESERVE = 2048;
export const TOKENIZER_SAFETY_FACTOR = 1.15;

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
}

export function estimateContextBudget(
  messages: ProviderMessage[],
  contextLimit: number | undefined,
  reservedOutputTokens: number,
): ContextBudget {
  const textCharacters = messages.reduce((total, message) => total + message.content.length, 0);
  const imageCount = messages.reduce((total, message) => total + (message.images?.length ?? 0), 0);
  const textTokens = Math.ceil((textCharacters / 3.5 + messages.length * 6) * TOKENIZER_SAFETY_FACTOR);
  const estimatedInputTokens = textTokens + imageCount * IMAGE_TOKEN_RESERVE;
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
  };
}
