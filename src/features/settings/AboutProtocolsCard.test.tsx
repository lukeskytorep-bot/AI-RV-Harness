import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { getCopy } from "../../i18n";
import { getJudgePrompt, JUDGE_PROMPT_ID, JUDGE_PROMPT_VERSION } from "../../judge/prompt";
import { getFactoryPromptResources } from "../../resources/systemPrompts";
import { AboutProtocolsCard } from "./SettingsScreen";

describe("About & Protocols prompt library", () => {
  it("places AI Judge after Viewer and Monitor and exposes both languages", () => {
    const html = renderToStaticMarkup(<AboutProtocolsCard copy={getCopy("en")} onOpen={vi.fn()} onOpenPrompt={vi.fn()} />);
    const viewer = html.indexOf("AI Viewer System Prompt");
    const monitor = html.indexOf("AI Monitor System Prompt");
    const judge = html.indexOf("AI Judge System Prompt");

    expect(viewer).toBeGreaterThan(-1);
    expect(monitor).toBeGreaterThan(viewer);
    expect(judge).toBeGreaterThan(monitor);
    expect(html).toContain(`v${JUDGE_PROMPT_VERSION}`);
  });

  it("uses the exact runtime Judge prompt for saved Polish and English resources", () => {
    const resources = getFactoryPromptResources().filter((item) => item.id === JUDGE_PROMPT_ID);
    expect(resources).toHaveLength(2);
    expect(resources.find((item) => item.language === "pl")?.content).toBe(getJudgePrompt("pl"));
    expect(resources.find((item) => item.language === "en")?.content).toBe(getJudgePrompt("en"));
  });
});
