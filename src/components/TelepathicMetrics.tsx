import type { telepathicRuntimeMetrics } from "../telepathicExchange/runtimeMetrics";
interface Props { metrics: ReturnType<typeof telepathicRuntimeMetrics>; pl:boolean; }
export function TelepathicMetrics({metrics:m,pl}:Props) {
  const missing = (n:number) => pl ? `brak pełnych danych: ${n} wywołań` : `missing complete data: ${n} calls`;
  return <div className="telepathic-runtime-metrics">
    <span>{pl?"Wywołania":"Calls"}: {m.calls}</span>
    <span>{pl?"Tokeny":"Tokens"}: {m.tokens === null ? (pl?"brak danych":"unavailable") : <>{m.tokens}{m.tokensMissing > 0 && ` · ${pl?"znana suma":"known subtotal"} · ${missing(m.tokensMissing)}`}</>}</span>
    <span>{pl?"Koszt":"Cost"}: {m.calls > 0 && !m.costReports ? (pl?"brak danych":"unavailable") : <>${m.costUsd.toFixed(4)} · {m.costSource==="provider"?(pl?"zgłoszony przez dostawcę":"provider-reported"):m.costSource==="estimated"?(pl?"szacunkowy":"estimated"):`${pl?"znana suma":"known subtotal"} · ${m.knownCostSource === "estimated" ? (pl?"szacunkowy":"estimated") : (pl?"zgłoszony przez dostawcę":"provider-reported")} · ${missing(m.costMissing)}`}</>}</span>
    <span>{pl?"Czas wywołań":"Request time"}: {(m.activeElapsedMs/1000).toFixed(1)} s</span>
  </div>;
}
