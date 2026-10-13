import { useCallback, useEffect, useRef, useState } from "react";
import type { TelepathicExchangeRepository } from "../storage/contracts/telepathicExchangeRepository";
import type { TelepathicHistoryPage, TelepathicHistoryCursor, TelepathicSeriesSummary } from "../telepathicExchange/historySummaries";
import type { TelepathicMode } from "../telepathicExchange/types";

export function useTelepathicHistory(repository: Pick<TelepathicExchangeRepository, "listTelepathicSeriesSummaries"> | null, mode: TelepathicMode, seriesWorkspaceId?: string) {
  const [items, setItems] = useState<TelepathicSeriesSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<TelepathicHistoryCursor>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0); const inFlight = useRef(false); const failedAppend = useRef(false);
  useEffect(() => { generation.current++; inFlight.current = false; setItems([]); setNextCursor(undefined); setError(null); setLoading(false);
    return () => { generation.current++; }; }, [repository, mode, seriesWorkspaceId]);
  const load = useCallback(async (append: boolean, cursor?: TelepathicHistoryCursor): Promise<TelepathicHistoryPage | null> => {
    if (!repository || (append && inFlight.current)) return null;
    const epoch = ++generation.current; inFlight.current = true; setLoading(true); setError(null);
    try {
      const page = await repository.listTelepathicSeriesSummaries({ mode, ...(seriesWorkspaceId === undefined ? {} : { seriesWorkspaceId }), archive: "all", limit: 50, ...(cursor ? { cursor } : {}) });
      if (epoch !== generation.current) return null;
      setItems(current => [...new Map((append ? [...current, ...page.items] : page.items).map(item => [item.seriesId, item])).values()]);
      setNextCursor(page.nextCursor); return page;
    } catch (cause) {
      if (epoch === generation.current) { failedAppend.current = append; setError(cause instanceof Error ? cause.message : String(cause)); }
      return null;
    } finally { if (epoch === generation.current) { inFlight.current = false; setLoading(false); } }
  }, [repository, mode, seriesWorkspaceId]);
  const reset = useCallback(() => load(false), [load]);
  const loadMore = () => nextCursor ? load(true, nextCursor) : Promise.resolve(null);
  const retry = () => failedAppend.current ? loadMore() : reset();
  const recentActive = async (page: TelepathicHistoryPage) => {
    const recent = page.items.find(item => !item.archivedAt);
    if (recent || !page.items.length || !repository) return recent ?? null;
    const active = await repository.listTelepathicSeriesSummaries({ mode, ...(seriesWorkspaceId === undefined ? {} : { seriesWorkspaceId }), archive: "active", limit: 1 });
    return active.items[0] ?? null;
  };
  return { items, loading, error, nextCursor, reset, loadMore, retry, recentActive };
}
