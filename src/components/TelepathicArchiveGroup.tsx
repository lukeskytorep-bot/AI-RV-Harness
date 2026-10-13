import type { TelepathicSeriesSummary } from "../telepathicExchange/historySummaries";

export function TelepathicArchiveGroup({title,items,loading,error,hasMore,pl,disabled,parentBlocked,onLoadMore,onRetry,onRestore}: {
  title:string;items:TelepathicSeriesSummary[];loading:boolean;error:string|null;hasMore:boolean;pl:boolean;disabled:boolean;
  parentBlocked:(workspaceId:string)=>boolean;onLoadMore:()=>void;onRetry:()=>void;onRestore:(id:string)=>void;
}) {
  if(!items.length&&!loading&&!error)return null;
  return <details open className="telepathic-archive-group"><summary>{title} · {items.length}{hasMore?"+":""}</summary>
    {items.map(item=><div className="archive-row" key={item.seriesId}><span><strong>{item.participantNames.join(" · ")}</strong><small>{item.status} · {item.roundCount} {pl?"rund":"rounds"}</small></span><button type="button" className="secondary-button" disabled={disabled||parentBlocked(item.seriesWorkspaceId)} title={parentBlocked(item.seriesWorkspaceId)?(pl?"Najpierw przywróć nadrzędny Profil i Workspace.":"Restore the parent Profile and Workspace first."):undefined} onClick={()=>onRestore(item.seriesId)}>{pl?"Przywróć":"Restore"}</button></div>)}
    {loading&&<p role="status">{pl?"Ładowanie archiwum telepatii…":"Loading telepathy archive…"}</p>}
    {error&&<div role="alert"><p>{pl?"Nie udało się wczytać archiwum telepatii":"Could not load telepathy archive"}: {error}</p><button type="button" className="secondary-button" disabled={disabled||loading} onClick={onRetry}>{pl?"Spróbuj ponownie":"Retry"}</button></div>}
    {hasMore&&<button type="button" className="secondary-button" disabled={disabled||loading} onClick={onLoadMore}>{pl?"Pokaż więcej":"Load more"}</button>}
  </details>;
}
