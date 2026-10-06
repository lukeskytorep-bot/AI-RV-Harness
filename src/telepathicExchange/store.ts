import type { TelepathicSeriesState } from "./types";

export interface TelepathicExchangeStore {
  getTelepathicSeries(seriesId: string): Promise<TelepathicSeriesState | null>;
  saveTelepathicSeries(state: TelepathicSeriesState): Promise<void>;
}

export class InMemoryTelepathicExchangeStore implements TelepathicExchangeStore {
  private readonly states = new Map<string, TelepathicSeriesState>();

  async getTelepathicSeries(seriesId: string): Promise<TelepathicSeriesState | null> {
    const state = this.states.get(seriesId);
    return state ? structuredClone(state) : null;
  }

  async saveTelepathicSeries(state: TelepathicSeriesState): Promise<void> {
    this.states.set(state.config.seriesId, structuredClone(state));
  }
}
