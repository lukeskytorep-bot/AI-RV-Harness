import { describe, expect, it } from "vitest";
import { AsyncRunGuard } from "./runGuard";

describe("paid run guard", () => {
  it("rejects a second synchronous start until the first run releases the guard", () => {
    const guard = new AsyncRunGuard();
    expect(guard.tryAcquire()).toBe(true);
    expect(guard.tryAcquire()).toBe(false);
    expect(guard.isActive()).toBe(true);
    guard.release();
    expect(guard.tryAcquire()).toBe(true);
  });
});
