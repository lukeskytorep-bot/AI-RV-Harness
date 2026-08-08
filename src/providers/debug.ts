import type { ProviderKind } from "./types";

export interface ProviderDebugEntry {
  id: string;
  capturedAt: string;
  provider: ProviderKind;
  modelId: string;
  status: "ok" | "error";
  providerRequestId?: string;
  endpoint?: string;
  request?: unknown;
  response?: unknown;
  error?: string;
}

const MAX_ENTRIES = 30;
const entries: ProviderDebugEntry[] = [];

export function recordProviderDebug(entry: Omit<ProviderDebugEntry, "id" | "capturedAt">): void {
  entries.unshift({ ...entry, id: crypto.randomUUID(), capturedAt: new Date().toISOString() });
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
}

export function listProviderDebug(): ProviderDebugEntry[] {
  return entries.map((entry) => structuredClone(entry));
}

export function clearProviderDebug(): void {
  entries.length = 0;
}
