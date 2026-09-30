import { describe, expect, it } from "vitest";
import browserFacade from "./browserRepository.ts?raw";
import contract from "./repository.ts?raw";
import sqliteFacade from "./sqliteRepository.ts?raw";

describe("Profiles repository boundary", () => {
  it("keeps the public facade stable and delegates Profile-only persistence", () => {
    expect(contract).toContain("export interface AppRepository");
    expect(browserFacade).toContain("new BrowserProfilesRepository()");
    expect(sqliteFacade).toContain("new SqliteProfilesRepository({");
    expect(browserFacade).toContain("async archiveProfile(id: string)");
    expect(sqliteFacade).toContain("async archiveProfile(id: string)");
  });
});
