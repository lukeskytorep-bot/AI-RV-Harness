// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TrainingScreen } from "./TrainingScreen";
import { workflowTestRepository } from "../../testing/workflowRepository";
import { createDefaultSettings } from "../../startupDefaults";
import { getCopy } from "../../i18n";
import type { AppRepository } from "../../storage/repository";
import type { TrainingRunRecord } from "../../training/types";
const mocks = vi.hoisted(() => ({ resume: vi.fn(), execute: vi.fn(), export: vi.fn(), directory: vi.fn() }));
vi.mock("../../storage", () => ({ isTauriRuntime: () => true }));
vi.mock("../../storage/native", () => ({ chooseDirectory: mocks.directory }));
vi.mock("../../training/export", () => ({ exportTrainingRun: mocks.export }));
vi.mock("../../components/AppDialogProvider", () => ({ useAppDialogs: () => ({ confirm: vi.fn(), information: vi.fn() }) }));
vi.mock("./trainingResumeRecovery", () => ({ prepareTrainingRunResume: mocks.resume }));
vi.mock("./trainingExecution", () => ({ executeTrainingRun: mocks.execute }));
const provider = { id: "pc", provider: "custom_openai", credentialId: "key", enabled: true, label: "Saved connection", lastStatus: "ok" };
const model = (modelId: string) => ({ providerConfigId: "pc", provider: "custom_openai", modelId, displayName: modelId, capabilities: { inputModalities: ["text"], outputModalities: ["text"], reasoning: { supported: false, efforts: [] }, temperature: { supported: true }, supportedParameters: [] }, pricing: {} });
const profiles = [ { id: "p", name: "Saved Viewer", credentialId: "key", defaultViewerModelId: "new-default", createdAt: "t", updatedAt: "t" }, { id: "q", name: "Other Viewer", credentialId: "key", defaultViewerModelId: "other-default", createdAt: "t", updatedAt: "t" } ];
let root: Root, host: HTMLDivElement, run: TrainingRunRecord, repository: AppRepository;
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
let previous: boolean | undefined;
beforeEach(() => {
 previous = environment.IS_REACT_ACT_ENVIRONMENT; environment.IS_REACT_ACT_ENVIRONMENT = true;
 host = document.createElement("div"); document.body.append(host); root = createRoot(host);
 run = { id: "run", runNumber: 1, name: "Saved Training", status: "Interrupted", mode: "partial", profileId: "p", workspaceId: "w", modelRoute: "pc::saved-model", protocolVariant: "extended", targetIds: ["t"], completedTargetIds: [], sessionIds: [], currentIndex: 0, categories: [], judgeModelRoutes: [], pauseAfterBlock: false, errors: [], createdAt: "2026-10-16", updatedAt: "2026-10-16", activeTargetCheckpoint: { targetId: "t", sessionId: "s", stage: "review_completed" } };
 repository = workflowTestRepository({ listProviderConfigs: vi.fn(async () => [provider]), listProviderModels: vi.fn(async () => [model("saved-model"), model("new-default"), model("other-default")]), listTargets: vi.fn(async () => []), listTargetUsage: vi.fn(async () => []), listTrainingRuns: vi.fn(async () => [run]), listSessionEvents: vi.fn(async () => []), updateTrainingRun: vi.fn(async () => run) }) as unknown as AppRepository;
 mocks.resume.mockReset().mockImplementation(async () => run); mocks.execute.mockReset(); mocks.directory.mockReset().mockResolvedValue("C:/export"); mocks.export.mockReset().mockResolvedValue("C:/export/run");
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); environment.IS_REACT_ACT_ENVIRONMENT = previous; });
async function mount(language: "en" | "pl") { await act(async () => root.render(<TrainingScreen copy={getCopy(language)} settings={{ ...createDefaultSettings(), interfaceLanguage: language }} profiles={profiles} workspaces={[]} repository={repository} />)); }
function button(text: string) { const found = [...host.querySelectorAll("button")].find(b => b.textContent === text || b.getAttribute("aria-label") === text); if (!found) throw new Error(`Missing ${text}`); return found; }
for (const language of ["en", "pl"] as const) {
 it(`T5 ${language}: changing the new-run profile/default cannot change the saved run's Viewer on Resume`, async () => {
  let finish!: (value: unknown) => void;
  mocks.execute.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount(language);
  const select = host.querySelector("select")!;
  await act(async () => { select.value = "q"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(host.querySelector('.training-viewer-model-card')?.textContent).toContain("other-default");
  const history = host.querySelector(".training-run-list article")!;
  expect(history.textContent).toContain("Saved Viewer"); expect(history.textContent).toContain("pc::saved-model");
  await act(async () => button(language === "pl" ? "Wznów" : "Resume").click());
  const request = mocks.execute.mock.calls[0][0];
  expect(request.profile.id).toBe("p"); expect(request.model.modelId).toBe("saved-model"); expect(request.initial.modelRoute).toBe("pc::saved-model");
  expect(host.querySelector(".active-training-run")?.textContent).toContain("Saved Viewer · pc::saved-model");
  expect(select.disabled).toBe(true);
  await act(async () => finish({ run }));
 });
 it(`T5 ${language}: export is reachable for the first interrupted checkpoint with zero completed sessions`, async () => {
  await mount(language);
  expect(host.querySelectorAll(".active-training-run")).toHaveLength(1);
  await act(async () => button(language === "pl" ? "Zapisz cały trening" : "Save complete training").click());
  expect(mocks.directory).toHaveBeenCalledTimes(1);
  expect(mocks.export).toHaveBeenCalledWith(repository, expect.objectContaining({ id: "run", sessionIds: [], activeTargetCheckpoint: expect.objectContaining({ sessionId: "s" }) }), [], expect.any(String), "C:/export");
  expect(repository.updateTrainingRun).toHaveBeenCalledWith("run", { directoryPath: "C:/export/run" });
 });
 it(`T5 ${language}: learning failures stay out of Training while their audit remains stored`, async () => {
  const failure = { sessionId: "s", packetHash: "fg", auditId: "fg", kind: "field_guide" as const, settlement: "failed_preserved" as const, version: { id: "v1", contentSha256: "h" }, attempts: 2, status: "FAILED_CAPACITY", failureMessage: "Capacity 3000/2048" };
  run = { ...run, status: "Completed", currentIndex: 1, completedTargetIds: ["t"], sessionIds: ["s"], activeTargetCheckpoint: null, learningSettlements: [failure, { ...failure, kind: "viewer_notes", auditId: "vn", packetHash: "vn", version: null, failureMessage: "Malformed JSON" }, { ...failure, auditId: "no-change", packetHash: "later", sessionId: "later", settlement: "model_no_change", status: "NO_CHANGE" }] };
  await mount(language);
  expect(host.querySelector("details.learning-warnings")).toBeNull();
  expect(host.textContent).not.toContain("Capacity 3000/2048");
  expect(host.textContent).not.toContain("Malformed JSON");
  expect(host.textContent).not.toContain(language === "pl" ? "Nieudane aktualizacje pamięci" : "Failed memory updates");
  expect(run.learningSettlements).toHaveLength(3);
  expect(host.querySelector(".training-run-recovery-actions")).toBeNull(); expect(host.querySelector("[role=alert]")).toBeNull();
 });
}
