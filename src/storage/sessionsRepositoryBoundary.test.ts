import { describe, expect, it } from "vitest";
import browserFacade from "./browserRepository.ts?raw";
import contract from "./repository.ts?raw";
import sqliteFacade from "./sqliteRepository.ts?raw";

const methods = [
  "createRvSession", "updateRvSessionState", "appendSessionEvent", "listSessionEvents", "updatePreRevealTranscript", "appendPostRevealTurn",
  "saveSessionSnapshot", "getSessionSnapshot", "sealPreReveal", "acceptReveal", "getReveal", "getViewerEvidence", "listRvSessions", "listRecentRvSessions",
  "addTargetClarification", "listTargetClarifications",
] as const;

describe("Sessions repository boundary", () => {
  it("keeps the established session surface and delegates the new bounded recent-session query", () => {
    expect(contract).toContain("createRvSession(input");
    expect(contract).toContain("listRecentRvSessions(limit: number)");
    expect(contract).toContain("listTargetClarifications(sessionId");
    expect(browserFacade).toContain("new BrowserSessionsRepository({");
    expect(sqliteFacade).toContain("new SqliteSessionsRepository({");
    for (const method of methods) {
      expect(browserFacade).toContain(`${method}: AppRepository["${method}"]`);
      expect(sqliteFacade).toContain(`${method}: AppRepository["${method}"]`);
    }
    expect(browserFacade).toContain("this.workspacesConversationsRepository.listWorkspaces()");
    expect(sqliteFacade).toContain("this.workspacesConversationsRepository.listWorkspaces()");
  });

  it("keeps Monitor, Judge, Research and custom protocols outside this focused split", () => {
    expect(browserFacade).toContain("this.monitorRepository.createMonitorRun");
    expect(sqliteFacade).toContain("this.monitorRepository.createMonitorRun");
    expect(browserFacade).toContain("recordFrozenJudgeResults: AppRepository[\"recordFrozenJudgeResults\"]");
    expect(sqliteFacade).toContain("recordFrozenJudgeResults: AppRepository[\"recordFrozenJudgeResults\"]");
    expect(browserFacade).toContain("createResearchProject: AppRepository[\"createResearchProject\"]");
    expect(sqliteFacade).toContain("createResearchProject: AppRepository[\"createResearchProject\"]");
    expect(browserFacade).toContain("async listCustomProtocols(");
    expect(sqliteFacade).toContain("async listCustomProtocols(");
  });

  it("keeps cross-domain Research frozen-score checks explicit at the facade boundary", () => {
    const researchDelegation = "isResearchScoresFrozen: (projectId) => this.researchRepository.isScoresFrozen(projectId)";
    expect(browserFacade).toContain(researchDelegation);
    expect(sqliteFacade).toContain(researchDelegation);
  });
});
