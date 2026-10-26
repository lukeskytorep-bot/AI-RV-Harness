// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TelepathicTrainingPanel } from "../features/training/TelepathicTrainingPanel";
import { TelepathicExchangePanel } from "../features/conversations/TelepathicExchangePanel";
import { BrowserTelepathicExchangeRepository } from "../storage/browser/telepathicExchangeRepository";
import { createTelepathicSeriesState } from "../telepathicExchange/engine";
import * as gateway from "../telepathicExchange/providerGateway";
import { createDefaultSettings } from "../startupDefaults";
import { getCopy } from "../i18n";
import type { TelepathicMode } from "../telepathicExchange/types";
import type { TelepathicHistoryPage } from "../telepathicExchange/historySummaries";
import type { AppRepository } from "../storage/repository";
import type { Profile, Workspace } from "../types";
const exported = vi.hoisted(() => ({ save: vi.fn(async () => undefined) }));
vi.mock("../exports/telepathy", () => ({ saveTelepathicDocument: exported.save }));
let host: HTMLDivElement, root: Root;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; localStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); exported.save.mockClear(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === text)!;
async function click(element: HTMLButtonElement) { await act(async () => { element.click(); }); }
function state(index: number, mode: TelepathicMode, archived = false, workspace = "w") {
  const ai = (id: string) => ({ id, kind: "ai" as const, displayName: id, ai: { profileId: id, profileName: id, workspaceId: "w", aiIdentityId: id, providerConfigId: "c", credentialId: "k", credentialFingerprint: "f", modelId: "m", route: "m" } });
  const result = createTelepathicSeriesState({ schemaVersion: 1, seriesId: `s-${String(index).padStart(3, "0")}`, seriesWorkspaceId: workspace, mode, language: "en", protocolVersion: "fixed_lead_v1", leadInstructionVersion: "v1", maxGuidanceCycles: 3, participants: [ai("lead"), ai("receiver")], senderPolicy: { kind: "fixed_ai", participantId: "lead" }, roundCount: 1, topic: "any", discloseTopicToReceivers: false }, new Date(Date.UTC(2026, 9, 13, 1, index)).toISOString());
  result.status = "paused"; if (archived) { result.archivedAt = "archive"; result.archiveRevision = 1; }
  return result;
}
async function fixture(mode: TelepathicMode, pl = false, count = 61) {
  const repository = Object.assign(new BrowserTelepathicExchangeRepository(), { listProviderConfigs: vi.fn(async () => []), listProviderModels: vi.fn(async () => []) }) as unknown as AppRepository;
  for (let index = 0; index < count; index++) await repository.saveTelepathicSeries(state(index, mode));
  const page = vi.spyOn(repository, "listTelepathicSeriesSummaries"), detail = vi.spyOn(repository, "getTelepathicSeries"), full = vi.spyOn(repository, "listTelepathicSeries"), save = vi.spyOn(repository, "saveTelepathicSeries"), dispatch = vi.spyOn(gateway, "executeTelepathicProviderPacket");
  const settings = { ...createDefaultSettings(), interfaceLanguage: pl ? "pl" as const : "en" as const, sessionLanguage: pl ? "pl" as const : "en" as const };
  const render = async (workspaceId = "w") => act(async () => {
    const shared = { repository, settings, copy: getCopy(settings.interfaceLanguage), profiles: [] as Profile[], workspaces: [] as Workspace[] };
    root.render(mode === "ai_ai_training" ? <TelepathicTrainingPanel {...shared} /> : <TelepathicExchangePanel {...shared} profile={{ id: "human", name: "Human" } as Profile} workspace={{ id: workspaceId } as Workspace} />);
  });
  return { repository, page, detail, full, save, dispatch, render };
}
for (const mode of ["ai_ai_training", "conversation_exchange"] as const) for (const pl of [false, true]) it(`${mode}/${pl ? 'PL' : 'EN'} pages 50+11, ignores 61 newer archives before paging active rows, exports one detail`, async () => {
  const f = await fixture(mode, pl); for(let i=61;i<122;i++)await f.repository.saveTelepathicSeries(state(i,mode,true)); f.save.mockClear(); await f.render();
  expect(f.page.mock.calls[0][0]).toEqual({ mode, ...(mode === "conversation_exchange" ? { seriesWorkspaceId: "w" } : {}), archive: "active", limit: 50 });
  expect(f.page).toHaveBeenCalledTimes(1);
  expect(host.querySelectorAll(".telepathic-history article")).toHaveLength(50); expect(f.detail.mock.calls).toEqual([["s-060"]]);
  const viewed = host.querySelector(".telepathic-round-tabs button.active, .telepathic-schedule button.active")?.textContent;
  await click(button(pl ? "Pokaż więcej" : "Load more"));
  expect(f.page.mock.calls[1][0].cursor).toBeTruthy(); expect(host.querySelectorAll(".telepathic-history article")).toHaveLength(61);
  const toggle = host.querySelector<HTMLButtonElement>(".training-history-toggle")!; await click(toggle); await click(toggle);
  expect(host.querySelector(".telepathic-round-tabs button.active, .telepathic-schedule button.active")?.textContent).toBe(viewed);
  expect(f.full).not.toHaveBeenCalled(); expect(f.save).not.toHaveBeenCalled(); expect(f.dispatch).not.toHaveBeenCalled();
  const exportButton = host.querySelector<HTMLButtonElement>(`button[aria-label="${pl ? 'Zapisz' : 'Save'} ${mode === 'ai_ai_training' ? (pl ? 'trening' : 'training') : (pl ? 'wymianę' : 'exchange')}"]`)!;
  await click(exportButton); expect(exported.save).toHaveBeenCalledTimes(1); expect(f.detail).toHaveBeenCalledTimes(2);
  expect(host.querySelectorAll(".telepathic-history article")).toHaveLength(50); // successful operation resets first page
});
for (const mode of ["ai_ai_training", "conversation_exchange"] as const) it(`${mode} displays initial loading and error, retries without treating error as empty`, async () => {
  const f = await fixture(mode, false, 1);
  let reject!: (cause: Error) => void;
  f.page.mockImplementationOnce(() => new Promise((_resolve, no) => { reject = no; }));
  await f.render(); expect(host.textContent).toContain("Loading history"); expect(host.textContent).not.toContain("No saved sessions");
  await act(async () => reject(new Error("READ_FAILED"))); expect(host.querySelector('[role="alert"]')?.textContent).toContain("READ_FAILED");
  expect(host.textContent).not.toContain("No saved sessions"); await click(button("Retry"));
  expect(host.querySelectorAll(".telepathic-history article")).toHaveLength(1); expect(f.full).not.toHaveBeenCalled();
});
for (const mode of ["ai_ai_training", "conversation_exchange"] as const) it(`${mode} page error preserves list and retries the same cursor with deduplication`, async () => {
  const f = await fixture(mode); await f.render();
  const moved = state(60, mode); moved.updatedAt = state(5, mode).updatedAt; await f.repository.saveTelepathicSeries(moved);
  f.page.mockRejectedValueOnce(new Error("PAGE_FAILED")); await click(button("Load more"));
  expect(host.querySelectorAll(".telepathic-history article")).toHaveLength(50);
  const failedQuery = f.page.mock.calls.at(-1)![0]; await click(button("Retry")); expect(f.page.mock.calls.at(-1)![0]).toEqual(failedQuery);
  expect(host.querySelectorAll(".telepathic-history article")).toHaveLength(61); expect(host.querySelector('[role="alert"]')).toBeNull();
});
it("Conversation ignores late pages and details after workspace change; detail error preserves history", async () => {
  const f = await fixture("conversation_exchange"); await f.render();
  let release!: (page: TelepathicHistoryPage) => void;
  f.page.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })); await click(button("Load more"));
  await f.render("other"); expect(host.querySelectorAll(".telepathic-history article")).toHaveLength(0);
  await act(async () => release({ items: [{ seriesId: "late", mode: "conversation_exchange", seriesWorkspaceId: "w", status: "paused", roundCount: 1, participantNames: ["PRIVATE_LATE"], createdAt: "t", updatedAt: "t" }] }));
  expect(host.textContent).not.toContain("PRIVATE_LATE");
  await f.render("w"); f.detail.mockRejectedValueOnce(new Error("DETAIL_FAILED"));
  await click(host.querySelector<HTMLButtonElement>('button[aria-label="Open exchange"]')!);
  expect(host.textContent).toContain("DETAIL_FAILED"); expect(host.querySelectorAll(".telepathic-history article")).toHaveLength(50);
});
for (const mode of ["ai_ai_training", "conversation_exchange"] as const) it(`${mode} ignores a late detail when the user returns to a new draft`, async () => {
  const f = await fixture(mode); await f.render(); let release!: (value: ReturnType<typeof state>) => void;
  f.detail.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await click(host.querySelector<HTMLButtonElement>(`button[aria-label="Open ${mode === 'ai_ai_training' ? 'training' : 'exchange'}"]`)!);
  await click(button(mode === "ai_ai_training" ? "New training" : "New exchange"));
  await act(async () => release(state(60, mode)));
  expect(host.querySelector('[data-setup-step="1"]')).not.toBeNull(); expect(f.dispatch).not.toHaveBeenCalled();
});

for (const mode of ["ai_ai_training", "conversation_exchange"] as const) for (const empty of [true, false]) it(`${mode}: ${empty ? "empty history" : "only archived history"} never loads an active detail`, async () => {
  const f = await fixture(mode, false, empty ? 0 : 2);
  if (!empty) for(let i=0;i<2;i++)await f.repository.saveTelepathicSeries(state(i,mode,true));
  f.detail.mockClear(); await f.render();
  expect(f.detail).not.toHaveBeenCalled(); expect(f.full).not.toHaveBeenCalled(); expect(f.dispatch).not.toHaveBeenCalled();
  expect(host.querySelector('[data-setup-step="1"]')).not.toBeNull();
  if (empty) expect(host.textContent).toContain("No saved sessions");
  else expect(f.page.mock.calls.at(-1)![0]).toMatchObject({ mode, archive: "active", limit: 50 });
});
