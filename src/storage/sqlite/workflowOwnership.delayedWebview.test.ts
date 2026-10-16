import { expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("../databaseNative", () => ({ workflowOwnershipNative: native.call }));
import { ownSqliteWorkflow } from "./workflowOwnership";
it("native heartbeat handshake prevents delayed WebView from renewing an already expired JS lease", async () => {
 vi.useFakeTimers();
 native.call.mockImplementation(async request => request.action === "acquire" ? { profileId: "p", owner: "owner", version: 1, nativeHeartbeat: true } : request.action === "renew" ? false : true);
 let release!: () => void, ready!: () => void, signal!: AbortSignal;
 const started = new Promise<void>(resolve => { ready = resolve; });
 const running = ownSqliteWorkflow({ profileId: "p", entity: { kind: "profile", id: "p" } }, () => ({} as never), async (_repo, current) => {
  signal = current; ready(); await new Promise<void>(resolve => { release = resolve; });
 }, () => {});
 await started;
 try {
  await vi.advanceTimersByTimeAsync(120_000);
  expect(signal.aborted).toBe(false);
  expect(native.call.mock.calls.filter(([r]) => r.action === "renew")).toHaveLength(0);
 } finally { release(); await running; vi.useRealTimers(); }
});
