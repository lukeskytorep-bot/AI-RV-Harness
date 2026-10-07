import type { TelepathicSeriesState } from "./types";

export interface TelepathicExchangeStore {
  getTelepathicSeries(seriesId: string): Promise<TelepathicSeriesState | null>;
  saveTelepathicSeries(state: TelepathicSeriesState): Promise<void>;
  withTelepathicSeriesLease<T>(seriesId: string, task: () => Promise<T>): Promise<T>;
}

export class InMemoryTelepathicExchangeStore implements TelepathicExchangeStore {
  private readonly states = new Map<string, TelepathicSeriesState>();
  private readonly activeLeases = new Set<string>();

  async getTelepathicSeries(seriesId: string): Promise<TelepathicSeriesState | null> {
    const state = this.states.get(seriesId);
    return state ? structuredClone(state) : null;
  }

  async saveTelepathicSeries(state: TelepathicSeriesState): Promise<void> {
    this.states.set(state.config.seriesId, structuredClone(state));
  }

  async withTelepathicSeriesLease<T>(seriesId: string, task: () => Promise<T>): Promise<T> {
    if (this.activeLeases.has(seriesId)) throw new Error("Telepathic series is already running in another operation.");
    this.activeLeases.add(seriesId);
    try { return await task(); } finally { this.activeLeases.delete(seriesId); }
  }
}
