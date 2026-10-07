import type { TelepathicSeriesState } from "../../telepathicExchange/types";

export interface TelepathicExchangeRepository {
  getTelepathicSeries(seriesId: string): Promise<TelepathicSeriesState | null>;
  listTelepathicSeries(seriesWorkspaceId?: string): Promise<TelepathicSeriesState[]>;
  saveTelepathicSeries(state: TelepathicSeriesState): Promise<void>;
  withTelepathicSeriesLease<T>(seriesId: string, task: () => Promise<T>): Promise<T>;
  assertTelepathicSeriesLease(seriesId: string): Promise<void>;
  telepathicSeriesLeaseSignal(seriesId: string): AbortSignal | undefined;
}
