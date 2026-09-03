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

  it("keeps Manual RV time in session metadata but omits it from message headings", () => {
    const result = buildChatMarkdownExport({
      language: "pl", mode: "manual_rv",
      thread: { id: "t", workspaceId: "w", mode: "manual_rv", title: "Manualna sesja RV 1", createdAt: "2026-09-02T20:34:34Z", updatedAt: "2026-09-02T20:35:47Z" },
      workspace: { id: "w", profileId: "p", name: "1", createdAt: "x", updatedAt: "x", lastOpenedAt: "x" },
      profile: { id: "p", name: "Nemo z SP i myśleniem", humanName: "Ed", credentialId: "secret-id", createdAt: "x", updatedAt: "x" },
      messages: [
        { id: "m1", threadId: "t", role: "user", content: "Pierwsza wiadomość", createdAt: "2026-09-02T20:35:34Z" },
        { id: "m2", threadId: "t", role: "assistant", content: "Druga wiadomość", createdAt: "2026-09-02T20:35:47Z" },
      ],
      modelId: "mistralai/devstral-2512", exportedAt: new Date("2026-09-02T21:18:31Z"),
    });

    expect(result.content).toContain("- Utworzono:");
    expect(result.content).toContain("- Wyeksportowano:");
    expect(result.content).toContain("## Ed\n\nPierwsza wiadomość");
    expect(result.content).toContain("## Nemo z SP i myśleniem\n\nDruga wiadomość");
    expect(result.content).not.toContain("## Ed ·");
    expect(result.content).not.toContain("## Nemo z SP i myśleniem ·");
    expect(result.content).not.toContain("secret-id");
  });
});
