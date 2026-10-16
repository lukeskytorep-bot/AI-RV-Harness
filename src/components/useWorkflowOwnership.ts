import { useEffect, useState } from "react";
import type { AppRepository } from "../storage/repository";

type Ownership = "idle" | "local" | "other" | "unknown";
type Listener = (state: Ownership) => void;
type Watch = { subscribe(listener: Listener): () => void };
const watches = new WeakMap<AppRepository, Map<string, Watch>>();
const visibleDelay = 2_000;
const hiddenDelay = 10_000;

/** UI availability only. Native heartbeats and transactional write/dispatch fences remain authoritative. */
function watchOwnership(repository: AppRepository, profileId: string): Watch {
  let profiles = watches.get(repository);
  if (!profiles) { profiles = new Map(); watches.set(repository, profiles); }
  const existing = profiles.get(profileId);
  if (existing) return existing;
  const listeners = new Set<Listener>();
  let state: Ownership = "unknown", closed = false, inFlight = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const schedule = () => {
    clear();
    if (!closed) timer = setTimeout(() => void refresh(), document.hidden ? hiddenDelay : visibleDelay);
  };
  const refresh = async () => {
    if (closed || inFlight) return;
    clear(); inFlight = true;
    try {
      const next = await Promise.resolve().then(() => closed ? undefined : repository.getWorkflowOwnership(profileId)).catch(() => "unknown" as const);
      if (!closed && next !== undefined) { state = next; for (const listener of listeners) listener(state); }
    } finally {
      inFlight = false;
      if (!closed) schedule();
      else if (profiles.get(profileId) === watch) profiles.delete(profileId);
    }
  };
  const visible = () => { if (!document.hidden) void refresh(); else if (!inFlight) schedule(); };
  const focus = () => { if (!document.hidden) void refresh(); };
  const watch: Watch = { subscribe(listener) {
    if (closed) { closed = false; state = "unknown"; }
    listeners.add(listener); listener(state);
    if (listeners.size === 1) {
      document.addEventListener("visibilitychange", visible);
      window.addEventListener("focus", focus);
      void refresh();
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size) return;
      closed = true; clear();
      // Retain a pending read for an immediate remount of the same Profile.
      if (!inFlight) profiles.delete(profileId);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", focus);
    };
  } };
  profiles.set(profileId, watch);
  return watch;
}

export function useWorkflowOwnership(repository: AppRepository | null | undefined, profileId: string | undefined) {
  const [state, setState] = useState<Ownership>("unknown");
  useEffect(() => {
    setState("unknown");
    if (!repository?.getWorkflowOwnership || !profileId) return;
    return watchOwnership(repository, profileId).subscribe(setState);
  }, [repository, profileId]);
  return { state, unavailable: state === "other" || state === "unknown" };
}
