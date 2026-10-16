import { workflowTestRepository } from "../../testing/workflowRepository";
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getCopy } from "../../i18n";
import { createDefaultSettings } from "../../startupDefaults";
import type { AppRepository } from "../../storage/repository";
import type { TrainingRunRecord } from "../../training/types";

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  prepareResume: vi.fn(),
  endTraining: vi.fn(),
  executeTraining: vi.fn(),
}));

vi.mock("../../components/AppDialogProvider", () => ({
  useAppDialogs: () => ({
    confirm: mocks.confirm,
    prompt: vi.fn(),
    information: vi.fn(),
  }),
}));
vi.mock("./trainingResumeRecovery", () => ({ prepareTrainingRunResume: mocks.prepareResume }));
vi.mock("./trainingTermination", () => ({ endTrainingRun: mocks.endTraining }));
vi.mock("./trainingExecution", () => ({ executeTrainingRun: mocks.executeTraining }));

import { TrainingScreen } from "./TrainingScreen";

function makeRun(overrides: Partial<TrainingRunRecord> = {}): TrainingRunRecord {
  return {
    id: "run-1",
    runNumber: 1,
    name: "Mounted history run",
    status: "Interrupted",
    mode: "partial",
    profileId: "p",
    workspaceId: "w",
    modelRoute: "route",
    protocolVariant: "extended",
    targetIds: ["t1", "t2"],
    completedTargetIds: ["t1"],
    sessionIds: ["s1"],
    currentIndex: 1,
    categories: ["mixed_targets"],
    judgeModelRoutes: [],
    pauseAfterBlock: false,
    errors: [],
    createdAt: "2026-10-10T12:00:00.000Z",
    updatedAt: "2026-10-10T12:00:00.000Z",
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes(text));
  if (!(found instanceof HTMLButtonElement)) throw new Error(`Missing button containing: ${text}`);
  return found;
}

