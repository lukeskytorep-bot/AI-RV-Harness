import type { TelepathicSeriesState } from "./types";

export interface TelepathicExchangeStore {
  getTelepathicSeries(seriesId: string): Promise<TelepathicSeriesState | null>;
  saveTelepathicSeries(state: TelepathicSeriesState): Promise<void>;
  withTelepathicSeriesLease<T>(seriesId: string, task: () => Promise<T>): Promise<T>;
  assertTelepathicSeriesLease(seriesId: string): Promise<void>;
  telepathicSeriesLeaseSignal(seriesId: string): AbortSignal | undefined;
}

export class InMemoryTelepathicExchangeStore implements TelepathicExchangeStore {
  private readonly states = new Map<string, TelepathicSeriesState>();
  private readonly activeLeases = new Map<string, AbortController>();

  async getTelepathicSeries(seriesId: string): Promise<TelepathicSeriesState | null> {
    const state = this.states.get(seriesId);
    return state ? structuredClone(state) : null;
  }

  async saveTelepathicSeries(state: TelepathicSeriesState): Promise<void> {
    this.states.set(state.config.seriesId, structuredClone(state));
  }

  async withTelepathicSeriesLease<T>(seriesId: string, task: () => Promise<T>): Promise<T> {
    if (this.activeLeases.has(seriesId)) throw new Error("Telepathic series is already running in another operation.");
    const controller = new AbortController();
    this.activeLeases.set(seriesId, controller);
    try { return await task(); } finally { this.activeLeases.delete(seriesId); }
  }

  async assertTelepathicSeriesLease(seriesId: string): Promise<void> {
    if (!this.activeLeases.has(seriesId)) throw new Error("Telepathic series lease is not active.");
  }

  telepathicSeriesLeaseSignal(seriesId: string): AbortSignal | undefined {
    return this.activeLeases.get(seriesId)?.signal;
  }
}
