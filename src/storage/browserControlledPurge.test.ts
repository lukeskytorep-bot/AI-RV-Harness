import { describe, expect, it } from "vitest";
import { previewBrowserPermanentDelete, purgeBrowserPermanentDelete } from "./browser/controlledPurge";

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.get(key) ?? null; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, value); }
}

const set = (storage: Storage, key: string, value: unknown) => storage.setItem(key, JSON.stringify(value));
const get = <T>(storage: Storage, key: string): T => JSON.parse(storage.getItem(key) ?? "null") as T;

describe("Browser controlled purge", () => {
  it("purges an archived Workspace subtree while preserving foreign Viewer Notes provenance", () => {
    const storage = new MemoryStorage();
    set(storage, "rvh.dev.profiles", [{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }]);
    set(storage, "rvh.dev.workspaces", [{ id: "w1", profileId: "p1", name: "W1", archivedAt: "2026-09-10" }]);
    set(storage, "rvh.dev.rv_sessions", [{ id: "s1", workspaceId: "w1", profileId: "p1", sessionCode: "S1", archivedAt: "2026-09-10" }]);
    set(storage, "rvh.dev.ai_identities", [{ id: "ai2", profileId: "p2" }]);
    set(storage, "rvh.dev.ai_note_versions", [{ id: "v1", aiIdentityId: "ai2", sourceSessionId: "s1", sourceWorkspaceId: "w1", sourceSnapshot: { workspaceId: "w1", sessionId: "s1" } }]);
    set(storage, "rvh.dev.ai_note_reflection_runs", [{ id: "r1", aiIdentityId: "ai2", sourceSessionId: "s1", sourceWorkspaceId: "w1", sourceSnapshot: { workspaceId: "w1", sessionId: "s1" } }]);
    set(storage, "rvh.dev.ai_note_activation_events", [{ id: "a1", aiIdentityId: "ai2", toVersionId: "v1", sourceSessionId: "s1", workspaceId: "w1" }]);

    const preview = previewBrowserPermanentDelete(storage, "workspace", "w1");
    expect(preview.viewerNotesPreserved).toBe(1);
    expect(preview.counts.rvSessions).toBe(1);
    purgeBrowserPermanentDelete(storage, "workspace", "w1");

    expect(get<unknown[]>(storage, "rvh.dev.workspaces")).toEqual([]);
    expect(get<unknown[]>(storage, "rvh.dev.rv_sessions")).toEqual([]);
    const version = get<Array<Record<string, unknown>>>(storage, "rvh.dev.ai_note_versions")[0];
    expect(version.sourceSessionId).toBeUndefined();
    expect(version.sourceWorkspaceId).toBeUndefined();
    expect(version.sourceSnapshot).toEqual({ workspaceId: "w1", sessionId: "s1" });
  });

  it("deletes Viewer Notes only when the owning Profile itself is purged", () => {
    const storage = new MemoryStorage();
    set(storage, "rvh.dev.profiles", [{ id: "p1", name: "P1", archivedAt: "2026-09-10" }]);
    set(storage, "rvh.dev.ai_identities", [{ id: "ai1", profileId: "p1" }]);
    set(storage, "rvh.dev.ai_note_settings", [{ aiIdentityId: "ai1" }]);
    set(storage, "rvh.dev.ai_note_versions", [{ id: "v1", aiIdentityId: "ai1" }]);
    set(storage, "rvh.dev.ai_note_reflection_runs", [{ id: "r1", aiIdentityId: "ai1" }]);
    set(storage, "rvh.dev.ai_note_activation_events", [{ id: "a1", aiIdentityId: "ai1" }]);

    const preview = previewBrowserPermanentDelete(storage, "profile", "p1");
    expect(preview.viewerNotesDeleted).toBe(1);
    purgeBrowserPermanentDelete(storage, "profile", "p1");
    expect(get<unknown[]>(storage, "rvh.dev.ai_identities")).toEqual([]);
    expect(get<unknown[]>(storage, "rvh.dev.ai_note_versions")).toEqual([]);
  });

  it("blocks standalone deletion of a Training-owned archived session", () => {
    const storage = new MemoryStorage();
    set(storage, "rvh.dev.rv_sessions", [{ id: "s1", workspaceId: "w1", profileId: "p1", sessionCode: "S1", archivedAt: "2026-09-10" }]);
    set(storage, "rvh.dev.training_runs", [{ id: "t1", runNumber: 1, name: "Training", status: "Completed", targetIds: [], sessionIds: ["s1"], archivedAt: "2026-09-10" }]);
    const preview = previewBrowserPermanentDelete(storage, "rv_session", "s1");
    expect(preview.blockedReason).toContain("Training-owned");
    expect(() => purgeBrowserPermanentDelete(storage, "rv_session", "s1")).toThrow(/Training-owned/);
  });

  it("allows a completed historical Research assignment to retain a target id after target purge", () => {
    const storage = new MemoryStorage();
    set(storage, "rvh.dev.targets", [{ id: "u1", collection: "user", title: "Target", archivedAt: "2026-09-10" }]);
    set(storage, "rvh.dev.research_projects", [{ id: "r1", workspaceId: "w1", name: "Done", state: "Complete", config: { targetIds: ["u1"] } }]);
    set(storage, "rvh.dev.research_assignments", [{ id: "a1", researchProjectId: "r1", targetId: "u1" }]);
    purgeBrowserPermanentDelete(storage, "target", "u1");
    expect(get<unknown[]>(storage, "rvh.dev.targets")).toEqual([]);
    expect(get<Array<{ targetId: string }>>(storage, "rvh.dev.research_assignments")[0].targetId).toBe("u1");
  });

  it("blocks My Target purge while unfinished Research still needs the target", () => {
    const storage = new MemoryStorage();
    set(storage, "rvh.dev.targets", [{ id: "u1", collection: "user", title: "Target", archivedAt: "2026-09-10" }]);
    set(storage, "rvh.dev.research_projects", [{ id: "r1", workspaceId: "w1", name: "Live", state: "Locked", config: { targetIds: ["u1"] } }]);
    const preview = previewBrowserPermanentDelete(storage, "target", "u1");
    expect(preview.blockedReason).toContain("unfinished Research");
  });

  it("rolls localStorage back if a staged purge write fails", () => {
    class FailingStorage extends MemoryStorage {
      writes = 0;
      failWrites = false;
      override setItem(key: string, value: string) {
        if (this.failWrites && ++this.writes === 2) throw new Error("quota failure");
        super.setItem(key, value);
      }
    }

    const storage = new FailingStorage();
    set(storage, "rvh.dev.profiles", [{ id: "p1", name: "P1", archivedAt: "2026-09-10" }]);
    set(storage, "rvh.dev.workspaces", [{ id: "w1", profileId: "p1", name: "W1" }]);
    const profilesBefore = storage.getItem("rvh.dev.profiles");
    const workspacesBefore = storage.getItem("rvh.dev.workspaces");
    storage.failWrites = true;
    storage.writes = 0;

    expect(() => purgeBrowserPermanentDelete(storage, "profile", "p1")).toThrow(/quota failure/);
    expect(storage.getItem("rvh.dev.profiles")).toBe(profilesBefore);
    expect(storage.getItem("rvh.dev.workspaces")).toBe(workspacesBefore);
  });

  it("never allows factory Training Targets into Permanent Delete", () => {
    const storage = new MemoryStorage();
    set(storage, "rvh.dev.targets", [{ id: "f1", collection: "training", title: "Factory", archivedAt: "2026-09-10" }]);
    const preview = previewBrowserPermanentDelete(storage, "target", "f1");
    expect(preview.blockedReason).toContain("immutable");
    expect(() => purgeBrowserPermanentDelete(storage, "target", "f1")).toThrow(/immutable/);
  });
});