function buttonByLabel(container: HTMLElement, label: string): HTMLButtonElement {
  const found = container.querySelector(`button[aria-label="${label}"]`);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`Missing button aria-label: ${label}`);
  return found;
}

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("TrainingScreen mounted interactions", () => {
  let host: HTMLDivElement;
  let root: Root;
  let currentRun: TrainingRunRecord;
  let repository: AppRepository;
  let archiveTrainingRun: ReturnType<typeof vi.fn>;
  const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    currentRun = makeRun();
    archiveTrainingRun = vi.fn().mockResolvedValue(undefined);
    repository = workflowTestRepository({
      listProviderConfigs: vi.fn().mockResolvedValue([]),
      listProviderModels: vi.fn().mockResolvedValue([]),
      listTargets: vi.fn().mockResolvedValue([]),
      listTargetUsage: vi.fn().mockResolvedValue([]),
      listTrainingRuns: vi.fn().mockImplementation(async () => [currentRun]),
      archiveTrainingRun,
      listRvSessions: vi.fn().mockResolvedValue([]),
      getReveal: vi.fn().mockResolvedValue(null),
      listJudgeScores: vi.fn().mockResolvedValue([]),
      getSessionSnapshot: vi.fn().mockResolvedValue(null),
      listTargetClarifications: vi.fn().mockResolvedValue([]),
      listSessionEvents: vi.fn().mockResolvedValue([]),
    } as unknown as AppRepository);
    mocks.confirm.mockReset().mockResolvedValue(false);
    mocks.prepareResume.mockReset().mockResolvedValue(null);
    mocks.endTraining.mockReset();
    mocks.executeTraining.mockReset();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const isTooltip = this.getAttribute?.("role") === "tooltip";
      const width = isTooltip ? 150 : 80;
      const height = isTooltip ? 30 : 28;
      return { x: 100, y: 80, left: 100, top: 80, right: 100 + width, bottom: 80 + height, width, height, toJSON: () => ({}) } as DOMRect;
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    document.body.querySelectorAll('[role="tooltip"]').forEach((node) => node.remove());
    vi.restoreAllMocks();
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  async function mount(language: "en" | "pl" = "en") {
    const settings = { ...createDefaultSettings(), interfaceLanguage: language };
    await act(async () => {
      root.render(<TrainingScreen copy={getCopy(language)} settings={settings} profiles={[]} workspaces={[]} repository={repository} />);
      await Promise.resolve();
    });
    await flush();
  }

  for (const language of ["pl", "en"] as const) it(`S3.1 ${language}: Stop next to pause remains stopping until execution settles`, async () => {
    const provider = { id: "pc", provider: "custom_openai", credentialId: "k", enabled: true, label: "P" };
    const model = { providerConfigId: "pc", provider: "custom_openai", modelId: "m", route: "route", capabilities: { inputModalities: ["text"], outputModalities: ["text"], reasoning: { supported: false, efforts: [] }, temperature: { supported: true }, supportedParameters: [] }, pricing: {} };
    (repository.listProviderConfigs as ReturnType<typeof vi.fn>).mockResolvedValue([provider]);
    (repository.listProviderModels as ReturnType<typeof vi.fn>).mockResolvedValue([model]);
    currentRun={...currentRun,modelRoute:"pc::m"};
    mocks.prepareResume.mockResolvedValue(currentRun);
    const task = deferred<{run: TrainingRunRecord;error?: string}>();let signal!: AbortSignal;
    mocks.executeTraining.mockImplementation(request => { signal=request.signal;return task.promise; });
    const settings = {...createDefaultSettings(),interfaceLanguage: language};
    await act(async()=>root.render(<TrainingScreen copy={getCopy(language)} settings={settings} profiles={[{id:"p",name:"P",credentialId:"k",createdAt:"t",updatedAt:"t"}]} workspaces={[]} repository={repository}/>));await flush();
    await click(buttonByText(host,language==="pl"?"Wznów":"Resume"));await flush();
    const stop=buttonByText(host,"Stop");const slot=stop.parentElement;expect(stop.disabled).toBe(false);
    const pause=buttonByText(host,language==="pl"?"Pauza po bieżącej sesji":"Pause after current session");expect(pause.parentElement).toBe(stop.parentElement);
    await click(pause);expect(signal.aborted).toBe(false);await click(stop);expect(signal.aborted).toBe(true);expect(signal.reason.message).toBe("Stopped by user");
    expect(buttonByText(host,language==="pl"?"Zatrzymywanie…":"Stopping…").disabled).toBe(true);expect([...host.querySelectorAll("button")].some(button=>button.textContent?.includes(language==="pl"?"Zakończ trening":"End training"))).toBe(false);
    await act(async()=>task.resolve({run:currentRun,error:"Stopped by user"}));await flush();expect(buttonByText(host,language==="pl"?"Wznów":"Resume").disabled).toBe(false);expect(buttonByText(host,language==="pl"?"Wznów":"Resume").parentElement).toBe(slot);expect(host.querySelectorAll(".active-training-run")).toHaveLength(1);expect(mocks.executeTraining).toHaveBeenCalledTimes(1);
  });

  it("persists End training, removes Resume/End and keeps sessions/history actions", async () => {
    mocks.endTraining.mockImplementation(async () => {
      currentRun = { ...currentRun, status: "Interrupted", termination: { reason: "user_finished", endedAt: "2026-10-10T13:00:00.000Z" } };
      return currentRun;
    });
    await mount();

    await click(buttonByText(host, "End training"));
    await flush();

    expect(mocks.endTraining).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Ended by user");
    expect(host.textContent).not.toContain("End training");
    expect(host.textContent).not.toContain("Resume");
    expect(buttonByLabel(host, "Show sessions")).toBeTruthy();
    expect(buttonByLabel(host, "Save complete training")).toBeTruthy();
    expect(buttonByLabel(host, "Archive training")).toBeTruthy();
  });

  it("keeps Resume available and releases the guard after End persistence fails", async () => {
    mocks.endTraining.mockRejectedValueOnce(new Error("write failed"));
    await mount();

    await click(buttonByText(host, "End training"));
    await flush();

    expect(host.textContent).toContain("write failed");
    expect(buttonByText(host, "Resume").disabled).toBe(false);
    expect(buttonByText(host, "End training").disabled).toBe(false);

    mocks.endTraining.mockImplementationOnce(async () => {
      currentRun = { ...currentRun, termination: { reason: "user_finished", endedAt: "2026-10-10T13:01:00.000Z" } };
      return currentRun;
    });
    await click(buttonByText(host, "End training"));
    expect(mocks.endTraining).toHaveBeenCalledTimes(2);
  });

  it("serializes Resume and End in both click orders", async () => {
    const resume = deferred<TrainingRunRecord | null>();
    mocks.prepareResume.mockReturnValueOnce(resume.promise);
    await mount();

    await click(buttonByText(host, "Resume"));
    expect(buttonByText(host, "End training").disabled).toBe(true);
    buttonByText(host, "End training").click();
    expect(mocks.endTraining).not.toHaveBeenCalled();
    resume.resolve(null);
    await flush();

    const end = deferred<TrainingRunRecord>();
    mocks.endTraining.mockReturnValueOnce(end.promise);
    await click(buttonByText(host, "End training"));
    expect(buttonByText(host, "Resume").disabled).toBe(true);
    buttonByText(host, "Resume").click();
    expect(mocks.prepareResume).toHaveBeenCalledTimes(1);
    currentRun = { ...currentRun, termination: { reason: "user_finished", endedAt: "2026-10-10T13:02:00.000Z" } };
    end.resolve(currentRun);
    await flush();
  });

  it("blocks Archive while Resume waits and blocks Resume while Archive confirmation is open", async () => {
    const resume = deferred<TrainingRunRecord | null>();
    mocks.prepareResume.mockReturnValueOnce(resume.promise);
    await mount();

    await click(buttonByText(host, "Resume"));
    expect(buttonByLabel(host, "Archive training").disabled).toBe(true);
    buttonByLabel(host, "Archive training").click();
    expect(mocks.confirm).not.toHaveBeenCalled();
    resume.resolve(null);
    await flush();

    const confirmation = deferred<boolean>();
    mocks.confirm.mockReturnValueOnce(confirmation.promise);
    await click(buttonByLabel(host, "Archive training"));
    expect(buttonByText(host, "Resume").disabled).toBe(true);
    buttonByText(host, "Resume").click();
    expect(mocks.prepareResume).toHaveBeenCalledTimes(1);
    confirmation.resolve(false);
    await flush();
    expect(buttonByText(host, "Resume").disabled).toBe(false);
    expect(buttonByLabel(host, "Archive training").disabled).toBe(false);
    expect(archiveTrainingRun).not.toHaveBeenCalled();
  });

  it("preserves expanded run and selected session across history collapse/expand", async () => {
    await mount();
    await click(buttonByLabel(host, "Show sessions"));
    const sessionButton = buttonByText(host, "Session 1");
    await click(sessionButton);
    expect(sessionButton.classList.contains("active")).toBe(true);

    await click(buttonByLabel(host, "Collapse training history"));
    expect(host.querySelector("#training-history-panel")?.getAttribute("aria-hidden")).toBe("true");
    await click(buttonByLabel(host, "Expand training history"));

    expect(buttonByLabel(host, "Hide sessions")).toBeTruthy();
    expect(buttonByText(host, "Session 1").classList.contains("active")).toBe(true);
  });

  it("shows portal tooltips on focus/hover in EN and hides collapsed session contents", async () => {
    await mount("en");
    const show = buttonByLabel(host, "Show sessions");
    await act(async () => { show.focus(); await Promise.resolve(); });
    expect(document.body.querySelector('[role="tooltip"]')?.textContent).toBe("Show sessions");
    expect((document.body.querySelector('[role="tooltip"]') as HTMLElement).style.visibility).toBe("visible");
    await act(async () => { show.blur(); await Promise.resolve(); });
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
    const collapsed = host.querySelector("#training-run-sessions-run-1") as HTMLElement;
    expect(collapsed.hidden).toBe(true);

    await click(show);
    const hide = buttonByLabel(host, "Hide sessions");
    expect((host.querySelector("#training-run-sessions-run-1") as HTMLElement).hidden).toBe(false);
    await act(async () => { hide.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); await Promise.resolve(); });
    expect(document.body.querySelector('[role="tooltip"]')?.textContent).toBe("Hide sessions");
  });

  it("shows Polish tooltip labels on keyboard focus", async () => {
    await mount("pl");
    const show = buttonByLabel(host, "Pokaż sesje");
    await act(async () => { show.focus(); await Promise.resolve(); });
    expect(document.body.querySelector('[role="tooltip"]')?.textContent).toBe("Pokaż sesje");
    expect((document.body.querySelector('[role="tooltip"]') as HTMLElement).style.visibility).toBe("visible");
    await act(async () => { show.blur(); await Promise.resolve(); });
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
  });

  it("T1 completed Training retains a nonblocking learning warning with the real cause",async()=>{
    currentRun = makeRun({status:"Completed",completedTargetIds:["t"],targetIds:["t"],currentIndex:1,activeTargetCheckpoint:null,
      learningSettlements:[{kind:"viewer_notes",sessionId:"s",packetHash:"packet",auditId:"audit",settlement:"failed_preserved",version:null,attempts:2,status:"FAILED_CAPACITY",failureMessage:"Capacity exceeded (1200/1024)"}]});
    await mount("en");
    expect(host.textContent).toContain("Completed");expect(host.textContent).toContain("Update failed — no saved version exists");expect(host.textContent).toContain("Capacity exceeded (1200/1024)");expect(host.textContent).not.toContain("NO_CHANGE");
    expect(host.querySelector(".training-resume-button")).toBeNull();
  });

});
