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
        postRevealTranscript: "viewer review", createdAt: "2026-08-19T10:00:00Z", updatedAt: "2026-08-19T10:10:00Z",
      }]),
      getReveal: vi.fn().mockResolvedValue({ source: "external_text", text: "true target", hash: "reveal-hash" }),
      listJudgeScores: vi.fn().mockResolvedValue([]),
      getSessionSnapshot: vi.fn().mockResolvedValue({ credentialId: "credential-secret-reference", credentialHint: "should-not-export" }),
      listTargetClarifications: vi.fn().mockResolvedValue([]),
      recordExport,
    } as unknown as AppRepository;
    writeExportPackage.mockResolvedValueOnce("C:/Chosen/RV_Session_RVH-ONE");

    const result = await exportSessionRecord(repository, "workspace-1", "session-1", "pl", "C:/Chosen");

    expect(result).toBe("C:/Chosen/RV_Session_RVH-ONE");
    const request = writeExportPackage.mock.calls[0][0] as { baseDirectory: string; destination: string; files: Array<{ relativePath: string; content: string }> };
    expect(request.baseDirectory).toBe("C:/Chosen");
    expect(request.destination).toBe("external");
    expect(request.files.find((file) => file.relativePath === "complete_session.md")?.content).toContain("exact instruction");
    expect(request.files.find((file) => file.relativePath === "complete_session.md")?.content).toContain("true target");
    const snapshot = request.files.find((file) => file.relativePath === "session_snapshot.json")?.content ?? "";
    expect(snapshot).not.toContain("credential-secret-reference");
    expect(snapshot).not.toContain("should-not-export");
    expect(recordExport).toHaveBeenCalledWith("workspace-1", undefined, "complete_session", result, expect.stringMatching(/^[a-f0-9]{64}$/));
  });
});
