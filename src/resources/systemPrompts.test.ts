import { describe, expect, it } from "vitest";
import {
  buildEffectiveMonitorPrompt,
  buildEffectiveTelepathicMonitorPrompt,
  buildEffectiveViewerPrompt,
  factoryMonitorEditablePrompt,
  localizedMonitorEditablePrompt,
} from "./systemPrompts";

function bulletLines(value: string): string[] {
  return value.split("\n").filter((line) => line.startsWith("- "));
}

describe("factory system prompts", () => {
  it("keeps the accepted Polish and English Monitor command libraries", () => {
    const polish = bulletLines(factoryMonitorEditablePrompt("pl"));
    const english = bulletLines(factoryMonitorEditablePrompt("en"));

    expect(polish).toHaveLength(31);
    expect(english).toHaveLength(33);
    expect(polish).toContain("- Przejdź do głównej aktywności i opisz.");
    expect(english).toContain("- Move to the main reported activity and describe.");
    expect(english).toContain("- Move to the reported location and describe.");
    expect(english).toContain("- Move to the time of the reported event and describe.");
    expect(factoryMonitorEditablePrompt("pl")).toContain("aspekt, podmiot, struktura");
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

  it("upgrades an untouched legacy factory Monitor prompt while preserving custom text", () => {
    const legacy = `You are the AI Monitor conducting a blind Remote Viewing session.\n\n- Probe for and describe movement and activity of any kind.\n- Move to the primary activity of any kind and describe.\n\nDo not alter or add anything to the sealed pre-reveal transcript.`;
    expect(localizedMonitorEditablePrompt(legacy, "pl")).toBe(factoryMonitorEditablePrompt("pl"));
    expect(localizedMonitorEditablePrompt("My genuinely custom Monitor instruction", "pl")).toBe("My genuinely custom Monitor instruction");
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

  it("injects the separate locked nine-step Telepathic Monitor schedule", () => {
    const prompt = buildEffectiveTelepathicMonitorPrompt("en", "EDITABLE TELEPATHIC MONITOR BODY");
    expect(prompt).toContain("LOCKED TELEPATHIC EXECUTION RULE");
    expect(prompt).toContain("Steps 2, 3, 4, 5, 6, 7, and 8");
    expect(prompt).toContain("not invoked after Step 9");
    expect(prompt).toContain("whole session and all data gathered so far");
    expect(prompt).toContain("EDITABLE TELEPATHIC MONITOR BODY");
  });
});
