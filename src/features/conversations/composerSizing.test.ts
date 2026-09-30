import { describe, expect, it } from "vitest";

import {
  CONVERSATION_COMPOSER_MAX_VISIBLE_LINES,
  calculateConversationComposerSize,
} from "./composerSizing";

const base = {
  minHeight: 50,
  lineHeight: 18,
  verticalPadding: 14,
  viewportHeight: 900,
};

describe("Conversation composer autosizing", () => {
  it("keeps a short message at the minimum height", () => {
    expect(calculateConversationComposerSize({ ...base, scrollHeight: 34 })).toEqual({
      height: 50,
      maxHeight: (18 * CONVERSATION_COMPOSER_MAX_VISIBLE_LINES) + 14,
      overflowY: "hidden",
    });
  });

  it("grows for multiline content", () => {
    expect(calculateConversationComposerSize({ ...base, scrollHeight: 180 }).height).toBe(180);
  });

  it("never exceeds the smaller viewport/visible-line limit", () => {
    const size = calculateConversationComposerSize({ ...base, scrollHeight: 1000, viewportHeight: 600 });
    expect(size.maxHeight).toBe(270);
    expect(size.height).toBe(270);
  });

  it("enables internal vertical scrolling after the limit", () => {
    expect(calculateConversationComposerSize({ ...base, scrollHeight: 1000, viewportHeight: 600 }).overflowY).toBe("auto");
  });

  it("shrinks again when content becomes shorter", () => {
    const expanded = calculateConversationComposerSize({ ...base, scrollHeight: 220 });
    const shrunk = calculateConversationComposerSize({ ...base, scrollHeight: 62 });
    expect(expanded.height).toBe(220);
    expect(shrunk.height).toBe(62);
    expect(shrunk.overflowY).toBe("hidden");
  });

  it("does not let a tiny viewport reduce the composer below its minimum", () => {
    expect(calculateConversationComposerSize({ ...base, scrollHeight: 1000, viewportHeight: 80 })).toEqual({
      height: 50,
      maxHeight: 50,
      overflowY: "auto",
    });
  });
});
