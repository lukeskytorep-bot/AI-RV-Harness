import { describe, expect, it } from "vitest";
import { buildChatMarkdownExport } from "./export";

describe("chat Markdown export", () => {
  it("exports metadata and chronological UTF-8 messages without secrets", () => {
    const result = buildChatMarkdownExport({
      language: "pl", mode: "conversation",
      thread: { id: "t", workspaceId: "w", mode: "conversation", title: "Rozmowa: Łódź", createdAt: "2026-08-25T10:00:00Z", updatedAt: "2026-08-25T10:00:00Z" },
      workspace: { id: "w", profileId: "p", name: "Badania", createdAt: "x", updatedAt: "x", lastOpenedAt: "x" },
      profile: { id: "p", name: "Leo", humanName: "Edward", credentialId: "secret-id", createdAt: "x", updatedAt: "x" },
      messages: [{ id: "m", threadId: "t", role: "user", content: "Cześć — próba.", createdAt: "2026-08-25T10:01:00Z" }],
      modelId: "model", exportedAt: new Date("2026-08-26T10:00:00Z"),
    });
    expect(result.fileName).toBe("Rozmowa_ Łódź.md");
    expect(result.content).toContain("## Edward");
    expect(result.content).toContain("Cześć — próba.");
    expect(result.content).not.toContain("secret-id");
  });
});
