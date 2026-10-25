import { afterEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("../databaseNative", () => ({ workflowOwnershipNative: native.call }));
import { ownSqliteWorkflow } from "./workflowOwnership";
import type { WorkflowContext } from "../../application/workflowOwnership";
import { assertAbortOwnership, nativeWorkflowBinding, WorkflowAbortError } from "../../application/abortOwnership";
const scope = { profileId: "p", entity: { kind: "rv" as const, id: "s" } };
const token = { profileId: "p", owner: "owner", version: 4, nativeHeartbeat: true };
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
function fixture() {
 let loss!: (failure: { kind: "ownership_lost" | "database_error"; message: string }) => void;
 native.call.mockImplementation(async (request, onLost) => {
  if (request.action === "acquire") { loss = onLost; return token; }
  if (request.action === "renew") return false;
  return true;
 });
 return { lose: (kind: "ownership_lost" | "database_error") => loss({ kind, message: kind === "database_error" ? "Native heartbeat disk error" : "Native workflow ownership lost" }) };
}
it("T4 native handshake keeps the frontend signal alive without any JS renewal across a delayed WebView", async () => {
 vi.useFakeTimers(); fixture(); let release!: () => void; let ready!: () => void; let current!: WorkflowContext;
 const started = new Promise<void>(resolve => { ready = resolve; });
 const work = ownSqliteWorkflow(scope, context => { current = context; return {} as never; }, async () => { ready(); await new Promise<void>(resolve => { release = resolve; }); }, () => {});
 await started;
 try {
  await vi.advanceTimersByTimeAsync(120_000);
  expect(native.call.mock.calls.filter(([r]) => r.action === "renew")).toHaveLength(0);
  expect(current.signal.aborted).toBe(false);
  expect(nativeWorkflowBinding(current.signal)).toMatchObject({ profileId: "p", owner: "owner", version: 4, entities: [{ kind: "rv", id: "s", allowEnded: false }] });
 } finally { release(); await work; }
 expect(native.call.mock.calls.filter(([r]) => r.action === "release")).toHaveLength(1);
});
for (const kind of ["ownership_lost", "database_error"] as const) it(`T4 ${kind}: native notification aborts immediately and fences the next callback`, async () => {
 const f = fixture(); let current!: WorkflowContext;
 await ownSqliteWorkflow(scope, context => { current = context; return {} as never; }, async () => {
  f.lose(kind); expect(current.signal.reason).toBeInstanceOf(WorkflowAbortError);
  await expect(assertAbortOwnership(current.signal)).rejects.toMatchObject({ name: "AbortError", kind });
 }, () => {});
});
it("T4 failed verification retains the database abort reason", async () => {
 fixture(); let current!: WorkflowContext;
 await ownSqliteWorkflow(scope, context => { current = context; return {} as never; }, async () => {
  native.call.mockRejectedValueOnce(new Error("database unavailable"));
  await expect(assertAbortOwnership(current.signal)).rejects.toMatchObject({ name: "AbortError", kind: "database_error", message: "database unavailable" });
  expect(current.signal.aborted).toBe(true);
 }, () => {});
});
it("T4 provider binding uses current entities and refuses a settled context", async () => {
 fixture(); let current!: WorkflowContext;
 await ownSqliteWorkflow(scope, context => { current = context; return {} as never; }, async () => {
  current.entities = [{ kind: "training", id: "run" }, { kind: "rv", id: "other-session" }];
  expect(nativeWorkflowBinding(current.signal)?.entities.map(e => e.id)).toEqual(["run", "other-session"]);
 }, () => {});
 expect(current.closed).toBe(true); expect(() => nativeWorkflowBinding(current.signal)).toThrow(/settled/);
});
it("T4 Stop preserves the exact user reason and releases the lease once", async () => {
 fixture(); const stop = new AbortController();
 await ownSqliteWorkflow({ ...scope, signal: stop.signal }, () => ({} as never), async (_repo, signal) => {
  const reason = new DOMException("Stopped by user", "AbortError"); stop.abort(reason);
  expect(signal.reason).toBe(reason); await expect(assertAbortOwnership(signal)).rejects.toBe(reason);
 }, () => {});
 expect(native.call.mock.calls.filter(([r]) => r.action === "release")).toHaveLength(1);
});
