import { describe, expect, it } from "vitest";

import settingsScreen from "./features/settings/SettingsScreen.tsx?raw";
import browserFacade from "./storage/browserRepository.ts?raw";
import contract from "./storage/repository.ts?raw";
import sqliteFacade from "./storage/sqliteRepository.ts?raw";
import sqlitePurge from "./storage/sqlite/controlledPurge.ts?raw";
import migration from "../src-tauri/migrations/023_controlled_purge.sql?raw";
import tauriLib from "../src-tauri/src/lib.rs?raw";

describe("UX-DATA-8 controlled purge boundary", () => {
  it("registers migration 023 after Viewer Notes source preservation", () => {
    expect(tauriLib).toContain("version: 23");
    expect(tauriLib).toContain('include_str!("../migrations/023_controlled_purge.sql")');
  });

  it("keeps normal immutable guards and opens them only inside an explicit purge context", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS controlled_purge_context");
    expect(migration).toContain("NOT EXISTS (SELECT 1 FROM controlled_purge_context WHERE id = 1)");
    expect(migration).toContain("session snapshots are immutable");
    expect(migration).toContain("frozen Judge result is immutable");
    expect(migration).toContain("locked Research assignments are immutable");
    expect(migration).toContain("target clarifications are immutable supplementary records");
    expect(migration).not.toContain("DROP TRIGGER IF EXISTS prevent_training_target_delete");
    expect(sqlitePurge).toContain("DELETE FROM controlled_purge_context WHERE id = 1");
  });

  it("preserves target identity snapshots before used My Targets can be purged", () => {
    expect(migration).toContain("ALTER TABLE rv_sessions ADD COLUMN target_id_snapshot TEXT");
    expect(migration).toContain("ALTER TABLE research_assignments ADD COLUMN target_id_snapshot TEXT");
    expect(migration).toContain("capture_rv_session_target_snapshot");
    expect(migration).toContain("capture_research_assignment_target_snapshot");
  });

  it("exposes explicit preview and domain purge use cases from AppRepository", () => {
    for (const method of [
      "previewPermanentDelete", "purgeProfile", "purgeWorkspace", "purgeChatThread", "purgeRvSession",
      "purgeTrainingRun", "purgeResearchProject", "purgeTarget",
    ]) {
      expect(contract).toContain(method);
      expect(browserFacade).toContain(`${method}: AppRepository[\"${method}\"]`);
      expect(sqliteFacade).toContain(`${method}: AppRepository[\"${method}\"]`);
    }
  });

  it("keeps Permanent Delete behind Archive and recovery with preview, backup and strong Research confirmation", () => {
    expect(settingsScreen).toContain("previewPermanentDelete");
    expect(settingsScreen).toContain("Deletion Preview");
    expect(settingsScreen).toContain("safetyBackupRecommended");
    expect(settingsScreen).toContain("createPortableStorageBackup");
    expect(settingsScreen).toContain("requiredPhrase: preview.requiresPhrase");
    expect(settingsScreen).toContain("Delete permanently");
  });

  it("does not add an independent purge path for Training/Research-owned sessions", () => {
    expect(sqlitePurge).toContain("Research-owned sessions are deleted with their Research project.");
    expect(sqlitePurge).toContain("Training-owned sessions are deleted with their Training run.");
  });

  it("deletes Profile sessions explicitly before the RESTRICTed Profile row", () => {
    const profilePurge = sqlitePurge.slice(sqlitePurge.indexOf('if (kind === "profile")', sqlitePurge.indexOf("async purge")));
    const sessionDelete = profilePurge.indexOf('this.deleteWhereIn("rv_sessions", "id", scope.sessionIds)');
    const profileDelete = profilePurge.indexOf('DELETE FROM profiles WHERE id = $1');
    expect(sessionDelete).toBeGreaterThan(-1);
    expect(profileDelete).toBeGreaterThan(sessionDelete);
  });
});
