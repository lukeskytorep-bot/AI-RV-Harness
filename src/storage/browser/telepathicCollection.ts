import type { TelepathicSeriesState } from "../../telepathicExchange/types";

export const TELEPATHIC_SERIES_KEY = "rvh.dev.telepathic_series_v1";
export const TELEPATHIC_COLLECTION_LOCK = "rvh-telepathic-collection:v1";

type StorageLike = Pick<Storage, "getItem">;

export function readTelepathicCollection(storage: StorageLike): TelepathicSeriesState[] {
  const raw = storage.getItem(TELEPATHIC_SERIES_KEY);
  if (raw === null) return [];
  const states: unknown = JSON.parse(raw);
  if (!Array.isArray(states) || states.some(s => !s?.config || typeof s.config.seriesId !== "string")
    || new Set(states.map(s => s.config.seriesId)).size !== states.length) {
    throw new Error("Invalid Telepathy storage.");
  }
  return states;
}

// Lock order: series lease (when needed), then collection. Never acquire a
// series lease from here. The synchronous callback covers only fresh read,
// validation and commit; provider calls must run outside this short lock.
export async function withTelepathicCollectionWrite<T>(task: () => T): Promise<T> {
  const locks = globalThis.navigator?.locks;
  if (locks) return locks.request(TELEPATHIC_COLLECTION_LOCK, { mode: "exclusive" }, task);
  // Existing save support without cross-tab coordination. Permanent Delete
  // requires Web Locks and rejects before reaching this fallback.
  return task();
}
