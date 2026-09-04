import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppRepository } from "../storage/repository";
import type { TargetRecord } from "../targets/types";
import type { TrainingRunRecord } from "./types";

const { writeExportPackage } = vi.hoisted(() => ({ writeExportPackage: vi.fn() }));
vi.mock("../exports/native", () => ({ writeExportPackage }));

import { exportTrainingRun } from "./export";

describe("training export", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes readable Markdown sessions and copies real Reveal images without JSON", async () => {
    const run: TrainingRunRecord = {
      id: "run", runNumber: 1, name: "Training 1", status: "Completed", mode: "partial", profileId: "profile", workspaceId: "workspace", modelRoute: "route", protocolVariant: "extended",
      targetIds: ["target"], completedTargetIds: ["target"], sessionIds: ["session"], currentIndex: 1, categories: [], judgeModelRoutes: [], pauseAfterBlock: false, errors: [], createdAt: "2026-08-21T10:00:00Z", updatedAt: "2026-08-21T10:10:00Z", completedAt: "2026-08-21T10:10:00Z",
    };
    const targets: TargetRecord[] = [{ id: "target", collection: "user", title: "Mój cel", revealText: "Opis celu", tags: [], sourceMetadata: {}, createdAt: "now", updatedAt: "now" }];
    const repository = {
      listRvSessions: vi.fn().mockResolvedValue([{ id: "session", workspaceId: "workspace", profileId: "profile", sessionCode: "RVH-1", state: "Completed", runType: "automatic", preRevealTranscript: "Dokładny prompt\n\nOdpowiedź", postRevealTranscript: `${JSON.stringify({ role: "assistant", content: "Moja samoocena" })}\n`, createdAt: "2026-08-21T10:01:00Z", updatedAt: "2026-08-21T10:09:00Z", completedAt: "2026-08-21T10:09:00Z" }]),
      listWorkspaces: vi.fn().mockResolvedValue([{ id: "workspace", name: "Treningi" }]),
      listProfiles: vi.fn().mockResolvedValue([{ id: "profile", name: "Nemo" }]),
      getSessionSnapshot: vi.fn().mockResolvedValue({ modelRoute: "openrouter:route", protocol: { id: "rv-lite", version: "1.0" } }),
      getReveal: vi.fn().mockResolvedValue({ source: "automatic_target", text: "Opis celu", artifactManifest: [{ artifactId: "image", path: "/managed/photo.webp", originalFileName: "reveal photo.webp", mimeType: "image/webp", size: 50, sha256: "b".repeat(64) }], hash: "h" }),
      listJudgeScores: vi.fn().mockResolvedValue([]),
      recordExport: vi.fn(),
    } as unknown as AppRepository;
    writeExportPackage.mockResolvedValue("C:/Training/Training_001");

    await expect(exportTrainingRun(repository, run, targets, "pl", "C:/Training", true, new Date("2026-08-21T11:00:00Z"))).resolves.toBe("C:/Training/Training_001");
    const request = writeExportPackage.mock.calls[0][0] as { files: Array<{ relativePath: string; content: string }>; artifactCopies: Array<{ sourcePath: string; relativePath: string }> };
    expect(request.files.map((file) => file.relativePath)).toEqual(["summary.md", "sessions/001_RVH-1/complete_session.md"]);
    expect(request.files[1].content).toContain("Moja samoocena");
    expect(request.files[1].content).toContain("reveal_files/01_reveal_photo.webp");
    expect(request.files[0].content).toContain("- Przestrzeń robocza: Treningi");
    expect(request.files[0].content).toContain("- Profil: Nemo");
    expect(request.files[0].content).toContain("- Postęp: 1/1");
    expect(request.files[0].content).toContain("- Zakończono:");
    expect(request.files[0].content).toContain("- Wyeksportowano:");
    expect(request.files[1].content).toContain("- Tryb: Trening — sesja RV");
    expect(request.files[1].content).toContain("- Protokół: rv-lite 1.0");
    expect(request.files[1].content).toContain("- Zakończono:");
    expect(request.files.some((file) => file.relativePath.endsWith(".json"))).toBe(false);
    expect(request.artifactCopies).toEqual([{ sourcePath: "/managed/photo.webp", relativePath: "sessions/001_RVH-1/reveal_files/01_reveal_photo.webp" }]);
  });
});
