// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useWorkflowOwnership } from "./useWorkflowOwnership";
import type { AppRepository } from "../storage/repository";
let host: HTMLDivElement, root: Root;
let hidden = false;
beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  hidden = false; vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });
function Probe({ repository, id = "p" }: { repository?: AppRepository; id?: string }) {
  const current = useWorkflowOwnership(repository, id);
  return <output data-unavailable={current.unavailable}>{current.state}</output>;
}
function repository(fn = vi.fn().mockResolvedValue("idle")) { return { getWorkflowOwnership: fn } as unknown as AppRepository; }

it("coalesces same Profile/repository consumers and polls once per visible interval", async () => {
  const repo = repository(); const read = vi.mocked(repo.getWorkflowOwnership);
  await act(async () => root.render(<><Probe repository={repo}/><Probe repository={repo}/></>));
  expect(read).toHaveBeenCalledTimes(1); expect(host.textContent).toBe("idleidle");
  await act(async () => vi.advanceTimersByTimeAsync(1_999)); expect(read).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(1)); expect(read).toHaveBeenCalledTimes(2);
  await act(async () => root.render(<Probe repository={repo}/>));
  await act(async () => vi.advanceTimersByTimeAsync(2_000)); expect(read).toHaveBeenCalledTimes(3);
  await act(async () => root.render(null));
  await act(async () => vi.advanceTimersByTimeAsync(30_000)); expect(read).toHaveBeenCalledTimes(3);
});
it("slow reads never overlap, including repeated focus/visibility events", async () => {
  let resolve!: (value: string) => void;
  const read = vi.fn(() => new Promise<string>(done => { resolve = done; })); const repo = repository(read);
  await act(async () => root.render(<Probe repository={repo}/>));
  expect(host.querySelector("output")?.dataset.unavailable).toBe("true");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
    window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => resolve("other"));
  expect(host.textContent).toBe("other"); expect(host.querySelector("output")?.dataset.unavailable).toBe("true");
  await act(async () => vi.advanceTimersByTimeAsync(2_000)); expect(read).toHaveBeenCalledTimes(2);
  await act(async () => root.render(null));
  await act(async () => resolve("idle"));
  await act(async () => vi.advanceTimersByTimeAsync(20_000)); expect(read).toHaveBeenCalledTimes(2);
});
it("hidden windows reduce inspection frequency and restoration refreshes immediately", async () => {
  const repo = repository(); const read = vi.mocked(repo.getWorkflowOwnership);
  await act(async () => root.render(<Probe repository={repo}/>));
  await act(async () => { hidden = true; document.dispatchEvent(new Event("visibilitychange")); });
  await act(async () => vi.advanceTimersByTimeAsync(9_999)); expect(read).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(1)); expect(read).toHaveBeenCalledTimes(2);
  await act(async () => { hidden = false; document.dispatchEvent(new Event("visibilitychange")); });
  expect(read).toHaveBeenCalledTimes(3);
  await act(async () => window.dispatchEvent(new Event("focus"))); expect(read).toHaveBeenCalledTimes(4);
});
it("profile changes ignore late results from the previous subscription; failures remain unavailable", async () => {
  let resolve!: (value: string) => void;
  const read = vi.fn().mockImplementationOnce(() => new Promise<string>(done => { resolve = done; })).mockRejectedValue(new Error("database failed"));
  const repo = repository(read);
  await act(async () => root.render(<Probe repository={repo} id="old"/>));
  await act(async () => root.render(<Probe repository={repo} id="new"/>));
  expect(host.textContent).toBe("unknown");
  await act(async () => resolve("idle"));
  expect(host.textContent).toBe("unknown"); expect(host.querySelector("output")?.dataset.unavailable).toBe("true");
  expect(read.mock.calls.map(([id]) => id)).toEqual(["old", "new"]);
});
it("missing repository/Profile never creates a polling loop", async () => {
  const repo = repository();
  await act(async () => root.render(<><Probe/><Probe repository={repo} id=""/></>));
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(repo.getWorkflowOwnership).not.toHaveBeenCalled(); expect(host.textContent).toBe("unknownunknown");
});

it("synchronous adapter failures also remain unknown and can recover on the next refresh", async () => {
  const read = vi.fn().mockImplementationOnce(() => { throw new Error("adapter startup failed"); }).mockResolvedValue("idle");
  const repo = repository(read);
  await act(async () => root.render(<Probe repository={repo}/>));
  expect(host.textContent).toBe("unknown");
  expect(host.querySelector("output")?.dataset.unavailable).toBe("true");
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(host.textContent).toBe("idle"); expect(read).toHaveBeenCalledTimes(2);
});

it("remounting the same Profile joins its pending read instead of starting overlapping IPC", async () => {
  let resolve!: (value: string) => void;
  const read = vi.fn(() => new Promise<string>(done => { resolve = done; }));
  const repo = repository(read);
  await act(async () => root.render(<Probe repository={repo}/>));
  await act(async () => root.render(null));
  await act(async () => root.render(<Probe repository={repo}/>));
  expect(read).toHaveBeenCalledTimes(1); expect(host.textContent).toBe("unknown");
  await act(async () => resolve("other"));
  expect(host.textContent).toBe("other");
  expect(host.querySelector("output")?.dataset.unavailable).toBe("true");
});
