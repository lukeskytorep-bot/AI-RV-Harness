import type { ProviderKind } from "./types";
import type { ProviderUsage } from "./types";

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
  usage?: ProviderUsage;
  reasoning?: {
    source: string;
    characterCount: number;
    detailCount: number;
  };
  error?: string;
}

const MAX_ENTRIES = 30;
const entries: ProviderDebugEntry[] = [];
let detailedDiagnostics = false;

export function detailedProviderDiagnosticsEnabled(): boolean {
  return detailedDiagnostics;
}

export function setDetailedProviderDiagnostics(enabled: boolean): void {
  detailedDiagnostics = enabled;
}

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
