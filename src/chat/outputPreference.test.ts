import { describe, expect, it } from "vitest";
import { clampChatOutputTokens, defaultChatOutputTokens, loadChatOutputTokens, saveChatOutputTokens } from "./outputPreference";

describe("per-thread chat output preference", () => {
  it("uses the lower of the application default and model limit", () => {
    expect(defaultChatOutputTokens(12_000, 8_192)).toBe(8_192);
  });

  it("persists a deliberate lower value and only clamps it downward", () => {
    saveChatOutputTokens("thread-persist", 3_000, 8_192);
    expect(loadChatOutputTokens("thread-persist", 8_000, 16_000)).toBe(3_000);
    expect(loadChatOutputTokens("thread-persist", 8_000, 2_000)).toBe(2_000);
  });

  it("rejects invalid values", () => {
    expect(clampChatOutputTokens(0, 8_192)).toBe(1);
  });
});
