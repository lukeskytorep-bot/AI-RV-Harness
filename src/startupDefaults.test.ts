import { describe, expect, it } from "vitest";
import { applyStoredOutputSettings, createDefaultSettings, DEFAULT_INTERFACE_LANGUAGE, DEFAULT_THEME } from "./startupDefaults";

describe("first-run defaults", () => {
  it("opens a new installation in English with the soft blue theme", () => {
    const settings = createDefaultSettings();

    expect(DEFAULT_INTERFACE_LANGUAGE).toBe("en");
    expect(DEFAULT_THEME).toBe("blue");
    expect(settings.interfaceLanguage).toBe("en");
    expect(settings.sessionLanguage).toBe("same");
    expect(settings.theme).toBe("blue");
    expect(settings.activeConversationWorkspaceId).toBe("");
    expect(settings.activeRvWorkspaceId).toBe("");
  });
});

describe("B1 output defaults and legacy upgrade", () => {
  it("uses 16K Conversation and retains 8K global/RV defaults on fresh initialization", () => {
    expect(applyStoredOutputSettings(createDefaultSettings(), {})).toMatchObject({
      conversationMaxOutputTokens: 16384, defaultMaxOutputTokens: 8192, rvSessionMaxOutputTokens: 8192,
    });
  });
  for (const value of [4096,40000]) it(`preserves existing Conversation preference ${value}`, () => {
    const stored={conversationMaxOutputTokens:value,rvSessionMaxOutputTokens:8192};
    expect(applyStoredOutputSettings({...createDefaultSettings(),...stored},stored).conversationMaxOutputTokens).toBe(value);
  });
  it("seeds missing values from a stored single legacy setting", () => {
    expect(applyStoredOutputSettings(createDefaultSettings(),{defaultMaxOutputTokens:8192})).toMatchObject({conversationMaxOutputTokens:16384,rvSessionMaxOutputTokens:8192});
  });
  it("preserves present per-mode settings when only the other mode needs upgrade", () => {
    expect(applyStoredOutputSettings(createDefaultSettings(),{defaultMaxOutputTokens:8192,conversationMaxOutputTokens:4096})).toMatchObject({conversationMaxOutputTokens:4096,rvSessionMaxOutputTokens:8192});
    expect(applyStoredOutputSettings(createDefaultSettings(),{rvSessionMaxOutputTokens:4096})).toMatchObject({conversationMaxOutputTokens:16384,rvSessionMaxOutputTokens:4096});
  });
});

for(const previous of [8000,8192]) it(`upgrades old Conversation ${previous} to 16384 exactly once`,()=>{
 const old={conversationMaxOutputTokens:previous,rvSessionMaxOutputTokens:8192};
 const upgraded=applyStoredOutputSettings({...createDefaultSettings(),...old},old);
 expect(upgraded.conversationMaxOutputTokens).toBe(16384);
 expect(upgraded.conversationOutputBudgetVersion).toBe(1);
 const deliberate={...upgraded,conversationMaxOutputTokens:previous};
 expect(applyStoredOutputSettings({...createDefaultSettings(),...deliberate},deliberate).conversationMaxOutputTokens).toBe(previous);
});
it("preserves a future budget upgrade marker",()=>{
 const stored={conversationOutputBudgetVersion:2,conversationMaxOutputTokens:8192};
 expect(applyStoredOutputSettings(createDefaultSettings(),stored)).toMatchObject(stored);
});
