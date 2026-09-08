import { describe, expect, it } from "vitest";
import browserFacade from "./browserRepository.ts?raw";
import contract from "./repository.ts?raw";
import sqliteFacade from "./sqliteRepository.ts?raw";

const methods = [
  "ensureAiIdentity", "listAiIdentities", "getViewerNoteBundle", "listViewerNoteVersions", "listViewerNoteActivationEvents",
  "listViewerNoteReflectionRuns", "setViewerNoteCapacity", "setViewerNotesDefaultEnabled", "beginViewerNoteReflection",
  "failViewerNoteReflection", "commitViewerNoteReflection", "restoreViewerNoteVersion",
] as const;

describe("AI Center repository boundary", () => {
  it("keeps AppRepository stable and delegates the complete AI identity/Viewer Notes surface", () => {
    expect(contract).toContain("ensureAiIdentity(input");
    expect(contract).toContain("restoreViewerNoteVersion(aiIdentityId");
    expect(browserFacade).toContain("new BrowserAiCenterRepository()");
    expect(sqliteFacade).toContain("new SqliteAiCenterRepository({");
    for (const method of methods) {
      expect(browserFacade).toContain(`${method}: AppRepository[\"${method}\"]`);
      expect(sqliteFacade).toContain(`${method}: AppRepository[\"${method}\"]`);
    }
  });

  it("removes AI Center storage keys, SQL and stale-base implementation from the broad facades", () => {
    expect(browserFacade).not.toContain("AI_IDENTITIES_KEY");
    expect(browserFacade).not.toContain('"rvh.dev.ai_note_versions"');
    expect(sqliteFacade).not.toContain("INSERT INTO ai_note_versions");
    expect(sqliteFacade).not.toContain("ai_note_versions_stale_base_guard");
    expect(sqliteFacade).not.toContain("MAX(version_number)");
  });

  it("keeps Judge and Research persistence outside this focused split", () => {
    expect(browserFacade).toContain("recordFrozenJudgeResults: AppRepository[\"recordFrozenJudgeResults\"]");
    expect(sqliteFacade).toContain("recordFrozenJudgeResults: AppRepository[\"recordFrozenJudgeResults\"]");
    expect(browserFacade).toContain("createResearchProject: AppRepository[\"createResearchProject\"]");
    expect(sqliteFacade).toContain("createResearchProject: AppRepository[\"createResearchProject\"]");
  });
});
