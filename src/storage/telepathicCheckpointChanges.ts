type CheckpointChange = Readonly<{ seriesId: string; workspaceId: string; version: number }>;
type Listener = (change: CheckpointChange) => void;

const listeners = new Set<Listener>();
let version = 0;

/** In-process invalidation only. Version orders notifications, not database rows. */
export function publishTelepathicCheckpoint(seriesId: string, workspaceId: string): void {
  const change = { seriesId, workspaceId, version: ++version };
  for (const listener of listeners) {
    try { listener(change); } catch { /* A committed write remains successful. */ }
  }
}

export function subscribeToTelepathicCheckpoints(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
