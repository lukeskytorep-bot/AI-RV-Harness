import { describe, expect, it, vi } from "vitest";
import type { AppRepository } from "../storage/repository";
import type { ResearchConfig, ResearchProjectRecord } from "../research/types";

const { writeExportPackage } = vi.hoisted(() => ({ writeExportPackage: vi.fn() }));
vi.mock("./native", () => ({ writeExportPackage }));

import { exportResearchPackage } from "./research";

describe("save-only Research export", () => {
  it("creates a shareable anonymous evaluator folder and keeps the Blinding Key private", async () => {
    const config: ResearchConfig = {
      schemaVersion: 1, name: "External", workspaceId: "workspace", templateType: "model", sessionLanguage: "pl", protocol: { id: "full-rcp", version: "1.5a" }, targetIds: ["target"], repetitions: 1, requireUnusedTargets: false,
      conditions: [
        { key: "a", label: "Secret condition A", profileId: "profile", providerConfigId: "provider", modelId: "viewer-a", requestedSettings: {} },
        { key: "b", label: "Secret condition B", profileId: "profile", providerConfigId: "provider", modelId: "viewer-b", requestedSettings: {} },
      ], evaluationMode: "save_only", judges: [], randomization: { matchedTargets: true, randomizedExecution: true, randomizedJudgeOrder: true },
    };
    const project: ResearchProjectRecord = { id: "research", workspaceId: "workspace", name: "External", templateType: "model", state: "SessionsComplete", config, configHash: "hash", lockedAt: "now", createdAt: "now", updatedAt: "now" };
    const recordExport = vi.fn();
    const repo = {
      getResearchProject: vi.fn().mockResolvedValue(project),
      getResearchResults: vi.fn().mockResolvedValue(null),
      listResearchAssignments: vi.fn().mockResolvedValue([{ id: "assignment", researchProjectId: "research", anonymousSessionId: "BlindSession_ABCDEF123456", sessionId: "session", targetId: "target", executionOrder: 1, judgeOrder: 1, status: "SessionComplete" }]),
      listBlindingMappings: vi.fn().mockResolvedValue([{ id: "mapping", researchProjectId: "research", anonymousSessionId: "BlindSession_ABCDEF123456", conditionId: "condition", pairKey: "pair", mappingHash: "mapping-hash", createdAt: "now" }]),
      listResearchConditions: vi.fn().mockResolvedValue([{ id: "condition", researchProjectId: "research", conditionKey: "a", config: config.conditions[0] }]),
      listRvSessions: vi.fn().mockResolvedValue([{ id: "session", workspaceId: "workspace", profileId: "profile", sessionCode: "RVH-1", state: "Completed", runType: "automatic", preRevealTranscript: "private transcript", postRevealTranscript: "", targetId: "target", researchProjectId: "research", createdAt: "now", updatedAt: "now" }]),
      getReveal: vi.fn().mockResolvedValue({ source: "automatic_target", text: "Reveal text", artifactManifest: [{ artifactId: "image", path: "/managed/image.png", originalFileName: "image.png", mimeType: "image/png", size: 12, sha256: "a".repeat(64) }], hash: "reveal-hash" }),
      getViewerEvidence: vi.fn().mockResolvedValue("blind Viewer evidence"),
      getSessionSnapshot: vi.fn().mockResolvedValue({ modelId: "viewer-a", providerConfigId: "provider" }),
      listJudgeScores: vi.fn().mockResolvedValue([]),
      listTargetClarifications: vi.fn().mockResolvedValue([]),
      recordExport,
    } as unknown as AppRepository;
    writeExportPackage.mockResolvedValueOnce("/exports/research");

    await expect(exportResearchPackage(repo, "research")).resolves.toEqual({ directory: "/exports/research", manifestHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    const request = writeExportPackage.mock.calls[0][0] as { files: Array<{ relativePath: string; content: string }>; artifactCopies: Array<{ sourcePath: string; relativePath: string }> };
    const paths = request.files.map((file) => file.relativePath);
    expect(paths).toContain("external_evaluation/JUDGE_SYSTEM_PROMPT.txt");
    expect(paths).toContain("external_evaluation/HOW_TO_EVALUATE.md");
    expect(paths).toContain("external_evaluation/BlindSession_ABCDEF123456.json");
    expect(paths).toContain("external_evaluation/BlindSession_ABCDEF123456.md");
    expect(paths).toContain("private_master/blinding/blinding_key.json");
    expect(paths).toContain("private_master/blinding/blinding_key.md");
    expect(paths).toContain("private_master/sessions/BlindSession_ABCDEF123456/complete_session.md");
    expect(paths).toContain("README.md");
    expect(paths.some((path) => path.startsWith("judges/") || path.startsWith("results/"))).toBe(false);
    const publicContent = request.files.filter((file) => file.relativePath.startsWith("external_evaluation/")).map((file) => file.content).join("\n");
    expect(publicContent).not.toContain("Secret condition A");
    expect(publicContent).not.toContain("viewer-a");
    expect(publicContent).toContain("BlindSession_ABCDEF123456_artifacts/artifact_1.png");
    expect(request.artifactCopies).toEqual([{ sourcePath: "/managed/image.png", relativePath: "external_evaluation/BlindSession_ABCDEF123456_artifacts/artifact_1.png" }]);
    expect(recordExport).toHaveBeenCalledWith("workspace", "research", "research_save_only_package", "/exports/research", expect.stringMatching(/^[a-f0-9]{64}$/));
  });
});
