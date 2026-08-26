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
});
