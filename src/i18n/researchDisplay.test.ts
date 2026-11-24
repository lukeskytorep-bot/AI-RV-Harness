import { describe, expect, it } from "vitest";
import { researchAssignmentDisplayStatus, researchConditionDisplayLabel } from "./researchDisplay";

describe("Research display localization", () => {
  it.each(["pl", "en"] as const)("localizes practice labels for %s without changing keys", (ui) => {
    expect(researchConditionDisplayLabel(ui, "practice", "first", "FIRST")).toBe(ui === "pl" ? "PIERWSZA" : "FIRST");
    expect(researchConditionDisplayLabel(ui, "practice", "second", "SECOND")).toBe(ui === "pl" ? "DRUGA" : "SECOND");
  });
  it.each(["pl", "en"] as const)("localizes both stored languages for %s UI", (ui) => {
    for (const label of ["Bez notatek", "No Notes"]) {
      expect(researchConditionDisplayLabel(ui, "viewer_notes", "no_notes", label)).toBe(ui === "pl" ? "Bez notatek" : "No Notes");
    }
    for (const label of ["Zamrożone notatki v12", "Frozen Notes v12"]) {
      expect(researchConditionDisplayLabel(ui, "viewer_notes", "frozen_notes", label)).toBe(ui === "pl" ? "Zamrożone notatki v12" : "Frozen Notes v12");
    }
  });
  it("preserves user labels and unknown keys", () => {
    expect(researchConditionDisplayLabel("pl", "context_instructions", "first", "FIRST")).toBe("FIRST");
    expect(researchConditionDisplayLabel("en", "viewer_notes", "legacy", "Własna etykieta")).toBe("Własna etykieta");
    expect(researchAssignmentDisplayStatus("pl", "future_status")).toBe("future_status");
  });
  it.each(["Pending", "Initializing", "Running", "Interrupted", "ResumeApproved", "RestartApproved", "SessionComplete", "Judged"])("localizes assignment status %s", (status) => {
    expect(researchAssignmentDisplayStatus("pl", status)).not.toBe(status);
    expect(researchAssignmentDisplayStatus("en", status)).toBeTruthy();
  });
});
