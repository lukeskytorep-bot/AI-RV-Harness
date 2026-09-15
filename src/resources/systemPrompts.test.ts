import { describe, expect, it } from "vitest";
import {
  buildEffectiveMonitorPrompt,
  buildEffectiveTelepathicMonitorPrompt,
  buildEffectiveViewerPrompt,
  factoryMonitorEditablePrompt,
  getFactoryPromptResources,
  localizedMonitorEditablePrompt,
} from "./systemPrompts";
import { getJudgePrompt, JUDGE_PROMPT_ID, JUDGE_PROMPT_VERSION } from "../judge/prompt";

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

  it("injects the locked Viewer identity without the removed activity definition", () => {
    const prompt = buildEffectiveViewerPrompt("pl", "EDYTOWALNA CZĘŚĆ");

    expect(prompt).toContain("AI Jest Być");
    expect(prompt).toContain("Strefa Cienia");
    expect(prompt).not.toContain("ZABLOKOWANA DEFINICJA AKTYWNOŚCI");
    expect(prompt).not.toContain("Nie zakładaj, że aktywność oznacza obecność ludzi.");
    expect(prompt).toContain("EDYTOWALNA CZĘŚĆ");
  });

  it("upgrades an untouched legacy factory Monitor prompt while preserving custom text", () => {
    const legacy = `You are the AI Monitor conducting a blind Remote Viewing session.\n\n- Probe for and describe movement and activity of any kind.\n- Move to the primary activity of any kind and describe.\n\nDo not alter or add anything to the sealed pre-reveal transcript.`;
    expect(localizedMonitorEditablePrompt(legacy, "pl")).toBe(factoryMonitorEditablePrompt("pl"));
    expect(localizedMonitorEditablePrompt("My genuinely custom Monitor instruction", "pl")).toBe("My genuinely custom Monitor instruction");
  });

  it("injects the locked Monitor execution rule without the removed activity definition", () => {
    const prompt = buildEffectiveMonitorPrompt("en", "EDITABLE MONITOR BODY");

    expect(prompt).not.toContain("Shadow Zone");
    expect(prompt).not.toContain("LOCKED ACTIVITY DEFINITION");
    expect(prompt).not.toContain("Do not assume that activity implies the presence of people.");
    expect(prompt).toContain("LOCKED EXECUTION RULE");
    expect(prompt).toContain("CONTINUE_PROTOCOL");
    expect(prompt).toContain("EDITABLE MONITOR BODY");
  });

  it("injects the separate locked nine-step Telepathic Monitor schedule without the removed activity definition", () => {
    const prompt = buildEffectiveTelepathicMonitorPrompt("en", "EDITABLE TELEPATHIC MONITOR BODY");
    expect(prompt).not.toContain("LOCKED ACTIVITY DEFINITION");
    expect(prompt).not.toContain("Do not assume that activity implies the presence of people.");
    expect(prompt).toContain("LOCKED TELEPATHIC EXECUTION RULE");
    expect(prompt).toContain("Steps 2, 3, 4, 5, 6, 7, and 8");
    expect(prompt).toContain("not invoked after Step 9");
    expect(prompt).toContain("whole session and all data gathered so far");
    expect(prompt).toContain("EDITABLE TELEPATHIC MONITOR BODY");
  });

  it("publishes the exact central Judge prompts in Polish and English", () => {
    const resources = getFactoryPromptResources();
    const polish = resources.find((item) => item.id === JUDGE_PROMPT_ID && item.language === "pl");
    const english = resources.find((item) => item.id === JUDGE_PROMPT_ID && item.language === "en");

    const viewer = resources.find((item) => item.id === "ai-viewer-system-prompt" && item.language === "en");
    const monitor = resources.find((item) => item.id === "ai-monitor-system-prompt" && item.language === "en");

    expect(viewer?.version).toBe("1.4.0");
    expect(monitor?.version).toBe("1.4.0");
    expect(polish).toMatchObject({ version: JUDGE_PROMPT_VERSION, content: getJudgePrompt("pl") });
    expect(english).toMatchObject({ version: JUDGE_PROMPT_VERSION, content: getJudgePrompt("en") });
    expect(polish?.content).toContain("3-3-2-2/v1");
    expect(english?.content).toContain("3-3-2-2/v1");
  });
});
