import { describe, expect, it, vi } from "vitest";
import { isSqliteLockError, SqliteWriteCoordinator } from "./sqliteWriteCoordinator";

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
