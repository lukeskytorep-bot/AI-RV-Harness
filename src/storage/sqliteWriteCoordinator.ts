const DEFAULT_RETRY_DELAYS_MS = [40, 80, 160, 320, 640, 1_200, 2_000] as const;

export type Sleep = (durationMs: number) => Promise<void>;

function defaultSleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, durationMs));
}

/** An exhausted inner queue must not multiply the outer retry budget. */
export class SqliteWriteRetryExhaustedError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "SqliteWriteRetryExhaustedError";
  }
}

export function isSqliteLockError(cause: unknown): boolean {
  if (cause instanceof SqliteWriteRetryExhaustedError) return false;
  const message = cause instanceof Error ? cause.message : String(cause);
  if (message.includes("[sqlite-no-retry]")) return false;
  return /(?:database(?: table)? is locked|database is busy|SQLITE_BUSY|SQLITE_LOCKED|\bcode\s*:\s*(?:5|6)\b)/i.test(message);
}

/**
 * SQLite permits many readers but only one writer. The Tauri SQL plugin uses a
 * connection pool, so application writes must be coordinated above the pool.
 */
export class SqliteWriteCoordinator {
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly retryDelaysMs: readonly number[] = DEFAULT_RETRY_DELAYS_MS,
    private readonly sleep: Sleep = defaultSleep,
  ) {}

  run<T>(operation: () => Promise<T>): Promise<T> {
    const scheduled = this.tail.then(
      () => this.runWithRetry(operation),
      () => this.runWithRetry(operation),
    );
    this.tail = scheduled.then(() => undefined, () => undefined);
    return scheduled;
  }

  async idle(): Promise<void> {
    await this.tail;
  }

  private async runWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await operation();
      } catch (cause) {
        const delay = this.retryDelaysMs[attempt];
        if (!isSqliteLockError(cause)) throw cause;
        if (delay === undefined) throw new SqliteWriteRetryExhaustedError(cause);
        await this.sleep(delay);
      }
    }
  }
}

// All repositories in this WebView, including workflow-scoped instances, write
// to the same native database. Native fences still arbitrate other windows and
// Rust heartbeat tasks; this queue never replaces an ownership check.
const databaseCoordinators = new Map<string, SqliteWriteCoordinator>();
export function sqliteWriteCoordinator(databaseKey: string): SqliteWriteCoordinator {
  let coordinator = databaseCoordinators.get(databaseKey);
  if (!coordinator) {
    coordinator = new SqliteWriteCoordinator();
    databaseCoordinators.set(databaseKey, coordinator);
  }
  return coordinator;
}
