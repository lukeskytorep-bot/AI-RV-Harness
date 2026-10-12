import type { telepathicRuntimeMetrics } from "../telepathicExchange/runtimeMetrics";

interface Props { metrics: ReturnType<typeof telepathicRuntimeMetrics>; pl: boolean; }

/** The RV metric tiles, with Telepathy's missing-data and request-time semantics. */
export function TelepathicMetrics({ metrics: m, pl }: Props) {
  const missing = (count: number) => pl ? `brak pełnych danych: ${count} wywołań` : `missing complete data: ${count} calls`;
  const unavailable = pl ? "brak danych" : "unavailable";
  const source = (estimated: boolean) => estimated ? (pl ? "szacunkowy" : "estimated") : (pl ? "zgłoszony przez dostawcę" : "provider-reported");
  const costUnavailable = m.calls > 0 && !m.costReports;
  return <div className="session-run-metrics telepathic-runtime-metrics" role="group" aria-label={pl ? "Metryki wywołań" : "Request metrics"}>
    <span><small>{pl ? "Wywołania" : "Calls"}</small><strong>{m.calls}</strong></span>
    <span><small>{pl ? "Tokeny" : "Tokens"}</small><strong>{m.tokens === null ? unavailable : m.tokens}</strong>
      {m.tokens !== null && m.tokensMissing > 0 && <span className="session-run-metric-note">{pl ? "znana suma" : "known subtotal"} · {missing(m.tokensMissing)}</span>}
    </span>
    <span><small>{pl ? "Koszt" : "Cost"}</small><strong>{costUnavailable ? unavailable : `$${m.costUsd.toFixed(4)}`}</strong>
      {!costUnavailable && m.calls > 0 && <span className="session-run-metric-note">{m.costSource === "incomplete"
        ? `${pl ? "znana suma" : "known subtotal"} · ${source(m.knownCostSource === "estimated")} · ${missing(m.costMissing)}`
        : source(m.costSource === "estimated")}</span>}
    </span>
    <span><small>{pl ? "Czas wywołań" : "Request time"}</small><strong>{(m.activeElapsedMs / 1000).toFixed(1)} s</strong></span>
  </div>;
}
