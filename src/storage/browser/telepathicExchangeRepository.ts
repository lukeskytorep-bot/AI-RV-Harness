import { validateHistoryQuery, validateHistorySummary, compareHistoryText, historyPage, type TelepathicHistoryQuery, type TelepathicHistoryPage, type TelepathicSeriesSummary } from "../../telepathicExchange/historySummaries";
import { assertArchiveRevision } from "../../telepathicExchange/persistence";
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


  async listTelepathicSeriesSummaries(query: TelepathicHistoryQuery): Promise<TelepathicHistoryPage> {
    const limit = validateHistoryQuery(query);
    const raw = this.storage.getItem(TELEPATHIC_SERIES_KEY);
    const all: TelepathicSeriesState[] = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(all)) throw new Error("Invalid telepathic history document.");
    const items: TelepathicSeriesSummary[] = [];
    for (const state of all) {
      if (!state?.config || !["conversation_exchange", "ai_ai_training"].includes(state.config.mode)
        || typeof state.config.seriesId !== "string" || !state.config.seriesId
        || typeof state.config.seriesWorkspaceId !== "string" || !state.config.seriesWorkspaceId) throw new Error("Invalid telepathic history record.");
      if (state.config.mode !== query.mode || (query.seriesWorkspaceId !== undefined && state.config.seriesWorkspaceId !== query.seriesWorkspaceId)) continue;
      if (state.archivedAt != null && typeof state.archivedAt !== "string") throw new Error("Invalid telepathic archive metadata.");
      if ((query.archive === "active" && state.archivedAt) || (query.archive === "archived" && !state.archivedAt)) continue;
      const item = validateHistorySummary({ seriesId: state.config.seriesId, mode: state.config.mode, seriesWorkspaceId: state.config.seriesWorkspaceId,
        status: state.status, roundCount: state.config.roundCount, createdAt: state.createdAt, updatedAt: state.updatedAt,
        ...(state.archivedAt ? { archivedAt: state.archivedAt } : {}), participantNames: state.config.participants?.map(p => p.displayName) });
      if (query.cursor && !(compareHistoryText(item.updatedAt, query.cursor.updatedAt) < 0 || (item.updatedAt === query.cursor.updatedAt && compareHistoryText(item.seriesId, query.cursor.seriesId) < 0))) continue;
      items.push(item);
    }
    items.sort((a, b) => compareHistoryText(b.updatedAt, a.updatedAt) || compareHistoryText(b.seriesId, a.seriesId));
    return historyPage(items, limit);
  }

  async listTelepathicSeries(seriesWorkspaceId?: string): Promise<TelepathicSeriesState[]> {
    return this.readAll()
      .filter((item) => !seriesWorkspaceId || item.config.seriesWorkspaceId === seriesWorkspaceId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((item) => structuredClone(item));
  }

  async saveTelepathicSeries(state: TelepathicSeriesState): Promise<void> {
    const all = this.readAll();
    assertArchiveRevision(state, all.find(item => item.config.seriesId === state.config.seriesId) ?? null);
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

  async getTelepathicSeriesLeaseState(seriesId: string): Promise<"idle" | "local" | "other" | "unknown"> {
    if (this.activeLeases.has(seriesId)) {
      await this.assertTelepathicSeriesLease(seriesId);
      return this.activeLeases.get(seriesId)?.signal.aborted ? "unknown" : "local";
    }
    const locks = globalThis.navigator?.locks;
    if (locks) {
      // Probe the same lock as execution, without dispatching or writing state.
      // query() is not supported by every Web Locks implementation.
      return locks.request(`rvh-telepathic-series:${seriesId}`, { mode: "exclusive", ifAvailable: true }, lock => lock ? "idle" : "other");
    }
    return browserFallbackLeases.has(seriesId) ? "other" : "idle";
  }

  async assertTelepathicSeriesLease(seriesId: string): Promise<void> {
    if (!this.activeLeases.has(seriesId)) throw new Error("Telepathic series lease is not active.");
  }

  telepathicSeriesLeaseSignal(seriesId: string): AbortSignal | undefined {
    return this.activeLeases.get(seriesId)?.signal;
  }
}
