import { describe, expect, it } from "vitest";
import browserFacade from "./browserRepository.ts?raw";
import contract from "./repository.ts?raw";
import sqliteFacade from "./sqliteRepository.ts?raw";

const methods = [
  "createRvSession", "updateRvSessionState", "appendSessionEvent", "listSessionEvents", "updatePreRevealTranscript", "appendPostRevealTurn",
  "saveSessionSnapshot", "getSessionSnapshot", "sealPreReveal", "acceptReveal", "getReveal", "getViewerEvidence", "listRvSessions",
  "addTargetClarification", "listTargetClarifications",
] as const;

describe("Sessions repository boundary", () => {
  it("keeps AppRepository stable and delegates the complete RV session persistence surface", () => {
    expect(contract).toContain("createRvSession(input");
    expect(contract).toContain("listTargetClarifications(sessionId");
    expect(browserFacade).toContain("new BrowserSessionsRepository({");
    expect(sqliteFacade).toContain("new SqliteSessionsRepository({");
    for (const method of methods) {
      expect(browserFacade).toContain(`${method}: AppRepository["${method}"]`);
      expect(sqliteFacade).toContain(`${method}: AppRepository["${method}"]`);
    }
  });

  it("keeps Monitor, Judge, Research and custom protocols outside this focused split", () => {
    expect(browserFacade).toContain("async createMonitorRun(");
    expect(sqliteFacade).toContain("async createMonitorRun(");
    expect(browserFacade).toContain("async recordFrozenJudgeResults(");
    expect(sqliteFacade).toContain("async recordFrozenJudgeResults(");
    expect(browserFacade).toContain("async createResearchProject(");
    expect(sqliteFacade).toContain("async createResearchProject(");
    expect(browserFacade).toContain("async listCustomProtocols(");
    expect(sqliteFacade).toContain("async listCustomProtocols(");
  });

  it("keeps cross-domain Research frozen-score checks explicit at the facade boundary", () => {
    expect(browserFacade).toContain("isResearchScoresFrozen: (projectId)");
    expect(sqliteFacade).toContain("isResearchScoresFrozen: async (projectId)");
  });
});
