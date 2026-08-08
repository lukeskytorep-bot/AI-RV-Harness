import { describe, expect, it } from "vitest";
import { buildConversationPayload, buildManualRvPayload, type ScopedChatMessage } from "./chatContext";

const mixedHistory: ScopedChatMessage[] = [
  { id: "c1", scope: "conversation", role: "user", content: "How are you?" },
  { id: "c2", scope: "conversation", role: "assistant", content: "Good — what are we building?" },
  { id: "r1", scope: "manual_rv", role: "user", content: "Begin blind session 4831." },
  { id: "r2", scope: "manual_rv", role: "assistant", content: "First contact: hard, cool." },
];

describe("chat context isolation", () => {
  it("Conversation includes only Conversation history plus its system prompt", () => {
    const payload = buildConversationPayload({
      systemPrompt: "Be an active conversational partner.",
      history: mixedHistory,
      currentUserMessage: "Continue our conversation.",
    });

    expect(payload[0]).toEqual({ role: "system", content: "Be an active conversational partner." });
    expect(JSON.stringify(payload)).not.toContain("Begin blind session");
    expect(JSON.stringify(payload)).toContain("How are you?");
  });

  it("Manual RV never inherits Conversation prompt or Conversation history", () => {
    const payload = buildManualRvPayload({
      history: mixedHistory,
      currentUserMessage: "Move to the next vector.",
    });
    const wire = JSON.stringify(payload);

    expect(payload.some((message) => message.role === "system")).toBe(false);
    expect(wire).not.toContain("How are you?");
    expect(wire).not.toContain("active conversational partner");
    expect(wire).toContain("Begin blind session 4831");
  });

  it("Manual RV accepts only an explicitly supplied system instruction", () => {
    const payload = buildManualRvPayload({
      history: [],
      currentUserMessage: "Start.",
      explicitSystemInstruction: "User-approved RV instruction only.",
    });

    expect(payload[0]).toEqual({ role: "system", content: "User-approved RV instruction only." });
  });
});
