import type { TelepathicHistoryQuery, TelepathicHistoryPage } from "../../telepathicExchange/historySummaries";
import type { TelepathicSeriesState } from "../../telepathicExchange/types";

export interface TelepathicExchangeRepository {
  readonly telepathicRecoveryOwner?: object;
  getTelepathicSeries(seriesId: string): Promise<TelepathicSeriesState | null>;
  listTelepathicSeries(seriesWorkspaceId?: string): Promise<TelepathicSeriesState[]>;
  listTelepathicSeriesSummaries(query: TelepathicHistoryQuery): Promise<TelepathicHistoryPage>;
  saveTelepathicSeries(state: TelepathicSeriesState): Promise<void>;
  withTelepathicSeriesLease<T>(seriesId: string, task: () => Promise<T>): Promise<T>;
  assertTelepathicSeriesLease(seriesId: string): Promise<void>;
  telepathicSeriesLeaseSignal(seriesId: string): AbortSignal | undefined;
  /** Read-only ownership check; no provider dispatch or lease acquisition. */
  getTelepathicSeriesLeaseState?(seriesId: string): Promise<"idle" | "local" | "other" | "unknown">;
}
