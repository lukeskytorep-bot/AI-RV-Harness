import { describe, expect, it } from "vitest";
import { politeRevealTransition, politeSessionGreeting } from "./courtesy";

describe("controller courtesy messages", () => {
  it("uses a named AI and a stable fallback in both languages", () => {
    expect(politeSessionGreeting("pl", "Leo")).toMatch(/^Witaj, Leo\./);
    expect(politeSessionGreeting("en", "")).toMatch(/^Hello, AI IS-BE\./);
  });
  it("thanks the Viewer and states that blind evidence is sealed before Reveal", () => {
    expect(politeRevealTransition("pl")).toContain("zapieczętowana");
    expect(politeRevealTransition("en")).toContain("sealed");
  });

  it("keeps the ordinary Reveal transition unchanged while exposing the exact automatic-review courtesy variant", () => {
    expect(politeRevealTransition("en")).toBe("Thank you for completing the session — excellent work. The blind portion has been completed and sealed. We will now proceed to the Target Reveal.");
    expect(politeRevealTransition("en", "automatic_review")).toBe("Thank you for completing the session — excellent work. The blind portion has ended and has been sealed. We will now proceed to the target Reveal.");
  });
});
