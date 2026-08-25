const KEY_PREFIX = "rvh.chat.max-output.";
const memoryFallback = new Map<string, string>();

export function defaultChatOutputTokens(defaultMaximum: number, modelLimit?: number): number {
  const cleanDefault = positiveInteger(defaultMaximum) ?? 8192;
  return modelLimit ? Math.min(cleanDefault, modelLimit) : cleanDefault;
}

export function clampChatOutputTokens(value: number, modelLimit?: number): number {
  const clean = positiveInteger(value) ?? 1;
  return modelLimit ? Math.min(clean, modelLimit) : clean;
}

export function loadChatOutputTokens(threadId: string, fallback: number, modelLimit?: number): number {
  const stored = positiveInteger(Number(readValue(`${KEY_PREFIX}${threadId}`)));
  return clampChatOutputTokens(stored ?? fallback, modelLimit);
}

export function saveChatOutputTokens(threadId: string, value: number, modelLimit?: number): number {
  const clean = clampChatOutputTokens(value, modelLimit);
  writeValue(`${KEY_PREFIX}${threadId}`, String(clean));
  return clean;
}

function positiveInteger(value: number): number | undefined {
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function readValue(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? memoryFallback.get(key) ?? null;
  } catch {
    return memoryFallback.get(key) ?? null;
  }
}

function writeValue(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    memoryFallback.set(key, value);
  }
  memoryFallback.set(key, value);
}
