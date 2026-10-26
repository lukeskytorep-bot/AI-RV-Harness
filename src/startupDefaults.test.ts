import { describe, expect, it } from "vitest";
import {
  applyStoredOutputSettings,
  CONVERSATION_OUTPUT_BUDGET_VERSION,
  createDefaultSettings,
  DEFAULT_INTERFACE_LANGUAGE,
  DEFAULT_THEME,
  MIN_CONVERSATION_MAX_OUTPUT_TOKENS,
  MIN_RV_SESSION_MAX_OUTPUT_TOKENS,
  storedOutputSettingsNeedUpgrade,
} from "./startupDefaults";

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

describe("Settings output floors", () => {
  it("uses 16K for Conversation and RV Sessions while leaving the global legacy default at 8K", () => {
    const settings = createDefaultSettings();
    expect(settings).toMatchObject({
      conversationMaxOutputTokens: 16384,
      rvSessionMaxOutputTokens: 16384,
      defaultMaxOutputTokens: 8192,
      conversationOutputBudgetVersion: CONVERSATION_OUTPUT_BUDGET_VERSION,
    });
    expect(applyStoredOutputSettings(settings, {})).toMatchObject({
      conversationMaxOutputTokens: 16384,
      rvSessionMaxOutputTokens: 16384,
      defaultMaxOutputTokens: 8192,
    });
  });

  it.each([8000, 8192, 12000, 16383])("upgrades both stored fields below the floor: %s", (value) => {
    const stored = {
      ...createDefaultSettings(),
      conversationOutputBudgetVersion: 1,
      conversationMaxOutputTokens: value,
      rvSessionMaxOutputTokens: value,
    };
    expect(storedOutputSettingsNeedUpgrade(stored)).toBe(true);
    expect(applyStoredOutputSettings({ ...createDefaultSettings(), ...stored }, stored)).toMatchObject({
      conversationMaxOutputTokens: MIN_CONVERSATION_MAX_OUTPUT_TOKENS,
      rvSessionMaxOutputTokens: MIN_RV_SESSION_MAX_OUTPUT_TOKENS,
    });
  });

  it.each([16384, 32768, 49152])("preserves valid user output preferences: %s", (value) => {
    const stored = {
      ...createDefaultSettings(),
      conversationOutputBudgetVersion: 1,
      conversationMaxOutputTokens: value,
      rvSessionMaxOutputTokens: value,
    };
    expect(storedOutputSettingsNeedUpgrade(stored)).toBe(false);
    expect(applyStoredOutputSettings({ ...createDefaultSettings(), ...stored }, stored)).toMatchObject({
      conversationMaxOutputTokens: value,
      rvSessionMaxOutputTokens: value,
    });
  });

  it("still upgrades low values when the old Conversation migration marker is already present", () => {
    const stored = { ...createDefaultSettings(), conversationOutputBudgetVersion: 1, conversationMaxOutputTokens: 8192, rvSessionMaxOutputTokens: 8192 };
    expect(storedOutputSettingsNeedUpgrade(stored)).toBe(true);
    const upgraded = applyStoredOutputSettings({ ...createDefaultSettings(), ...stored }, stored);
    expect(upgraded).toMatchObject({ conversationMaxOutputTokens: 16384, rvSessionMaxOutputTokens: 16384, conversationOutputBudgetVersion: 1 });
    expect(storedOutputSettingsNeedUpgrade(upgraded)).toBe(false);
    expect(applyStoredOutputSettings({ ...createDefaultSettings(), ...upgraded }, upgraded)).toEqual(upgraded);
  });

  it("uses the legacy single setting only as an upgrade seed and does not change unrelated settings", () => {
    const next = { ...createDefaultSettings(), requestTimeoutMs: 333_000, maxRetries: 5, defaultMaxOutputTokens: 8192 };
    const result = applyStoredOutputSettings(next, { defaultMaxOutputTokens: 8192, requestTimeoutMs: 333_000, maxRetries: 5 });
    expect(result).toMatchObject({
      conversationMaxOutputTokens: 16384,
      rvSessionMaxOutputTokens: 16384,
      defaultMaxOutputTokens: 8192,
      requestTimeoutMs: 333_000,
      maxRetries: 5,
    });
  });
});
