import { describe, expect, it } from "vitest";
import { formatResearchPreflightMessage } from "./researchPreflight";

describe("Research Preflight presentation localization", () => {
  it("translates known checks and keeps English output unchanged", () => {
    const message = "Every Context & Instructions condition has a distinct frozen composition hash";
    expect(formatResearchPreflightMessage(message, "pl")).toBe("Każdy warunek kontekstu ma odrębny skrót zamrożonej kompozycji.");
    expect(formatResearchPreflightMessage(message, "en")).toBe(message);
  });
  it("preserves exact user labels and both budget numbers", () => {
    const label = "  My condition $1\nviewer_notes  ";
    const message = `${label}: estimated input plus safety/transport reserves and 65536 reserved output tokens exceed the advertised 65536-token context window`;
    const localized = formatResearchPreflightMessage(message, "pl");
    expect(localized.startsWith(`${label}:`)).toBe(true);
    expect(localized.match(/65536/g)).toHaveLength(2);
    expect(localized).toContain("przekracza");
  });
  it("never discards an unrecognized provider diagnostic", () => {
    const message = "Provider error: raw diagnostic";
    expect(formatResearchPreflightMessage(message, "pl")).toBe(message);
  });
});


it("keeps historical implementation-stage diagnostics out of current UI in both languages", () => {
  const current = "Every Context & Instructions condition is tied to the frozen C2 preparation manifest";
  const historical = "C2 allows Preflight and Experiment Lock only. Session execution remains blocked until the audited C3 runtime/Resume integration.";
  for (const language of ["pl", "en"] as const) {
    expect(formatResearchPreflightMessage(current, language)).not.toMatch(/C2|C3/);
    expect(formatResearchPreflightMessage(historical, language)).not.toMatch(/C2|C3/);
  }
});
