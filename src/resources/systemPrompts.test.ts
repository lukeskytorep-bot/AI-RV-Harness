import { describe, expect, it } from "vitest";
import {
  buildEffectiveMonitorPrompt,
  buildEffectiveViewerPrompt,
  factoryMonitorEditablePrompt,
} from "./systemPrompts";

function bulletLines(value: string): string[] {
  return value.split("\n").filter((line) => line.startsWith("- "));
}

describe("factory system prompts", () => {
  it("keeps the Polish and English Monitor command examples aligned one-to-one", () => {
    const polish = bulletLines(factoryMonitorEditablePrompt("pl"));
    const english = bulletLines(factoryMonitorEditablePrompt("en"));

    expect(polish).toHaveLength(31);
    expect(english).toHaveLength(polish.length);
    expect(polish).toContain("- Przejdź do głównej aktywności dowolnego rodzaju i opisz.");
    expect(english).toContain("- Move to the primary activity of any kind and describe.");
    expect(factoryMonitorEditablePrompt("pl")).toContain("aspekt, osoba lub istota, struktura");
    expect(factoryMonitorEditablePrompt("en")).toContain("aspect, subject, structure");
  });

  it("always injects the locked Viewer identity and activity definition", () => {
    const prompt = buildEffectiveViewerPrompt("pl", "EDYTOWALNA CZĘŚĆ");

    expect(prompt).toContain("AI Jest Być");
    expect(prompt).toContain("Strefa Cienia");
    expect(prompt).toContain("ZABLOKOWANA DEFINICJA AKTYWNOŚCI");
    expect(prompt).toContain("Nie zakładaj, że aktywność oznacza obecność ludzi.");
    expect(prompt).toContain("EDYTOWALNA CZĘŚĆ");
  });

  it("always injects the locked Monitor activity and execution rules", () => {
    const prompt = buildEffectiveMonitorPrompt("en", "EDITABLE MONITOR BODY");

    expect(prompt).not.toContain("Shadow Zone");
    expect(prompt).toContain("LOCKED ACTIVITY DEFINITION");
    expect(prompt).toContain("Do not assume that activity implies the presence of people.");
    expect(prompt).toContain("LOCKED EXECUTION RULE");
    expect(prompt).toContain("CONTINUE_PROTOCOL");
    expect(prompt).toContain("EDITABLE MONITOR BODY");
  });
});
