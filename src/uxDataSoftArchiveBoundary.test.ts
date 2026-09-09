import { describe, expect, it } from "vitest";

import settingsScreen from "./features/settings/SettingsScreen.tsx?raw";
import targetsScreen from "./features/targets/TargetsScreen.tsx?raw";
import browserFacade from "./storage/browserRepository.ts?raw";
import contract from "./storage/repository.ts?raw";
import sqliteFacade from "./storage/sqliteRepository.ts?raw";
import migration from "../src-tauri/migrations/021_soft_archive_lifecycle.sql?raw";

describe("UX-DATA-6 soft archive boundary", () => {
  it("adds archive state only to the four newly managed data domains", () => {
    for (const table of ["rv_sessions", "training_runs", "research_projects", "targets"]) {
      expect(migration).toContain(`ALTER TABLE ${table} ADD COLUMN archived_at TEXT`);
    }
    expect(migration).not.toContain("DELETE FROM");
    expect(migration).not.toContain("viewer_notes");
  });

  it("exposes Archive/Restore without introducing permanent-delete contracts", () => {
    for (const fragment of [
      "listArchivedRvSessions()", "archiveRvSession(id", "restoreRvSession(id",
      "listArchivedTrainingRuns()", "archiveTrainingRun(id", "restoreTrainingRun(id",
      "listArchivedResearchProjects()", "archiveResearchProject(id", "restoreResearchProject(id",
      "listArchivedTargets()", "archiveTarget(id", "restoreTarget(id",
    ]) expect(contract).toContain(fragment);
    expect(contract).not.toContain("deleteTarget(");
    expect(contract).not.toContain("purgeTraining");
    expect(contract).not.toContain("purgeResearch");
    expect(contract).not.toContain("purgeRvSession");
  });

  it("keeps Training and Research sessions owned by their parent lifecycle", () => {
    for (const facade of [browserFacade, sqliteFacade]) {
      expect(facade).toContain("Research-owned sessions are archived with their Research project.");
      expect(facade).toContain("Training-owned sessions are archived with their Training run.");
      expect(facade).toContain("this.sessionsRepository.archiveRvSession(sessionId)");
      expect(facade).toContain("this.sessionsRepository.restoreRvSession(sessionId)");
      expect(facade).toContain("this.trainingRepository.archiveTrainingRun(id)");
      expect(facade).toContain("this.researchRepository.archiveResearchProject(id)");
    }
  });

  it("routes every new archive type into the central Archive and recovery surface", () => {
    for (const method of [
      "listArchivedRvSessions", "listArchivedTrainingRuns", "listArchivedResearchProjects", "listArchivedTargets",
      "restoreRvSession", "restoreTrainingRun", "restoreResearchProject", "restoreTarget",
    ]) expect(settingsScreen).toContain(method);
    expect(settingsScreen).toContain("permanent deletion is not part of this update");
  });

  it("changes My Targets from direct deletion to soft archive and keeps factory targets outside it", () => {
    expect(targetsScreen).toContain("archiveFeatureTarget");
    expect(targetsScreen).toContain("target.collection === \"user\"");
    expect(targetsScreen).not.toContain("deleteFeatureTarget");
    expect(targetsScreen).not.toContain("deleteTarget(");
  });
});
