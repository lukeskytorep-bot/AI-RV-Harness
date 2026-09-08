import { describe, expect, it } from "vitest";
import browserFacade from "./browserRepository.ts?raw";
import contract from "./repository.ts?raw";
import sqliteFacade from "./sqliteRepository.ts?raw";

const methods = ["createMonitorRun", "appendMonitorIntervention", "listMonitorRuns", "listMonitorInterventions"] as const;

describe("Monitor repository boundary", () => {
  it("keeps AppRepository stable and delegates the complete Monitor persistence surface", () => {
    expect(contract).toContain("createMonitorRun(input");
    expect(contract).toContain("listMonitorInterventions(monitorRunId");
    expect(browserFacade).toContain("new BrowserMonitorRepository({");
    expect(sqliteFacade).toContain("new SqliteMonitorRepository({");
    for (const method of methods) {
      expect(browserFacade).toContain(`${method}: AppRepository[\"${method}\"]`);
      expect(sqliteFacade).toContain(`${method}: AppRepository[\"${method}\"]`);
    }
  });

  it("removes Monitor storage keys and SQL implementation from the broad facades", () => {
    expect(browserFacade).not.toContain("MONITOR_RUNS_KEY");
    expect(browserFacade).not.toContain('"rvh.dev.monitor_interventions"');
    expect(sqliteFacade).not.toContain("INSERT INTO monitor_runs");
    expect(sqliteFacade).not.toContain("INSERT INTO monitor_interventions");
  });

  it("keeps the browser session lookup explicit at the repository composition boundary", () => {
    expect(browserFacade).toContain("listRvSessions: (workspaceId) => this.sessionsRepository.listRvSessions(workspaceId)");
  });
});
