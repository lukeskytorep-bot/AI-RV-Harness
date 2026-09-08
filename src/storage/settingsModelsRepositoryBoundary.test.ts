import { describe, expect, it } from "vitest";
import browserFacade from "./browserRepository.ts?raw";
import contract from "./repository.ts?raw";
import sqliteFacade from "./sqliteRepository.ts?raw";

const methods = [
  "loadSettings", "saveSettings", "listProviderConfigs", "createProviderConfig", "updateProviderCredentialMetadata",
  "deleteProviderConfig", "updateProviderConnectionStatus", "listProviderModels", "replaceProviderModels",
  "setProviderModelFavorite", "clearProviderModelCache",
] as const;

describe("Settings and models repository boundary", () => {
  it("keeps AppRepository stable and delegates the complete persistence surface", () => {
    expect(contract).toContain("loadSettings():");
    expect(contract).toContain("listProviderModels(providerConfigId?");
    expect(browserFacade).toContain("new BrowserSettingsModelsRepository({");
    expect(sqliteFacade).toContain("new SqliteSettingsModelsRepository({");
    for (const method of methods) {
      expect(browserFacade).toContain(`${method}: AppRepository[\"${method}\"]`);
      expect(sqliteFacade).toContain(`${method}: AppRepository[\"${method}\"]`);
    }
    expect(browserFacade).toContain("clearProfileReferences:");
    expect(sqliteFacade).toContain("executeTransaction: (statements)");
  });
});
