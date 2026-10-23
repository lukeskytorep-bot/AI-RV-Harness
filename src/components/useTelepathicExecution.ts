import { useEffect, useRef, useState } from "react";
import type { TelepathicExchangeRepository } from "../storage/contracts/telepathicExchangeRepository";
import { telepathicExecutionPresentation, type TelepathicLeaseState, type TelepathicLocalExecution, type TelepathicCallPresentation } from "../telepathicExchange/executionPresentation";
import type { TelepathicSeriesState } from "../telepathicExchange/types";

/** Capture the engine's first durable read under its lease, without another SQL
 * read. The displayed checkpoint may lag behind work done by another window. */
export function telepathicExecutionStore(repository: TelepathicExchangeRepository,
  onBaseline: (seriesId: string, callIds: string[]) => void): TelepathicExchangeRepository {
  let captured = false;
  const getSeries = async (seriesId: string) => {
    const state = await repository.getTelepathicSeries(seriesId);
    if (!captured && state) {
      captured = true;
      onBaseline(seriesId, state.providerCalls.map(call => call.id));
    }
    return state;
  };
  return new Proxy(repository, { get(target, key) {
    if (key === "telepathicRecoveryOwner") return repository.telepathicRecoveryOwner ?? repository;
    if (key === "getTelepathicSeries") return getSeries;
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

export function useTelepathicExecution(repository: TelepathicExchangeRepository | null, series: {
  config: { seriesId: string }; status: TelepathicSeriesState["status"]; archivedAt?: string; updatedAt: string;
} | null, calls: Array<{ id: string; status: TelepathicSeriesState["providerCalls"][number]["status"] }>, execution: TelepathicLocalExecution | null,
  onOtherOwnerReleased?: (seriesId: string, isCurrent: () => boolean) => Promise<void>,
  onIdle?: (seriesId: string) => Promise<void>) {
  const seriesId = series?.config.seriesId;
  const [checked, setChecked] = useState<{ seriesId: string; execution: TelepathicLocalExecution | null; lease: TelepathicLeaseState } | null>(null);
  const previousOwner = useRef<{ repository: TelepathicExchangeRepository; seriesId: string; external: boolean } | null>(null);
  const refresh = useRef(onOtherOwnerReleased);
  refresh.current = onOtherOwnerReleased;
  const idle = useRef(onIdle);
  idle.current = onIdle;
  useEffect(() => {
    if (!repository || !seriesId || series?.archivedAt) return;
    let cancelled = false, reading = false;
    const check = async () => {
      if (reading) return;
      reading = true;
      let lease: TelepathicLeaseState = "unknown";
      try {
        if (repository.getTelepathicSeriesLeaseState) lease = await repository.getTelepathicSeriesLeaseState(seriesId);
        else if (execution?.seriesId === seriesId) {
          await repository.assertTelepathicSeriesLease(seriesId); lease = "local";
        } else {
          // Legacy adapters have no ownership projection. Verify availability
          // through their existing lease protocol; a failed probe stays unknown.
          await repository.withTelepathicSeriesLease(seriesId, async () => undefined); lease = "idle";
        }
        if (cancelled) return;
        const external = lease === "other" || (lease === "local" && execution?.seriesId !== seriesId);
        const previous = previousOwner.current;
        if (lease === "idle" && previous?.repository === repository && previous.seriesId === seriesId && previous.external) {
          // A stale dispatched checkpoint must not become a recovery alarm when
          // the other window has just accepted its response. Reload detail first.
          setChecked({ seriesId, execution, lease: "unknown" });
          await refresh.current?.(seriesId, () => !cancelled);
        }
        if (!cancelled) previousOwner.current = { repository, seriesId, external };
      } catch { lease = "unknown"; /* Fail closed, including failed detail refresh. */ }
      if (!cancelled) setChecked({ seriesId, execution, lease });
      if (!cancelled && lease === "idle") {
        try { await idle.current?.(seriesId); } catch { /* The operation owns its error presentation. */ }
      }
      reading = false;
    };
    void check();
    const timer = window.setInterval(() => void check(), 750);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [repository, seriesId, series?.archivedAt, execution]);
  const lease = checked && checked.seriesId === seriesId && checked.execution === execution ? checked.lease : "unknown";
  const presentation = series ? telepathicExecutionPresentation({ seriesId: series.config.seriesId,
    status: series.status, archivedAt: series.archivedAt, calls, execution, lease }) : "idle";
  const callPresentation: Record<string, TelepathicCallPresentation> = {};
  if (["waiting", "other", "checking", "working"].includes(presentation)) {
    for (const call of calls) {
      if (call.status === "dispatched") callPresentation[call.id] = presentation === "waiting" ? "waiting" : presentation === "other" ? "other" : "checking";
    }
  }
  return { presentation, callPresentation, unavailable: presentation === "other" || presentation === "checking" };
}

/** Reuse the existing ownership tick; do not add another polling loop. Route
 * inspections back off to 30 s and never grant another provider attempt. */
export function createTelepathicConfigurationCheckSchedule() {
  let seriesId: string | undefined, nextAt = 0, attempts = 0;
  return {
    reset() { seriesId = undefined; nextAt = 0; attempts = 0; },
    due(id: string, at = Date.now()) {
      if (id !== seriesId) { seriesId = id; nextAt = 0; attempts = 0; }
      if (at < nextAt) return false;
      nextAt = at + Math.min(30_000, 1000 * 2 ** Math.min(attempts++, 5));
      return true;
    },
  };
}
