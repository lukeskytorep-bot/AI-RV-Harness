import { describe, expect, it } from "vitest";
import { renderMarkdownExportDocument } from ".";

describe("standard Markdown export document", () => {
  it("keeps canonical metadata order and omits fields that do not apply", () => {
    const content = renderMarkdownExportDocument({
      language: "pl",
      title: "Manualna sesja RV 1",
      metadata: {
        workspace: "Badania",
        profile: "Nemo",
        mode: "Manual RV",
        viewerModel: "openrouter:model",
        createdAt: "2026-09-02T20:34:34Z",
        exportedAt: new Date("2026-09-02T21:18:31Z"),
      },
      body: "## Ed\n\nTreść",
    });

    expect(content).toMatch(/- Przestrzeń robocza: Badania\n- Profil: Nemo\n- Tryb: Manual RV\n- Model Viewera: openrouter:model\n- Utworzono:/);
    expect(content).toContain("- Wyeksportowano:");
    expect(content).not.toContain("Zakończono:");
    expect(content).toContain("---\n\n## Ed\n\nTreść");
  });

  it("renders completion only when a real completion timestamp exists", () => {
    const content = renderMarkdownExportDocument({
      language: "en",
      title: "RVH-1",
      metadata: {
        mode: "Automatic RV",
        state: "Completed",
        createdAt: "2026-09-02T20:34:34Z",
        completedAt: "2026-09-02T20:40:00Z",
        exportedAt: new Date("2026-09-02T21:18:31Z"),
      },
    });

    expect(content).toContain("- Created:");
    expect(content).toContain("- Completed:");
    expect(content).toContain("- Exported:");
  });
});
