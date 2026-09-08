import { describe, expect, it } from "vitest";
import browserFacade from "./browserRepository.ts?raw";
import contract from "./repository.ts?raw";
import sqliteFacade from "./sqliteRepository.ts?raw";

const judgeMethods = ["recordFrozenJudgeResult", "recordFrozenJudgeResults", "listJudgeScores"] as const;
const researchMethods = ["createResearchProject", "getResearchProject", "listResearchProjects", "setResearchProjectState", "lockResearchProject", "listResearchConditions", "listResearchAssignments", "listBlindingMappings", "updateResearchAssignment", "saveResearchResults", "getResearchResults"] as const;

describe("Judge + Research repository boundary", () => {
  it("keeps AppRepository stable and delegates Judge, Research and export persistence", () => {
    expect(contract).toContain("recordFrozenJudgeResults(results");
    expect(contract).toContain("lockResearchProject(id");
    expect(contract).toContain("recordExport(workspaceId");
    expect(browserFacade).toContain("new BrowserJudgeRepository()");
    expect(browserFacade).toContain("new BrowserResearchRepository()");
    expect(browserFacade).toContain("new BrowserExportRepository()");
    expect(sqliteFacade).toContain("new SqliteJudgeRepository({");
    expect(sqliteFacade).toContain("new SqliteResearchRepository({");
    expect(sqliteFacade).toContain("new SqliteExportRepository({");
    for (const method of [...judgeMethods, ...researchMethods, "recordExport"] as const) {
      expect(browserFacade).toContain(`${method}: AppRepository["${method}"]`);
      expect(sqliteFacade).toContain(`${method}: AppRepository["${method}"]`);
    }
  });

  it("removes Judge/Research/export storage implementation from the broad facades", () => {
    expect(browserFacade).not.toContain("JUDGE_RUNS_KEY");
    expect(browserFacade).not.toContain("RESEARCH_PROJECTS_KEY");
    expect(browserFacade).not.toContain('"rvh.dev.exports"');
    expect(sqliteFacade).not.toContain("INSERT INTO judge_runs");
    expect(sqliteFacade).not.toContain("INSERT INTO research_conditions");
    expect(sqliteFacade).not.toContain("INSERT INTO research_results");
    expect(sqliteFacade).not.toContain("INSERT INTO exports");
  });

  it("routes the existing cross-domain Research guards through ResearchRepository", () => {
    expect(browserFacade).toContain("this.researchRepository.isScoresFrozen(projectId)");
    expect(browserFacade).toContain("this.researchRepository.hasRecordedTargetUse(id)");
    expect(sqliteFacade).toContain("this.researchRepository.isScoresFrozen(projectId)");
  });

  it("keeps auxiliary Workspace Sources and Custom Protocol persistence outside the final split", () => {
    expect(browserFacade).toContain("async listWorkspaceSources(");
    expect(browserFacade).toContain("async listCustomProtocols(");
    expect(sqliteFacade).toContain("async listWorkspaceSources(");
    expect(sqliteFacade).toContain("async listCustomProtocols(");
  });
});
