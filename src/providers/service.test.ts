import { describe, expect, it } from "vitest";
import { credentialHint } from "./service";

describe("credential presentation", () => {
  it("never returns the full API key", () => {
    const secret = ["sk-or-", "v1-unit-test-secret-92F"].join("");
    const masked = credentialHint(secret);
    expect(masked).toBe("sk-or-••••••••92F");
    expect(masked).not.toContain("super-secret");
  });
});
