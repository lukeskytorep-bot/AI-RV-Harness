import { describe, expect, it, vi } from "vitest";
import { isSqliteLockError, sqliteWriteCoordinator, SqliteWriteCoordinator } from "./sqliteWriteCoordinator";

describe("SQLite write coordinator", () => {
  it("recognizes SQLite busy and locked errors without swallowing unrelated failures", () => {
    expect(isSqliteLockError(new Error("error returned from database: (code: 5) database is locked"))).toBe(true);
    expect(isSqliteLockError(new Error("SQLITE_BUSY: database is busy"))).toBe(true);
    expect(isSqliteLockError(new Error("foreign key constraint failed"))).toBe(false);
  });

  it("retries a transient database lock", async () => {
    const sleep = vi.fn(async () => undefined);
    const coordinator = new SqliteWriteCoordinator([10, 20], sleep);
    let attempts = 0;

    await expect(coordinator.run(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("database is locked");
      return "saved";
    })).resolves.toBe("saved");

    expect(attempts).toBe(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 10);
    expect(sleep).toHaveBeenNthCalledWith(2, 20);
  });

  it("serializes writes even when callers start them concurrently", async () => {
    const coordinator = new SqliteWriteCoordinator([], async () => undefined);
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const first = coordinator.run(async () => {
      order.push("first:start");
      await firstCanFinish;
      order.push("first:end");
    });
    const second = coordinator.run(async () => {
      order.push("second:start");
      order.push("second:end");
    });

    await Promise.resolve();
    expect(order).toEqual(["first:start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });
});

it("shares a queue per database across repository instances", async () => {
  const first = sqliteWriteCoordinator("same-db");
  const second = sqliteWriteCoordinator("same-db");
  expect(first).toBe(second);
  expect(first).not.toBe(sqliteWriteCoordinator("other-db"));
  const order: string[] = []; let release!: () => void;
  const blocker = new Promise<void>(resolve => { release = resolve; });
  const a = first.run(async () => { order.push("a"); await blocker; });
  const b = second.run(async () => { order.push("b"); });
  await Promise.resolve(); expect(order).toEqual(["a"]); release();
  await Promise.all([a, b]); expect(order).toEqual(["a", "b"]);
});
it("never retries a failed rollback, ambiguous commit, or lease loss", async () => {
  for (const message of ["[sqlite-no-retry] commit outcome: SQLITE_BUSY", "[sqlite-no-retry] rollback failed: database is locked", "telepathic series lease lost before fenced checkpoint"]) {
    const operation = vi.fn(async () => { throw new Error(message); });
    await expect(new SqliteWriteCoordinator([1], async () => undefined).run(operation)).rejects.toThrow(message);
    expect(operation).toHaveBeenCalledTimes(1);
  }
});
