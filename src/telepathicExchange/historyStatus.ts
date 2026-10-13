import type { TelepathicSeriesState } from "./types";
export function telepathicStatusLabel(status: TelepathicSeriesState["status"], pl: boolean): string {
  const labels: Record<TelepathicSeriesState["status"], [string, string]> = {
    ready: ["Gotowy", "Ready"], running: ["W trakcie", "Running"], paused: ["Wstrzymany", "Paused"],
    completed: ["Zakończony", "Completed"], cancelled: ["Anulowany", "Cancelled"], blocked: ["Zablokowany", "Blocked"],
  };
  return labels[status][pl ? 0 : 1];
}
