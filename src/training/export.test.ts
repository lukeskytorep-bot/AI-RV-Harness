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
      targetIds: ["target"], completedTargetIds: ["target"], sessionIds: ["session"], currentIndex: 1, categories: [], judgeModelRoutes: ["openrouter:judge"], pauseAfterBlock: false, errors: [], createdAt: "2026-08-21T10:00:00Z", updatedAt: "2026-08-21T10:10:00Z", completedAt: "2026-08-21T10:10:00Z",
    };
    const targets: TargetRecord[] = [{ id: "target", collection: "user", title: "Mój cel", revealText: "Opis celu", tags: [], sourceMetadata: {}, createdAt: "now", updatedAt: "now" }];
    const repository = {
      listSessionEvents: vi.fn().mockResolvedValue([]),
      listRvSessions: vi.fn().mockResolvedValue([{ id: "session", workspaceId: "workspace", profileId: "profile", sessionCode: "RVH-1", state: "Completed", runType: "automatic", preRevealTranscript: "Dokładny prompt\n\nOdpowiedź", postRevealTranscript: `${JSON.stringify({ role: "assistant", content: "Moja samoocena" })}\n`, createdAt: "2026-08-21T10:01:00Z", updatedAt: "2026-08-21T10:09:00Z", completedAt: "2026-08-21T10:09:00Z" }]),
      listWorkspaces: vi.fn().mockResolvedValue([{ id: "workspace", name: "Treningi" }]),
      listProfiles: vi.fn().mockResolvedValue([{ id: "profile", name: "Nemo" }]),
      getSessionSnapshot: vi.fn().mockResolvedValue({ modelRoute: "openrouter:route", protocol: { id: "rv-lite", version: "1.0" } }),
      getReveal: vi.fn().mockResolvedValue({ source: "automatic_target", text: "Opis celu", artifactManifest: [{ artifactId: "image", path: "/managed/photo.webp", originalFileName: "reveal photo.webp", mimeType: "image/webp", size: 50, sha256: "b".repeat(64) }], hash: "h" }),
      listJudgeScores: vi.fn().mockResolvedValue([{ id: "score", judgeRunId: "judge-run", judgeIndex: 1, modelRoute: "openrouter:judge", gestalt: 2.5, verifiableFeatures: 2, activityFunctionEvent: 1.5, confabulationControl: 1, total: 7, narrative: { strongestMatches: ["silna struktura"], majorMissesContradictions: ["brak koloru"], confabulationObservations: ["niepoparta etykieta"], conciseRationale: "Istotna zgodność." }, frozenAt: "now", createdAt: "now" }]),
      listTargetClarifications: vi.fn().mockResolvedValue([]),
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
    expect(request.files[1].content).toContain("Judge 1 — 7.0/10");
    expect(request.files[1].content).toContain("- Model: openrouter:judge");
    expect(request.files[1].content).toContain("- Gestalt: 2.5/3");
    expect(request.files[1].content).toContain("- Sprawdzalne cechy: 2.0/3");
    expect(request.files[1].content).toContain("- Aktywność / funkcja / zdarzenie: 1.5/2");
    expect(request.files[1].content).toContain("- Kontrola konfabulacji: 1.0/2");
    expect(request.files[1].content).toContain("niepoparta etykieta");
    expect(request.files.some((file) => file.relativePath.endsWith(".json"))).toBe(false);
    expect(request.artifactCopies).toEqual([{ sourcePath: "/managed/photo.webp", relativePath: "sessions/001_RVH-1/reveal_files/01_reveal_photo.webp" }]);
  });

  it("keeps Judges separate when two Judge positions use the same model route", async () => {
    const run: TrainingRunRecord = {
      id: "run", runNumber: 2, name: "Training 2", status: "Completed", mode: "partial", profileId: "profile", workspaceId: "workspace", modelRoute: "viewer", protocolVariant: "core",
      targetIds: ["target"], completedTargetIds: ["target"], sessionIds: ["session"], currentIndex: 1, categories: [], judgeModelRoutes: ["openrouter:same", "openrouter:same"], pauseAfterBlock: false, errors: [], createdAt: "2026-09-05T10:00:00Z", updatedAt: "2026-09-05T10:10:00Z", completedAt: "2026-09-05T10:10:00Z",
    };
    const targets: TargetRecord[] = [{ id: "target", collection: "user", title: "Target", revealText: "Reveal", tags: [], sourceMetadata: {}, createdAt: "now", updatedAt: "now" }];
    const score = (judgeIndex: number, total: number) => ({ id: `score-${judgeIndex}`, judgeRunId: `run-${judgeIndex}`, judgeIndex, modelRoute: "openrouter:same", gestalt: 0, verifiableFeatures: 0, activityFunctionEvent: 0, confabulationControl: 0, total, narrative: { strongestMatches: [], majorMissesContradictions: [], confabulationObservations: [], conciseRationale: "" }, frozenAt: "now", createdAt: "now" });
    const repository = {
      listSessionEvents: vi.fn().mockResolvedValue([]),
      listRvSessions: vi.fn().mockResolvedValue([{ id: "session", workspaceId: "workspace", profileId: "profile", sessionCode: "RV-1", state: "Completed", runType: "automatic", preRevealTranscript: "Evidence", postRevealTranscript: "", createdAt: "now", updatedAt: "now" }]),
      listWorkspaces: vi.fn().mockResolvedValue([{ id: "workspace", name: "Workspace" }]),
      listProfiles: vi.fn().mockResolvedValue([{ id: "profile", name: "Profile" }]),
      getSessionSnapshot: vi.fn().mockResolvedValue(null),
      getReveal: vi.fn().mockResolvedValue({ source: "automatic_target", text: "Reveal", hash: "h" }),
      listJudgeScores: vi.fn().mockResolvedValue([score(1, 2), score(2, 8)]),
      listTargetClarifications: vi.fn().mockResolvedValue([]),
      recordExport: vi.fn(),
    } as unknown as AppRepository;
    writeExportPackage.mockResolvedValue("C:/Training/Training_002");

    await exportTrainingRun(repository, run, targets, "en", "C:/Training");
    const request = writeExportPackage.mock.calls[0][0] as { files: Array<{ relativePath: string; content: string }> };
    const summary = request.files.find((file) => file.relativePath === "summary.md")!.content;
    expect(summary).toContain("Judge 1: openrouter:same · 1 sessions · mean 2");
    expect(summary).toContain("Judge 2: openrouter:same · 1 sessions · mean 8");
  });
  it("T1 exports the interrupted active checkpoint settlement even before sessionIds contains it",async()=>{
    const settlement={kind:"viewer_notes",sessionId:"pending",packetHash:"packet",auditId:"audit",settlement:"failed_preserved",version:null,attempts:2,status:"FAILED_PARSE",failureMessage:"Invalid JSON final response"};
    const run={id:"run",runNumber:1,name:"Training",createdAt:"2026-10-15T00:00:00Z",updatedAt:"2026-10-15T00:00:00Z",status:"Interrupted",profileId:"p",workspaceId:"w",sessionIds:[],completedTargetIds:[],targetIds:["t"],categories:[],judgeModelRoutes:[],currentIndex:0,protocolVariant:"extended",activeTargetCheckpoint:{targetId:"t",sessionId:"pending",stage:"field_guide_update_completed"}} as unknown as TrainingRunRecord;
    const repository={listRvSessions:vi.fn(async()=>[]),listWorkspaces:vi.fn(async()=>[]),listProfiles:vi.fn(async()=>[]),listSessionEvents:vi.fn(async()=>[{eventType:"LEARNING_SETTLEMENT",metadata:{settlement}}]),recordExport:vi.fn()} as unknown as AppRepository;
    await exportTrainingRun(repository,run,[],"en");
    expect(repository.listSessionEvents).toHaveBeenCalledWith("pending");
    const files=writeExportPackage.mock.calls[0][0].files as Array<{relativePath:string;content:string}>;
    const report=files.find(f=>f.relativePath==="learning_settlements.md")!.content;
    expect(report).toContain("Invalid JSON final response");expect(report).toContain("no saved version exists");expect(report).not.toContain("NO_CHANGE");
    expect(files.find(f=>f.relativePath==="learning_settlements.json")!.content).toContain('"activeTargetCheckpoint"');
  });

});
it("T2 exports bounded rejected candidates and validation for offline review without private reasoning",async()=>{
 const {sha256Text}=await import("../application/sha256");const content='{"notes":"literal <think>data</think>"}';
 const finalCandidate={content,contentSha256:await sha256Text(content),byteLength:new TextEncoder().encode(content).length,omittedForSize:false,envelopeRemoved:false,nativeValidation:"rejected"};
 const run={id:"run",runNumber:1,name:"Training",createdAt:"2026-10-16T00:00:00Z",updatedAt:"2026-10-16T00:00:00Z",status:"Interrupted",profileId:"p",workspaceId:"w",sessionIds:[],completedTargetIds:[],targetIds:["t"],categories:[],judgeModelRoutes:[],currentIndex:0,protocolVariant:"extended",activeTargetCheckpoint:{targetId:"t",sessionId:"pending",stage:"field_guide_update_completed"}} as unknown as TrainingRunRecord;
 const repository={listRvSessions:vi.fn(async()=>[]),listWorkspaces:vi.fn(async()=>[]),listProfiles:vi.fn(async()=>[]),listSessionEvents:vi.fn(async()=>[{sessionId:"pending",eventType:"LEARNING_PHYSICAL_ATTEMPT",metadata:{kind:"viewer_notes",packetHash:"packet",slot:0,attemptId:"attempt:1",providerRequestId:"provider-id",validation:"native_rejected",finalCandidate:{...finalCandidate,reasoning:"PRIVATE"},reasoning:"PRIVATE",secret:"SECRET"}}]),recordExport:vi.fn()} as unknown as AppRepository;
 writeExportPackage.mockClear();await exportTrainingRun(repository,run,[],"en");
 const files=writeExportPackage.mock.calls[0][0].files as Array<{relativePath:string;content:string}>;const report=files.find(f=>f.relativePath==="learning_candidates.json")!;
 expect(report.content).not.toMatch(/PRIVATE|SECRET/);expect(JSON.parse(report.content)[0]).toMatchObject({sessionId:"pending",attemptId:"attempt:1",providerRequestId:"provider-id",validation:"native_rejected",finalCandidate});expect(repository.listSessionEvents).toHaveBeenCalledTimes(1);
});

