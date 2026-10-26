import type { TelepathicMode, TelepathicSeriesState } from "./types";

/** Read-only list data; never a checkpoint or a Resume input. */
export interface TelepathicSeriesSummary {
  seriesId: string; mode: TelepathicMode; seriesWorkspaceId: string;
  status: TelepathicSeriesState["status"]; roundCount: number;
  createdAt: string; updatedAt: string; archivedAt?: string; participantNames: string[];
}
export interface TelepathicHistoryCursor { updatedAt: string; seriesId: string; }
export interface TelepathicHistoryQuery {
  mode: TelepathicMode; seriesWorkspaceId?: string; archive: "all" | "active" | "archived";
  limit?: number; cursor?: TelepathicHistoryCursor;
}
export interface TelepathicHistoryPage { items: TelepathicSeriesSummary[]; nextCursor?: TelepathicHistoryCursor; }
export function validateHistoryQuery(query: TelepathicHistoryQuery): number {
  const limit = query.limit ?? 50;
  if (!["conversation_exchange", "ai_ai_training"].includes(query.mode)
    || !["all", "active", "archived"].includes(query.archive) || !Number.isInteger(limit) || limit < 1 || limit > 100
    || (query.seriesWorkspaceId !== undefined && (typeof query.seriesWorkspaceId !== "string" || !query.seriesWorkspaceId))
    || (query.cursor && (typeof query.cursor.updatedAt !== "string" || !query.cursor.updatedAt || typeof query.cursor.seriesId !== "string" || !query.cursor.seriesId))) {
    throw new Error("Invalid telepathic history query.");
  }
  return limit;
}
export function validateHistorySummary(item: TelepathicSeriesSummary): TelepathicSeriesSummary {
  if (typeof item.seriesId !== "string" || !item.seriesId || typeof item.seriesWorkspaceId !== "string" || !item.seriesWorkspaceId || typeof item.createdAt !== "string" || !item.createdAt || typeof item.updatedAt !== "string" || !item.updatedAt
    || !["conversation_exchange", "ai_ai_training"].includes(item.mode)
    || !["ready", "running", "paused", "completed", "cancelled", "blocked"].includes(item.status)
    || !Number.isInteger(item.roundCount) || item.roundCount < 1
    || (item.archivedAt !== undefined && typeof item.archivedAt !== "string")
    || !Array.isArray(item.participantNames) || !item.participantNames.length || item.participantNames.some(name => typeof name !== "string")) {
    throw new Error("Invalid telepathic history record.");
  }
  return item;
}
export function historyPage(items: TelepathicSeriesSummary[], limit: number): TelepathicHistoryPage {
  const visible = items.slice(0, limit); const last = visible.at(-1);
  return { items: visible, ...(items.length > limit && last ? { nextCursor: { updatedAt: last.updatedAt, seriesId: last.seriesId } } : {}) };
}
/** SQLite UTF-8 BINARY order equals Unicode scalar order, including supplementary IDs. */
export function compareHistoryText(a: string, b: string): number {
  let left = 0, right = 0;
  while (left < a.length && right < b.length) {
    const x = a.codePointAt(left)!, y = b.codePointAt(right)!;
    if (x !== y) return x < y ? -1 : 1;
    left += x > 65535 ? 2 : 1; right += y > 65535 ? 2 : 1;
  }
  return left < a.length ? 1 : right < b.length ? -1 : 0;
}
