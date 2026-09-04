import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppRepository } from "../storage/repository";

const { writeExportPackage } = vi.hoisted(() => ({ writeExportPackage: vi.fn() }));
vi.mock("./native", () => ({ writeExportPackage }));

import { exportSessionRecord } from "./session";

describe("complete session export", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes the readable record to the chosen folder without credential references", async () => {
    const recordExport = vi.fn();
    const repository = {
      listRvSessions: vi.fn().mockResolvedValue([{
        id: "session-1", workspaceId: "workspace-1", profileId: "profile-1", sessionCode: "RVH-ONE",
        state: "Completed", runType: "automatic", preRevealTranscript: "exact instruction\n\nviewer response",
        postRevealTranscript: "viewer review", createdAt: "2026-08-19T10:00:00Z", updatedAt: "2026-08-19T10:10:00Z", completedAt: "2026-08-19T10:10:00Z",
      }]),
      getReveal: vi.fn().mockResolvedValue({ source: "external_mixed", text: "true target", artifactManifest: [{ artifactId: "image", path: "/managed/reveal.png", originalFileName: "target image.png", mimeType: "image/png", size: 123, sha256: "a".repeat(64) }], hash: "reveal-hash" }),
      listJudgeScores: vi.fn().mockResolvedValue([]),
      getSessionSnapshot: vi.fn().mockResolvedValue({
        credentialId: "credential-secret-reference", credentialHint: "should-not-export",
        modelId: "viewer-model", modelRoute: "openrouter:viewer-model",
        protocol: { id: "full-rcp", version: "1.5a" },
      }),
      listWorkspaces: vi.fn().mockResolvedValue([{ id: "workspace-1", name: "Badania" }]),
      listProfiles: vi.fn().mockResolvedValue([{ id: "profile-1", name: "Nemo" }]),
      listTargetClarifications: vi.fn().mockResolvedValue([]),
      recordExport,
    } as unknown as AppRepository;
    writeExportPackage.mockResolvedValueOnce("C:/Chosen/RV_Session_RVH-ONE");

    const result = await exportSessionRecord(repository, "workspace-1", "session-1", "pl", "C:/Chosen", new Date("2026-08-19T11:00:00Z"));

    expect(result).toBe("C:/Chosen/RV_Session_RVH-ONE");
    const request = writeExportPackage.mock.calls[0][0] as { baseDirectory: string; destination: string; files: Array<{ relativePath: string; content: string }>; artifactCopies: Array<{ sourcePath: string; relativePath: string }> };
    expect(request.baseDirectory).toBe("C:/Chosen");
    expect(request.destination).toBe("external");
    const completeSession = request.files.find((file) => file.relativePath === "complete_session.md")?.content ?? "";
    expect(completeSession).toContain("exact instruction");
    expect(completeSession).toContain("true target");
    expect(completeSession).toContain("reveal_files/01_target_image.png");
    expect(completeSession).toContain("- Przestrzeń robocza: Badania");
    expect(completeSession).toContain("- Profil: Nemo");
    expect(completeSession).toContain("- Tryb: Automatyczna sesja RV");
    expect(completeSession).toContain("- Protokół: full-rcp 1.5a");
    expect(completeSession).toContain("- Model Viewera: openrouter:viewer-model");
    expect(completeSession).toContain("- Utworzono:");
    expect(completeSession).toContain("- Zakończono:");
    expect(completeSession).toContain("- Wyeksportowano:");
    expect(request.files).toHaveLength(1);
    expect(request.files.some((file) => file.relativePath.endsWith(".json"))).toBe(false);
    expect(request.files.map((file) => file.content).join("\n")).not.toContain("credential-secret-reference");
    expect(request.artifactCopies).toEqual([{ sourcePath: "/managed/reveal.png", relativePath: "reveal_files/01_target_image.png" }]);
    expect(recordExport).toHaveBeenCalledWith("workspace-1", undefined, "complete_session", result, expect.stringMatching(/^[a-f0-9]{64}$/));
  });
});
