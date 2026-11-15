import { useEffect, useLayoutEffect, useRef } from "react";
import { subscribeToTelepathicCheckpoints } from "../storage/telepathicCheckpointChanges";

const COALESCE_MS = 25;
const WORKING_FALLBACK_MS = 5000;

interface RefreshOptions<T> {
  repository: object | null;
  seriesId: string | undefined;
  workspaceId: string | undefined;
  working: boolean;
  revision: { current: number };
  read(seriesId: string): Promise<T | null>;
  apply(snapshot: T): void;
}

export function useTelepathicCheckpointRefresh<T>(options: RefreshOptions<T>) {
  const { repository, seriesId, workspaceId, working } = options;
  const latest = useRef(options);
  const previousRead = useRef<Promise<void>>(Promise.resolve());
  const refresh = useRef<(id: string) => Promise<void>>(async () => {});

  useLayoutEffect(() => { latest.current = options; });

  useLayoutEffect(() => {
    if (!repository || !seriesId || !workspaceId) return;
    let disposed = false;
    let requested = false;
    let receivedVersion = 0;
    let timer: number | undefined;
    let draining: Promise<void> | undefined;

    const start = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
      if (draining) return draining;
      const run = previousRead.current.then(async () => {
        try {
          let failure: unknown;
          let failed = false;
          while (requested && !disposed) {
            requested = false;
            const current = latest.current;
            const revision = current.revision.current;
            try {
              const snapshot = await current.read(seriesId);
              if (!disposed && current.revision.current === revision && snapshot) latest.current.apply(snapshot);
              failed = false;
            } catch (error) {
              failed = true;
              failure = error;
            }
          }
          if (failed && !disposed) throw failure;
        } finally {
          draining = undefined;
        }
      });
      draining = run;
      previousRead.current = run.catch(() => undefined);
      return run;
    };

    const refreshNow = async (id: string) => {
      if (id !== seriesId || disposed) return;
      requested = true;
      await start();
    };
    refresh.current = refreshNow;

    const recover = () => {
      requested = true;
      if (!draining && timer === undefined) {
        timer = window.setTimeout(() => { void start().catch(() => undefined); }, COALESCE_MS);
      }
    };
    const unsubscribe = subscribeToTelepathicCheckpoints(change => {
      if (change.seriesId !== seriesId || change.workspaceId !== workspaceId || change.version <= receivedVersion) return;
      receivedVersion = change.version;
      recover();
    });

    if (latest.current.working) recover(); // The first checkpoint may precede mounting the view.

    const visible = () => { if (document.visibilityState === "visible") recover(); };
    window.addEventListener("focus", recover);
    document.addEventListener("visibilitychange", visible);
    return () => {
      disposed = true;
      unsubscribe();
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener("focus", recover);
      document.removeEventListener("visibilitychange", visible);
      refresh.current = async () => {};
    };
  }, [repository, seriesId, workspaceId]);

  useEffect(() => {
    if (!repository || !seriesId || !working) return;
    const timer = window.setInterval(() => {
      void refresh.current(seriesId).catch(() => undefined);
    }, WORKING_FALLBACK_MS);
    return () => window.clearInterval(timer);
  }, [repository, seriesId, workspaceId, working]);

  return refresh;
}
