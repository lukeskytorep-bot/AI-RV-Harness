// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { getCopy } from "../../i18n";
import { createDefaultSettings } from "../../startupDefaults";
import { workflowTestRepository } from "../../testing/workflowRepository";
import type { AppRepository } from "../../storage/repository";
import type { TrainingRunRecord } from "../../training/types";
import type { SessionEventInput, SessionEventRecord } from "../../sessions/types";
import { inspectViewerSessionResume } from "../../sessions/viewerResumeDecision";
import { resolveViewerResumeStart } from "../../sessions/viewerResumeLedger";
const mocks = vi.hoisted(() => ({ confirm: vi.fn(), execute: vi.fn() }));
vi.mock("../../components/AppDialogProvider", () => ({ useAppDialogs: () => ({ confirm: mocks.confirm }) }));
vi.mock("./trainingExecution", () => ({ executeTrainingRun: mocks.execute }));
import { TrainingScreen } from "./TrainingScreen";

const mounted: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of mounted.splice(0)) await cleanup(); vi.clearAllMocks(); });

for (const language of ["en", "pl"] as const) for (const scenario of ["cancel", "retry", "unsafe"] as const) it(`T3 ${language}: rendered Resume uses the real resolver; ${scenario}`, async () => {
  const confirmed = scenario === "retry";
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const run = { id: "t3", profileId: "p", workspaceId: "w", name: "T3 history", runNumber: 1, mode: "partial", modelRoute: "pc::m", protocolVariant: "core", status: "Interrupted", targetIds: ["target"], completedTargetIds: [], sessionIds: [], currentIndex: 0, categories: ["mixed_targets"], judgeModelRoutes: [], pauseAfterBlock: false, viewerNotesEnabled: false, errors: [], createdAt: "now", updatedAt: "now", activeTargetCheckpoint: { sessionId: "s", targetId: "target", stage: "blind_running" } } as TrainingRunRecord;
  const metadata = { stepId: "lite:prompt:1:viewer", requestSha256: "hash", attemptId: "old", recoveryLevel: 1, reason: "output_limit", effectiveMaxOutputTokens: 32768 };
  const events: SessionEventRecord[] = [{ id: "old", sessionId: "s", eventType: "VIEWER_OUTPUT_INCOMPLETE", sequenceNumber: 1, metadata, createdAt: "now" }];
  if (scenario === "unsafe") events[0].metadata!.requestSha256 = undefined;
  const append = vi.fn(async (_id: string, event: SessionEventInput) => { const stored = { ...event, id: `e${events.length + 1}`, sessionId: "s", sequenceNumber: events.length + 1, createdAt: "now" }; events.push(stored); return stored; });
  const provider = { id: "pc", provider: "custom_openai", credentialId: "k", enabled: true, label: "P" };
  const model = { providerConfigId: "pc", provider: "custom_openai", modelId: "m", route: "pc::m", capabilities: { inputModalities: ["text"], outputModalities: ["text"], reasoning: { supported: false, efforts: [] }, temperature: { supported: true }, supportedParameters: [] }, pricing: {} };
  const repository = workflowTestRepository({
    listProviderConfigs: async () => [provider], listProviderModels: async () => [model], listTargets: async () => [], listTargetUsage: async () => [],
    listTrainingRuns: async () => [run], listRvSessions: async () => [], listSessionEvents: async () => structuredClone(events),
    appendSessionEvent: append, getRvSession: async () => ({ id: "s", state: "Interrupted" }),
    getSessionSnapshot: async () => null, getReveal: async () => null, listJudgeScores: async () => [], listTargetClarifications: async () => [],
  } as unknown as AppRepository);
  mocks.confirm.mockResolvedValue(confirmed); mocks.execute.mockImplementation(async () => {
    expect(inspectViewerSessionResume(events)).toMatchObject({ kind: "authorized" });
    expect(await resolveViewerResumeStart({ repository, sessionId: "s", stepKey: metadata.stepId, requestSha256: "hash" })).toMatchObject({ startRecoveryLevel: 1, resumeAuthorizationId: expect.any(String) });
    return { run: { ...run, status: "Completed" } };
  });
  const host = document.createElement("div"); document.body.appendChild(host); const root = createRoot(host);
  mounted.push(async () => { await act(async () => root.unmount()); host.remove(); });
  await act(async () => { root.render(<TrainingScreen copy={getCopy(language)} settings={{ ...createDefaultSettings(), interfaceLanguage: language }} profiles={[{ id: "p", name: "P", credentialId: "k", createdAt: "now", updatedAt: "now" }]} workspaces={[]} repository={repository} />); });
  const button = host.querySelector<HTMLButtonElement>(".training-resume-button"); expect(button).not.toBeNull();
  if (scenario === "unsafe") {
    expect(button!.disabled).toBe(true); expect(button!.title).toMatch(/fingerprint/);
    await act(async () => { button!.click(); });
    expect(mocks.confirm).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled(); return;
  }
  expect(button!.disabled).toBe(false);
  await act(async () => { button!.click(); });
  expect(mocks.confirm).toHaveBeenCalledTimes(1);
  expect(mocks.confirm.mock.calls[0][0].description).toContain(language === "pl" ? "Historia prób" : "Attempt history");
  expect(mocks.execute).toHaveBeenCalledTimes(confirmed ? 1 : 0);
  expect(append).toHaveBeenCalledTimes(confirmed ? 1 : 0);
});
