import type { TelepathicSeriesState } from "./types";

export type TelepathicLeaseState = "idle" | "local" | "other" | "unknown";
/** Neutral display overrides for specific dispatched calls, never persisted. */
export type TelepathicCallPresentation = "waiting" | "other" | "checking";
export interface TelepathicLocalExecution {
  seriesId: string;
  /** A dispatched checkpoint from before this task cannot prove a live call. */
  preexistingCallIds: string[];
}

export function telepathicExecutionPresentation(input: {
  seriesId: string;
  status: TelepathicSeriesState["status"];
  archivedAt?: string;
  calls: Array<{ id: string; callStage?: string; status: TelepathicSeriesState["providerCalls"][number]["status"] }>;
  execution: TelepathicLocalExecution | null;
  lease: TelepathicLeaseState;
}): "idle" | "working" | "waiting" | "other" | "checking" | "recovery" | "archived" {
  if (input.archivedAt) return "archived";
  const executing = input.execution?.seriesId === input.seriesId;
  if (input.lease === "other" || (input.lease === "local" && !executing)) return "other";
  if (executing) {
    if (input.lease === "local" && input.status !== "blocked" && input.status !== "cancelled"
      && (input.status !== "completed" || input.calls.every(call => call.callStage === "series_reflection"))
      && input.calls.length > 0 && input.calls.every(call => call.status === "dispatched"
        && !input.execution!.preexistingCallIds.includes(call.id))) return "waiting";
    // The task may be acquiring its lease, finishing a checkpoint, or stopping.
    // Recovery is available only once the task has actually settled.
    return "working";
  }
  if (input.lease === "unknown") return "checking";
  return input.status === "blocked" || input.calls.length > 0 ? "recovery" : "idle";
}
