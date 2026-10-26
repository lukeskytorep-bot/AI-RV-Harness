import { afterEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ channels: [] as Array<{ onmessage?: (event: unknown) => void }>, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: native.invoke,
  Channel: class { onmessage?: (event: unknown) => void; constructor() { native.channels.push(this); } },
}));
import { workflowOwnershipNative } from "./databaseNative";
afterEach(() => { native.channels.length = 0; vi.resetAllMocks(); });

it("ownership reads and fenced actions do not allocate unused IPC channels", async () => {
  for (const action of ["inspect", "check", "write", "renew", "release", "endResearch"]) {
    const request = { action, profileId: "p", owner: "o", version: 1, entities: [{ kind: "rv", id: "s" }] };
    native.invoke.mockResolvedValueOnce(true);
    expect(await workflowOwnershipNative(request)).toBe(true);
    expect(native.invoke).toHaveBeenLastCalledWith("database_workflow_ownership", { request, onLost: null });
  }
  expect(native.channels).toHaveLength(0);
});
it("Acquire retains its one loss-notification channel and exact abort cause", async () => {
  const failure = vi.fn();
  native.invoke.mockResolvedValueOnce({ nativeHeartbeat: true });
  const request = { action: "acquire", profileId: "p", owner: "o" };
  expect(await workflowOwnershipNative(request, failure)).toEqual({ nativeHeartbeat: true });
  expect(native.channels).toHaveLength(1);
  expect(native.invoke).toHaveBeenCalledWith("database_workflow_ownership", { request, onLost: native.channels[0] });
  const message = { kind: "database_error", message: "Native heartbeat database failure" };
  native.channels[0].onmessage!(message);
  expect(failure).toHaveBeenCalledExactlyOnceWith(message);
});
it("plain inspection failures still reject rather than reporting idle ownership", async () => {
  const cause = new Error("database unavailable");
  native.invoke.mockRejectedValueOnce(cause);
  await expect(workflowOwnershipNative({ action: "inspect", profileId: "p" })).rejects.toBe(cause);
  expect(native.channels).toHaveLength(0);
});
