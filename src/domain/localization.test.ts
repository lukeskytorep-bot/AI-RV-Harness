import { describe, expect, it } from "vitest";
import { detectInterfaceLanguage, resolveSessionLanguage } from "./localization";

describe("localization", () => {
  it("resolves Same as Interface without translating research resources", () => {
    expect(resolveSessionLanguage("pl", "same")).toBe("pl");
    expect(resolveSessionLanguage("pl", "en")).toBe("en");
  });

  it("defaults only Polish browser locales to Polish", () => {
    expect(detectInterfaceLanguage("pl-PL")).toBe("pl");
    expect(detectInterfaceLanguage("en-US")).toBe("en");
  });
});
