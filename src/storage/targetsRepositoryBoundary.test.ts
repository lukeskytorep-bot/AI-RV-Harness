import { describe, expect, it } from "vitest";
import browserFacade from "./browserRepository.ts?raw";
import contract from "./repository.ts?raw";
import sqliteFacade from "./sqliteRepository.ts?raw";

describe("Targets repository boundary", () => {
  it("keeps AppRepository stable and delegates the complete Targets persistence surface", () => {
    expect(contract).toContain("listTargets(collection?");
    expect(contract).toContain("recordTargetUsage(input");
    expect(browserFacade).toContain("new BrowserTargetsRepository({");
    expect(sqliteFacade).toContain("new SqliteTargetsRepository({");
    for (const method of ["listTargets", "createTarget", "updateTarget", "deleteTarget", "recordTargetUsage", "listTargetUsage"]) {
      expect(browserFacade).toContain(`${method}: AppRepository[\"${method}\"]`);
      expect(sqliteFacade).toContain(`${method}: AppRepository[\"${method}\"]`);
    }
    expect(browserFacade).toContain("hasRecordedUse:");
  });
});