for (const language of ["en", "pl"] as const) it(`T5 ${language}: interrupted first session exports its transcript, checkpoint and distinct memory results once`, async () => {
 const settled = { kind: "field_guide" as const, sessionId: "pending", packetHash: "p", auditId: "fg", settlement: "failed_preserved" as const, version: { id: "v1", contentSha256: "old-hash" }, attempts: 2, status: "FAILED_CAPACITY", failureMessage: "Capacity 3000/2048" };
 const notes = { ...settled, kind: "viewer_notes" as const, auditId: "vn", packetHash: "n", settlement: "model_no_change" as const, status: "NO_CHANGE" };
 const run = { id: "r", runNumber: 1, name: "Interrupted run", createdAt: "2026-10-16", status: "Interrupted", profileId: "p", workspaceId: "w", modelRoute: "saved-provider::saved-model", sessionIds: [], completedTargetIds: [], targetIds: ["t"], judgeModelRoutes: [], protocolVariant: "core", learningSettlements: [settled], activeTargetCheckpoint: { targetId: "t", sessionId: "pending", stage: "viewer_notes_reflection_completed", learningSettlements: [settled, notes] } } as unknown as TrainingRunRecord;
 const repository = {
  listRvSessions: vi.fn(async () => [{ id: "pending", sessionCode: "PENDING", state: "Revealed", preRevealTranscript: "Saved blind response", postRevealTranscript: "", createdAt: "2026-10-16" }]),
  listWorkspaces: vi.fn(async () => []), listProfiles: vi.fn(async () => []),
  listSessionEvents: vi.fn(async () => [{ eventType: "LEARNING_SETTLEMENT", metadata: { settlement: settled } }]),
  getReveal: vi.fn(async () => ({ text: "Saved Reveal", artifactManifest: [] })), getSessionSnapshot: vi.fn(async () => null),
  listJudgeScores: vi.fn(async () => []), listTargetClarifications: vi.fn(async () => []), recordExport: vi.fn(),
 } as unknown as AppRepository;
 writeExportPackage.mockClear(); await exportTrainingRun(repository, run, [], language);
 const files = writeExportPackage.mock.calls[0][0].files as Array<{ relativePath: string; content: string }>;
 const summary = files.find(f => f.relativePath === "summary.md")!.content;
 expect(summary).toContain(language === "pl" ? "Bieżący checkpoint" : "Current checkpoint");
 expect(summary).toContain("viewer_notes_reflection_completed"); expect(summary).toContain("saved-provider::saved-model");
 expect(summary).toContain("sessions/001_PENDING/complete_session.md"); expect(summary).toContain("0/1");
 const transcript = files.find(f => f.relativePath === "sessions/001_PENDING/complete_session.md")!.content;
 expect(transcript).toContain("Saved blind response"); expect(transcript).toContain("Saved Reveal");
 const audit = JSON.parse(files.find(f => f.relativePath === "learning_settlements.json")!.content);
 expect(audit.settlements).toHaveLength(2); expect(audit.settlements).toEqual([settled, notes]);
 expect(files.find(f => f.relativePath === "learning_settlements.md")!.content).toContain("Capacity 3000/2048");
 expect(summary).toContain(language === "pl" ? "Nieudane aktualizacje pamięci: 1" : "Failed memory updates: 1");
});
