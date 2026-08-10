import { describe, expect, it } from "vitest";
import type { Profile, Workspace } from "../types";
import { filterWorkspaceDirectory } from "./workspaceDirectory";

const profiles = [
  { id: "p1", name: "Leo", createdAt: "1", updatedAt: "1" },
  { id: "p2", name: "Nemo", createdAt: "1", updatedAt: "1" },
] satisfies Profile[];
const workspaces = [
  { id: "w1", profileId: "p1", name: "Książka", createdAt: "1", updatedAt: "1", lastOpenedAt: "3" },
  { id: "w2", profileId: "p1", name: "Calibration", createdAt: "1", updatedAt: "1", lastOpenedAt: "2" },
  { id: "w3", profileId: "p2", name: "Blind sessions", createdAt: "1", updatedAt: "1", lastOpenedAt: "1" },
] satisfies Workspace[];

describe("workspace directory", () => {
  it("groups every workspace by Profile and keeps recent order", () => {
    const groups = filterWorkspaceDirectory(workspaces, profiles, "");
    expect(groups.flatMap((group) => group.workspaces.map((item) => item.id))).toEqual(["w1", "w2", "w3"]);
  });

  it("searches by workspace or Profile name without Polish diacritic sensitivity", () => {
    expect(filterWorkspaceDirectory(workspaces, profiles, "ksiazka")[0]?.workspaces[0]?.id).toBe("w1");
    expect(filterWorkspaceDirectory(workspaces, profiles, "Nemo").flatMap((group) => group.workspaces).map((item) => item.id)).toEqual(["w3"]);
  });
});
