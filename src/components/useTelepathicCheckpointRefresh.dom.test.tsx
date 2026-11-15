// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { publishTelepathicCheckpoint } from "../storage/telepathicCheckpointChanges";
import { useTelepathicCheckpointRefresh } from "./useTelepathicCheckpointRefresh";

const repository = {};
const revision = { current: 0 };
const read = vi.fn<(id: string) => Promise<string | null>>();
const apply = vi.fn<(value: string) => void>();
let root: ReturnType<typeof createRoot>;
function View({ id, workspace = "w", working = true }: { id: string; workspace?: string; working?: boolean }) {
  useTelepathicCheckpointRefresh({ repository, seriesId: id, workspaceId: workspace, working, revision, read, apply });
  return null;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  read.mockReset();
  apply.mockReset();
  revision.current = 0;
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});

const render = (id: string, workspace?: string, working?: boolean) => act(async () => root.render(<View {...{ id, workspace, working }} />));
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

it("coalesces committed bursts and queues a final read behind a slow read", async () => {
  let release!: (value: string) => void;
  read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValue("final commit");
  await render("s");
  for (let i = 0; i < 12; i++) publishTelepathicCheckpoint("s", "w");
  await tick(25);
  expect(read).toHaveBeenCalledTimes(1);
  publishTelepathicCheckpoint("s", "other-workspace");
  publishTelepathicCheckpoint("other-series", "w");
  for (let i = 0; i < 12; i++) publishTelepathicCheckpoint("s", "w");
  await tick(75);
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => release("previous commit"));
  expect(read).toHaveBeenCalledTimes(2);
  expect(apply).toHaveBeenLastCalledWith("final commit");
});

it("ignores an obsolete read after switching series or workspace and cleans up after unmount", async () => {
  let release!: (value: string) => void;
  read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValue("new view");
  await render("s");
  publishTelepathicCheckpoint("s", "w");
  await tick(25);
  await render("s2", "w2");
  publishTelepathicCheckpoint("s", "w");
  publishTelepathicCheckpoint("s2", "w");
  publishTelepathicCheckpoint("s2", "w2");
  await tick(25);
  expect(read.mock.calls).toEqual([["s"]]);
  await act(async () => release("obsolete view"));
  expect(read.mock.calls).toEqual([["s"], ["s2"]]);
  expect(apply.mock.calls).toEqual([["new view"]]);
  await act(async () => root.render(null));
  publishTelepathicCheckpoint("s2", "w2");
  window.dispatchEvent(new Event("focus"));
  await tick(16000);
  expect(read).toHaveBeenCalledTimes(2);
});

it("recovers a missing event while busy and refreshes on focus after becoming idle", async () => {
  read.mockResolvedValueOnce("during work");
  await render("s");
  await tick(25);
  expect(apply).toHaveBeenLastCalledWith("during work");
  read.mockResolvedValueOnce("during work").mockResolvedValueOnce("focus");
  read.mockClear();
  await tick(4974);
  expect(read).not.toHaveBeenCalled();
  await tick(1);
  expect(apply).toHaveBeenLastCalledWith("during work");
  await render("s", "w", false);
  await tick(30_100);
  expect(read).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event("focus"));
  window.dispatchEvent(new Event("focus"));
  await tick(25);
  expect(read).toHaveBeenCalledTimes(2);
  expect(apply).toHaveBeenLastCalledWith("focus");
});

it("does not overwrite a newer action result with a read already in flight", async () => {
  let release!: (value: string) => void;
  read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await render("s");
  publishTelepathicCheckpoint("s", "w");
  await tick(25);
  revision.current++;
  await act(async () => release("stale checkpoint"));
  expect(apply).not.toHaveBeenCalled();
});
