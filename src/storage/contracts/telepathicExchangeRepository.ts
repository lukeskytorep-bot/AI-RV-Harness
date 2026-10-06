import type { TelepathicSeriesState } from "../../telepathicExchange/types";

export interface TelepathicExchangeRepository {
  getTelepathicSeries(seriesId: string): Promise<TelepathicSeriesState | null>;
  saveTelepathicSeries(state: TelepathicSeriesState): Promise<void>;
}
