import type { TelepathicSeriesState } from "../../telepathicExchange/types";
import type { TelepathicExchangeRepository } from "../contracts/telepathicExchangeRepository";

const TELEPATHIC_SERIES_KEY = "rvh.dev.telepathic_series_v1";
const browserFallbackLeases = new Set<string>();

export interface BrowserTelepathicExchangeRepositoryDependencies {
  storage?: Storage;
}

export class BrowserTelepathicExchangeRepository implements TelepathicExchangeRepository {
  private readonly storage: Storage;
  private readonly activeLeases = new Map<string, AbortController>();

  constructor(dependencies: BrowserTelepathicExchangeRepositoryDependencies = {}) {
    this.storage = dependencies.storage ?? localStorage;
  }

  private readAll(): TelepathicSeriesState[] {
    try {
      const raw = this.storage.getItem(TELEPATHIC_SERIES_KEY);
      return raw ? JSON.parse(raw) as TelepathicSeriesState[] : [];
    } catch {
      return [];
    }
  }

  async getTelepathicSeries(seriesId: string): Promise<TelepathicSeriesState | null> {
    const state = this.readAll().find((item) => item.config.seriesId === seriesId);
    return state ? structuredClone(state) : null;
  }


  async listTelepathicSeries(seriesWorkspaceId?: string): Promise<TelepathicSeriesState[]> {
    return this.readAll()
      .filter((item) => !seriesWorkspaceId || item.config.seriesWorkspaceId === seriesWorkspaceId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((item) => structuredClone(item));
  }

  async saveTelepathicSeries(state: TelepathicSeriesState): Promise<void> {
    const all = this.readAll();
    const next = [structuredClone(state), ...all.filter((item) => item.config.seriesId !== state.config.seriesId)];
    this.storage.setItem(TELEPATHIC_SERIES_KEY, JSON.stringify(next));
  }

  async withTelepathicSeriesLease<T>(seriesId: string, task: () => Promise<T>): Promise<T> {
    const lockName = `rvh-telepathic-series:${seriesId}`;
    const locks = (globalThis.navigator as Navigator & { locks?: { request<R>(name: string, options: { mode: "exclusive"; ifAvailable: true }, callback: (lock: unknown | null) => Promise<R>): Promise<R> } } | undefined)?.locks;
    if (locks) {
      return locks.request(lockName, { mode: "exclusive", ifAvailable: true }, async (lock) => {
        if (!lock) throw new Error("Telepathic series is already running in another browser tab.");
        const controller = new AbortController();
        this.activeLeases.set(seriesId, controller);
        try { return await task(); } finally { this.activeLeases.delete(seriesId); }
      });
    }
    if (browserFallbackLeases.has(seriesId)) throw new Error("Telepathic series is already running in another operation.");
    browserFallbackLeases.add(seriesId);
    const controller = new AbortController();
    this.activeLeases.set(seriesId, controller);
    try { return await task(); } finally { this.activeLeases.delete(seriesId); browserFallbackLeases.delete(seriesId); }
  }

  async assertTelepathicSeriesLease(seriesId: string): Promise<void> {
    if (!this.activeLeases.has(seriesId)) throw new Error("Telepathic series lease is not active.");
  }

  telepathicSeriesLeaseSignal(seriesId: string): AbortSignal | undefined {
    return this.activeLeases.get(seriesId)?.signal;
  }
}
