import { useState } from "react";

/** Human-only drafts: stable across checkpoints/reopen, isolated by round and stage. */
export function useTelepathicDraft(key: string | null): [string, (value: string) => void] {
  const [memory, setMemory] = useState<Record<string, string>>({});
  const storageKey = key ? `rvh.telepathic.draft.v1:${key}` : null;
  let value = storageKey ? memory[storageKey] : "";
  if (storageKey && value === undefined) {
    try { value = localStorage.getItem(storageKey) ?? ""; } catch { value = ""; }
  }
  return [value ?? "", next => {
    if (!storageKey) return;
    setMemory(previous => ({ ...previous, [storageKey]: next }));
    try { if (next) localStorage.setItem(storageKey, next); else localStorage.removeItem(storageKey); } catch { /* Keep the mounted draft when storage is unavailable. */ }
  }];
}
