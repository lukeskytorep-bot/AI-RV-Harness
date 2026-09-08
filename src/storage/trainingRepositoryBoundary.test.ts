import { describe, expect, it } from "vitest";
import browserFacade from "./browserRepository.ts?raw";
import contract from "./repository.ts?raw";
import sqliteFacade from "./sqliteRepository.ts?raw";

const methods = ["createTrainingRun", "updateTrainingRun", "listTrainingRuns"] as const;

describe("Training repository boundary", () => {
  it("keeps AppRepository stable and delegates the complete Training persistence surface", () => {
    expect(contract).toContain("createTrainingRun(input");
    expect(contract).toContain("updateTrainingRun(id");
    expect(contract).toContain("listTrainingRuns()");
    expect(browserFacade).toContain("new BrowserTrainingRepository(");
    expect(sqliteFacade).toContain("new SqliteTrainingRepository({");
    for (const method of methods) {
      expect(browserFacade).toContain(`${method}: AppRepository[\"${method}\"]`);
      expect(sqliteFacade).toContain(`${method}: AppRepository[\"${method}\"]`);
    }
  });

  it("removes Training storage implementation details from the broad facades", () => {
    expect(browserFacade).not.toContain("TRAINING_RUNS_KEY");
    expect(browserFacade).not.toContain('"rvh.dev.training_runs"');
    expect(sqliteFacade).not.toContain("MAX(run_number)");
    expect(sqliteFacade).not.toContain("INSERT INTO training_runs");
    expect(sqliteFacade).not.toContain("SELECT record_json FROM training_runs");
  });

  it("keeps Sessions, Judge and AI Center persistence outside the Training repository", () => {
    expect(browserFacade).toContain("this.sessionsRepository.createRvSession");
    expect(sqliteFacade).toContain("this.sessionsRepository.createRvSession");
    expect(browserFacade).toContain("async recordFrozenJudgeResults(");
    expect(sqliteFacade).toContain("async recordFrozenJudgeResults(");
    expect(browserFacade).toContain("this.aiCenterRepository.beginViewerNoteReflection");
    expect(sqliteFacade).toContain("this.aiCenterRepository.beginViewerNoteReflection");
  });
});
