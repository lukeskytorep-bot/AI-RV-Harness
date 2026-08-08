import { describe, expect, it } from "vitest";
import { getRvLite, renderRvLiteSteps } from "./protocolRegistry";

describe("RV Lite resources", () => {
  it("contains exactly four Viewer prompts in both approved language resources", () => {
    expect(getRvLite("pl").steps).toHaveLength(4);
    expect(getRvLite("en").steps).toHaveLength(4);
    expect(getRvLite("pl").steps[2]).toContain("obowiązkowo wykonaj Deepening Movement");
    expect(getRvLite("en").steps[2]).toContain("MUST perform the Deepening Movement");
    expect(getRvLite("pl").steps[3]).toContain("Krok 4");
    expect(getRvLite("en").steps[3]).toContain("Step 4");
  });

  it("uses the Profile name when present and a natural nameless greeting otherwise", () => {
    const plNamed = renderRvLiteSteps(getRvLite("pl"), "Leo", "RVH-1234");
    const plNameless = renderRvLiteSteps(getRvLite("pl"), "", "RVH-1234");
    const enNamed = renderRvLiteSteps(getRvLite("en"), "Nemo", "RVH-1234");
    const enNameless = renderRvLiteSteps(getRvLite("en"), undefined, "RVH-1234");
    expect(plNamed[0]).toContain("Witaj Leo, przedstawiam układ sesji RV.");
    expect(plNameless[0]).toContain("Witaj, przedstawiam układ sesji RV.");
    expect(enNamed[0]).toContain("Hello, Nemo. I am presenting the structure of an RV session.");
    expect(enNameless[0]).toContain("Hello. I am presenting the structure of an RV session.");
    expect(plNamed[1]).toContain("RVH-1234");
    expect(plNamed.join("\n")).not.toContain("{{PROFILE_NAME_SUFFIX}}");
    expect(enNamed.join("\n")).not.toContain("{{PROFILE_NAME_CLAUSE}}");
  });
});
