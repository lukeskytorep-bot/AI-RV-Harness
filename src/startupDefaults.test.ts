import { describe, expect, it } from "vitest";
import { createDefaultSettings, DEFAULT_INTERFACE_LANGUAGE, DEFAULT_THEME } from "./startupDefaults";

describe("first-run defaults", () => {
  it("opens a new installation in English with the soft Aurora theme", () => {
    const settings = createDefaultSettings();

    expect(DEFAULT_INTERFACE_LANGUAGE).toBe("en");
    expect(DEFAULT_THEME).toBe("aurora");
    expect(settings.interfaceLanguage).toBe("en");
    expect(settings.sessionLanguage).toBe("same");
    expect(settings.theme).toBe("aurora");
  });
});
