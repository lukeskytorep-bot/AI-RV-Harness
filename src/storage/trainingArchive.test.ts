// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { BrowserRepository } from "./browserRepository";
import { changeBrowserTrainingArchive, recoverBrowserTrainingArchive } from "./browser/trainingArchive";
import { planTrainingArchive } from "../application/trainingArchive";
import type { TrainingRunRecord } from "../training/types";
import type { RvSession } from "../sessions/types";

const runsKey = "rvh.dev.training_runs";
const sessionsKey = "rvh.dev.rv_sessions";
function seed() {
  localStorage.clear();
  const run = { id: "r", profileId: "p", workspaceId: "w", sessionIds: ["a", "b", "a"], activeTargetCheckpoint: { sessionId: "c" }, updatedAt: "before" } as TrainingRunRecord;
  const sessions = ["a", "b", "c"].map(id => ({ id, profileId: "p", workspaceId: "w", updatedAt: "before", ...(id === "b" ? { archivedAt: "independently" } : {}) })) as RvSession[];
  localStorage.setItem(runsKey, JSON.stringify([run]));
  localStorage.setItem(sessionsKey, JSON.stringify(sessions));
  localStorage.setItem("rvh.dev.profiles", JSON.stringify([{ id: "p" }]));
  localStorage.setItem("rvh.dev.workspaces", JSON.stringify([{ id: "w", profileId: "p" }]));
  return { run, sessions };
}
it("restores only the sessions archived with Training, including the active checkpoint", async () => {
  seed();
  const repo = new BrowserRepository();
  await repo.archiveTrainingRun("r");
  expect((await repo.listArchivedTrainingRuns())[0].archivedSessionIds).toEqual(["a", "c"]);
  await new BrowserRepository().restoreTrainingRun("r");
  const rows = JSON.parse(localStorage.getItem(sessionsKey)!);
  expect(rows.map((row: RvSession) => row.archivedAt)).toEqual([undefined, "independently", undefined]);
  expect((await repo.listTrainingRuns())[0].archivedSessionIds).toBeUndefined();
});
it.each([runsKey, sessionsKey])("recovers a partial archive after failure writing %s", async failedKey => {
  seed();
  const original = Storage.prototype.setItem;
  let fail = true;
  const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function(this: Storage, key, value) {
    if (fail && key === failedKey) { fail = false; throw new Error("disk full"); }
    original.call(this, key, value);
  });
  try { await expect(changeBrowserTrainingArchive(localStorage, "r", false)).rejects.toThrow("disk full"); }
  finally { spy.mockRestore(); }
  const repo = new BrowserRepository();
  expect((await repo.listArchivedTrainingRuns())[0].archivedSessionIds).toEqual(["a", "c"]);
  expect((await repo.getRvSession("a"))?.archivedAt).toBe((await repo.listArchivedTrainingRuns())[0].archivedAt);
  expect(localStorage.getItem("rvh.dev.training_archive_journal")).toBeNull();
});
it("preserves historical archives without session provenance and rejects changed parents", async () => {
  const { run } = seed();
  localStorage.setItem(runsKey, JSON.stringify([{ ...run, archivedAt: "legacy" }]));
  const plan = planTrainingArchive({ ...run, archivedAt: "legacy" }, JSON.parse(localStorage.getItem(sessionsKey)!), true, "now");
  expect(plan.sessions).toEqual([]);
  localStorage.setItem("rvh.dev.profiles", "[]");
  await expect(changeBrowserTrainingArchive(localStorage, "r", true)).rejects.toThrow("parent");
  expect(JSON.parse(localStorage.getItem(runsKey)!)[0].archivedAt).toBe("legacy");
});
it("refuses cross-project sessions before writing", async () => {
  const { sessions } = seed();
  sessions[0].researchProjectId = "research";
  localStorage.setItem(sessionsKey, JSON.stringify(sessions));
  await expect(changeBrowserTrainingArchive(localStorage, "r", false)).rejects.toThrow("ownership");
  expect(localStorage.getItem("rvh.dev.training_archive_journal")).toBeNull();
  expect(() => recoverBrowserTrainingArchive(localStorage)).not.toThrow();
});


it.each([runsKey, sessionsKey])("recovers a partial restore after failure writing %s", async failedKey => {
  seed();
  await changeBrowserTrainingArchive(localStorage, "r", false);
  const original = Storage.prototype.setItem;
  let fail = true;
  const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function(this: Storage, key, value) {
    if (fail && key === failedKey) { fail = false; throw new Error("disk full"); }
    original.call(this, key, value);
  });
  try { await expect(changeBrowserTrainingArchive(localStorage, "r", true)).rejects.toThrow("disk full"); }
  finally { spy.mockRestore(); }
  const repo = new BrowserRepository();
  expect((await repo.listTrainingRuns())[0].archivedAt).toBeUndefined();
  expect((await repo.getRvSession("a"))?.archivedAt).toBeUndefined();
  expect((await repo.getRvSession("b"))?.archivedAt).toBe("independently");
});

it("leaves both records intact when the journal cannot be written", async () => {
  seed();
  const before = [localStorage.getItem(runsKey), localStorage.getItem(sessionsKey)];
  const original = Storage.prototype.setItem;
  const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function(this: Storage, key, value) {
    if (key.endsWith("training_archive_journal")) throw new Error("disk full");
    original.call(this, key, value);
  });
  try { await expect(changeBrowserTrainingArchive(localStorage, "r", false)).rejects.toThrow("disk full"); }
  finally { spy.mockRestore(); }
  expect([localStorage.getItem(runsKey), localStorage.getItem(sessionsKey)]).toEqual(before);
});
