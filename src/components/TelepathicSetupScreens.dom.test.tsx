// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { BrowserTelepathicExchangeRepository } from "../storage/browser/telepathicExchangeRepository";
import { createDefaultSettings } from "../startupDefaults";
import { getCopy } from "../i18n";
import type { AppRepository } from "../storage/repository";
import type { Profile, Workspace } from "../types";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import type { AiIdentity } from "../aiCenter/types";
import type { TelepathicMode } from "../telepathicExchange/types";
const execution = vi.hoisted(() => ({ advance: vi.fn(), next: vi.fn() }));
vi.mock("../telepathicExchange/engine", async original => ({ ...await original<typeof import("../telepathicExchange/engine")>(), advanceTelepathicConversationSeries: execution.advance, runNextTelepathicAiRound: execution.next }));
import { TelepathicSeriesCheckpointError } from "../telepathicExchange/engine";
import { legacyLeadState as createTelepathicSeriesState } from "../telepathicExchange/__fixtures__/legacyLeadState";
import { TelepathicTrainingPanel } from "../features/training/TelepathicTrainingPanel";
import { TelepathicExchangePanel } from "../features/conversations/TelepathicExchangePanel";

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  execution.advance.mockReset(); execution.next.mockReset();
  execution.advance.mockImplementation(async (deps, id) => deps.store.getTelepathicSeries(id));
  execution.next.mockImplementation(async (deps, id) => ({ ...await deps.store.getTelepathicSeries(id), status: "completed" }));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const textButton = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === label)!;
const action = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const step = (n: number) => host.querySelector<HTMLElement>(`[data-setup-step="${n}"]`)!;
async function change(element: HTMLSelectElement, value: string) { await act(async () => { element.value = value; element.dispatchEvent(new Event("change", { bubbles: true })); }); }
async function click(element: HTMLButtonElement | HTMLInputElement) { await act(async () => element.click()); }
function fixture(mode: TelepathicMode, pl = false) {
  let profiles = ["a", "b", "c"].map(id => ({ id, name: id.toUpperCase() } as Profile));
  const workspace = { id: "human-w", profileId: "human", name: "Human", kind: "conversation", createdAt: "t" } as Workspace;
  let workspaces = profiles.map(p => ({ id: `w-${p.id}`, profileId: p.id, name: `Workspace ${p.id}`, kind: mode === "ai_ai_training" ? "rv" : "conversation", createdAt: "t" } as Workspace));
  const configs = profiles.map(p => ({ id: `provider-${p.id}`, label: p.id, provider: "openrouter", credentialId: `cred-${p.id}`, credentialFingerprint: `fp-${p.id}`, enabled: true } as ProviderConfig));
  const models = configs.map(c => ({ providerConfigId: c.id, provider: c.provider, modelId: "model", route: "route", displayName: "Model" } as ProviderModel));
  const identities = profiles.map((p, index) => ({ id: `identity-${p.id}`, profileId: p.id, providerConfigId: configs[index].id, provider: "openrouter", credentialFingerprint: `fp-${p.id}`, modelId: "model", modelRoute: "route", modelDisplayName: "Model", role: "viewer", routeStatus: "available", lastUsedAt: "t" } as AiIdentity));
  const repository = Object.assign(new BrowserTelepathicExchangeRepository({ storage: localStorage }), {
    listProviderConfigs: vi.fn(async () => configs), listProviderModels: vi.fn(async () => models),
    listAiIdentities: vi.fn(async (profileId: string) => identities.filter(i => i.profileId === profileId)),
    listTrainingRuns: vi.fn(async () => []), listArchivedTrainingRuns: vi.fn(async () => []),
    getExistingFieldGuideBundle: vi.fn(async () => null), getExistingViewerNoteBundle: vi.fn(async () => null),
  }) as unknown as AppRepository;
  const settings = { ...createDefaultSettings(), interfaceLanguage: pl ? "pl" as const : "en" as const, sessionLanguage: pl ? "pl" as const : "en" as const };
  const render = async () => act(async () => {
    const props = { repository, settings, copy: getCopy(settings.interfaceLanguage), profiles, workspaces };
    root.render(mode === "ai_ai_training" ? <TelepathicTrainingPanel {...props} /> : <TelepathicExchangePanel {...props} profile={{ id: "human", name: "Human" } as Profile} workspace={workspace} />);
  });
  const labels = { participants: pl ? "Zatwierdź uczestników" : "Confirm participants", lead: pl ? "Zatwierdź prowadzącego" : "Confirm lead", edit: pl ? "Zmień uczestników" : "Change participants", start: mode === "ai_ai_training" ? (pl ? "Rozpocznij trening telepatyczny" : "Start telepathic training") : (pl ? "Rozpocznij wymianę" : "Start exchange") };
  const pick = async (index: number) => click(step(1).querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[index]);
  const selectLead = async (id = "b") => {
    if (mode === "conversation_exchange") await change(step(2).querySelector("select")!, "fixed_ai");
    await change(step(2).querySelectorAll<HTMLSelectElement>("select")[mode === "ai_ai_training" ? 0 : 1], id);
  };
  return { repository, labels, render, pick, selectLead, identities,
    setProfiles(value: Profile[]) { profiles = value; }, get profiles() { return profiles; },
    setWorkspaces(value: Workspace[]) { workspaces = value; }, get workspaces() { return workspaces; } };
}

for (const pl of [false, true]) for (const mode of ["ai_ai_training", "conversation_exchange"] as const) {
  it(`${mode}/${pl ? "PL" : "EN"}: requires valid participants then explicit lead; edit and removal invalidate Start`, async () => {
    const f = fixture(mode, pl); await f.render();
    expect(action(f.labels.participants).disabled).toBe(true); expect(textButton(f.labels.start).disabled).toBe(true);
    expect(step(2).querySelector("select")!.matches(":disabled")).toBe(true);
    await f.pick(0);
    if (mode === "ai_ai_training") { expect(action(f.labels.participants).disabled).toBe(true); await f.pick(1); }
    else await f.pick(1);
    const route = step(1).querySelector<HTMLSelectElement>(mode === "ai_ai_training" ? "select" : ".telepathic-route-grid label:last-child select")!;
    await change(route, ""); expect(action(f.labels.participants).disabled).toBe(true);
    await change(route, "identity-a"); expect(action(f.labels.participants).disabled).toBe(false);
    await click(action(f.labels.participants)); expect(step(1).querySelector("input")!.matches(":disabled")).toBe(true);
    expect(textButton(f.labels.start).disabled).toBe(true);
    if (mode === "ai_ai_training") expect(step(2).querySelector<HTMLSelectElement>("select")!.value).toBe("");
    await f.selectLead(); await click(action(f.labels.lead)); expect(textButton(f.labels.start).disabled).toBe(false);
    expect(step(2).querySelector("select")!.matches(":disabled")).toBe(true);
    await click(action(f.labels.edit)); expect(textButton(f.labels.start).disabled).toBe(true);
    await f.pick(1); // remove the selected lead
    if (mode === "ai_ai_training") await f.pick(2);
    await click(action(f.labels.participants));
    if (mode === "conversation_exchange") expect(step(2).querySelectorAll<HTMLSelectElement>("select")[1].value).toBe("");
    expect(textButton(f.labels.start).disabled).toBe(true);
    await f.selectLead("a"); await click(action(f.labels.lead));
    const before = await f.repository.listTelepathicSeries(); expect(before).toHaveLength(0);
    await click(textButton(f.labels.start));
    const [saved] = await f.repository.listTelepathicSeries();
    expect(saved.config.leadInstructionVersion).toBe("fixed_lead_guidance_v2");
    expect(saved.config.senderPolicy).toEqual({ kind: "fixed_ai", participantId: "ai:a" });
    expect(saved.plan.rounds.every(r => r.senderParticipantId === "ai:a")).toBe(true);
    expect(saved.config.participants.some(p => p.id === "ai:b")).toBe(false);
  });
  it(`${mode}/${pl ? "PL" : "EN"}: live Profile/Workspace drift clears approval and invalid route blocks reconfirmation`, async () => {
    const f = fixture(mode, pl); await f.render(); await f.pick(0); await f.pick(1);
    await click(action(f.labels.participants)); await f.selectLead(); await click(action(f.labels.lead));
    f.setProfiles(f.profiles.map(p => p.id === "b" ? { ...p, name: "Changed profile" } : p)); await f.render();
    expect(textButton(f.labels.start).disabled).toBe(true); expect(step(2).querySelector("select")!.matches(":disabled")).toBe(true);
    await click(action(f.labels.participants)); await f.selectLead(); await click(action(f.labels.lead));
    f.setWorkspaces(f.workspaces.filter(w => w.profileId !== "b")); await f.render();
    expect(action(f.labels.participants).disabled).toBe(true); expect(textButton(f.labels.start).disabled).toBe(true);
    expect(await f.repository.listTelepathicSeries()).toHaveLength(0);
  });
}
for (const pl of [false, true]) it(`Conversation/${pl ? "PL" : "EN"}: human lead needs confirmation but no AI lead Profile`, async () => {
  const f = fixture("conversation_exchange", pl); await f.render(); await f.pick(0);
  await click(action(f.labels.participants)); expect(step(2).querySelectorAll("select")).toHaveLength(1);
  expect(textButton(f.labels.start).disabled).toBe(true); await click(action(f.labels.lead)); await click(textButton(f.labels.start));
  const [saved] = await f.repository.listTelepathicSeries();
  expect(saved.config.leadInstructionVersion).toBe("fixed_lead_guidance_v2");
    expect(saved.config.senderPolicy).toEqual({ kind: "human_only", humanParticipantId: `${saved.config.seriesId}:human` });
});
for (const mode of ["ai_ai_training", "conversation_exchange"] as const) {
  it(`${mode}: history and remount preserve frozen lead and durable attempt without replacing local draft`, async () => {
    const f = fixture(mode); await f.render(); await f.pick(0); await f.pick(1); await click(action(f.labels.participants)); await f.selectLead(); await click(action(f.labels.lead));
    const config = { schemaVersion: 1 as const, protocolVersion: "fixed_lead_v1" as const, leadInstructionVersion: "fixed_lead_guidance_v1", maxGuidanceCycles: 3 as const, seriesId: "old", seriesWorkspaceId: mode === "conversation_exchange" ? "human-w" : "w-a", mode, language: "en" as const, participants: ["a", "b"].map(id => ({ id: `ai:${id}`, kind: "ai" as const, displayName: id, ai: { profileId: id, profileName: id, workspaceId: `w-${id}`, aiIdentityId: `identity-${id}`, providerConfigId: `provider-${id}`, credentialId: `cred-${id}`, credentialFingerprint: `fp-${id}`, modelId: "model", route: "route" } })), senderPolicy: { kind: "fixed_ai" as const, participantId: "ai:a" }, roundCount: 1, topic: "any" as const, discloseTopicToReceivers: false };
    if (mode === "conversation_exchange") config.participants.push({ id: "human", kind: "human", displayName: "Human" } as unknown as typeof config.participants[number]);
    const state = createTelepathicSeriesState(config); state.status = "blocked";
    state.providerCalls = [{ id: "durable", seriesId: "old", roundId: state.rounds[0].assignment.roundId, participantId: "ai:a", callStage: "sender_target", technicalAttempt: 2, status: "uncertain", scopeKey: "s", requestSha256: "h", createdAt: "t", updatedAt: "t" }];
    await f.repository.saveTelepathicSeries(state);
    // Refresh via props to load history; no setup state is overwritten by loading.
    f.setProfiles([...f.profiles]); await f.render();
    const newLabel = mode === "ai_ai_training" ? "New training" : "New exchange";
    expect(host.querySelector('[data-setup-step]')).toBeNull();
    await click(textButton(newLabel)); expect(textButton(f.labels.start).disabled).toBe(false);
    expect(step(2).querySelectorAll<HTMLSelectElement>("select")[mode === "ai_ai_training" ? 0 : 1].value).toBe("b");
    await click(action(mode === "ai_ai_training" ? "Open training" : "Open exchange"));
    expect((await f.repository.getTelepathicSeries("old"))?.config.leadInstructionVersion).toBe("fixed_lead_guidance_v1");
    expect((await f.repository.getTelepathicSeries("old"))?.config.senderPolicy).toEqual(config.senderPolicy);
    expect((await f.repository.getTelepathicSeries("old"))?.providerCalls).toEqual(state.providerCalls);
    await act(async () => { root.unmount(); root = createRoot(host); }); await f.render();
    expect(host.querySelector('[data-setup-step]')).toBeNull();
    expect((await f.repository.getTelepathicSeries("old"))?.providerCalls[0].technicalAttempt).toBe(2);
    expect(execution.advance).not.toHaveBeenCalled(); expect(execution.next).not.toHaveBeenCalled();
  });
  it(`${mode}: busy Start uses confirmed frozen lead and Stop retains it`, async () => {
    const f = fixture(mode); await f.render(); await f.pick(0); await f.pick(1); await click(action(f.labels.participants)); await f.selectLead(); await click(action(f.labels.lead));
    const runner = mode === "ai_ai_training" ? execution.next : execution.advance;
    runner.mockImplementation((deps) => new Promise((_resolve, reject) => deps.signal.addEventListener("abort", () => reject(new DOMException("Stop", "AbortError")), { once: true })));
    await click(textButton(f.labels.start));
    expect(host.querySelector('[data-setup-step]')).toBeNull();
    expect(textButton(mode === "ai_ai_training" ? "New training" : "New exchange").disabled).toBe(true);
    await click(textButton("Stop"));
    expect((await f.repository.listTelepathicSeries())[0].config.senderPolicy).toEqual({ kind: "fixed_ai", participantId: "ai:b" });
    expect(runner).toHaveBeenCalledTimes(1);
  });
}
for (const mode of ["ai_ai_training", "conversation_exchange"] as const) {
  it(`${mode}: credential binding drift after confirmation invalidates the live eligible route`, async () => {
    const f = fixture(mode); await f.render(); await f.pick(0); await f.pick(1); await click(action(f.labels.participants)); await f.selectLead(); await click(action(f.labels.lead));
    f.identities[1].credentialFingerprint = "rebound";
    f.setProfiles([...f.profiles]); await f.render();
    expect(action(f.labels.participants).disabled).toBe(true); expect(textButton(f.labels.start).disabled).toBe(true);
    expect(step(2).querySelector("select")!.matches(":disabled")).toBe(true);
    expect(await f.repository.listTelepathicSeries()).toHaveLength(0);
  });
  it(`${mode}: reopening setup after process restart requires fresh confirmations`, async () => {
    const f = fixture(mode); await f.render(); await f.pick(0); await f.pick(1); await click(action(f.labels.participants)); await f.selectLead(); await click(action(f.labels.lead));
    await act(async () => { root.unmount(); root = createRoot(host); }); await f.render();
    expect(action(f.labels.participants).disabled).toBe(true); expect(textButton(f.labels.start).disabled).toBe(true);
    expect(step(2).querySelector("select")!.matches(":disabled")).toBe(true);
    expect(await f.repository.listTelepathicSeries()).toHaveLength(0);
  });
}
it("Training enforces the existing six-profile maximum before participants can be confirmed", async () => {
  const f = fixture("ai_ai_training");
  // More live Profiles are eligible, but the UI still only accepts six distinct participants.
  const extras = ["d", "e", "f", "g"].map(id => ({ id, name: id } as Profile));
  f.setProfiles([...f.profiles, ...extras]);
  f.setWorkspaces([...f.workspaces, ...extras.map(p => ({ id: `w-${p.id}`, profileId: p.id, kind: "rv", name: p.id, createdAt: "t" } as Workspace))]);
  vi.mocked(f.repository.listProviderConfigs).mockImplementation(async () => f.profiles.map(p => ({ id: `provider-${p.id}`, label: p.id, provider: "openrouter", credentialId: `cred-${p.id}`, credentialFingerprint: `fp-${p.id}`, enabled: true } as ProviderConfig)));
  vi.mocked(f.repository.listProviderModels).mockImplementation(async () => f.profiles.map(p => ({ providerConfigId: `provider-${p.id}`, provider: "openrouter", modelId: "model", route: "route", displayName: "Model" } as ProviderModel)));
  f.identities.push(...extras.map(p => ({ ...f.identities[0], id: `identity-${p.id}`, profileId: p.id, providerConfigId: `provider-${p.id}`, credentialFingerprint: `fp-${p.id}` })));
  await f.render(); for (let index = 0; index < 6; index++) await f.pick(index);
  expect(step(1).querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[6].disabled).toBe(true);
  expect(action(f.labels.participants).disabled).toBe(false);
});

for (const pl of [false, true]) for (const mode of ["ai_ai_training", "conversation_exchange"] as const) {
 it(`${mode}/${pl ? "PL" : "EN"}: one saved policy controls Resume and transport exhaustion`, async () => {
  const f = fixture(mode, pl); await f.render(); await f.pick(0); await f.pick(1);
  await click(action(f.labels.participants)); await f.selectLead("a"); await click(action(f.labels.lead)); await click(textButton(f.labels.start));
  const [series] = await f.repository.listTelepathicSeries();
  expect(series.config.recoveryPolicy).toEqual({ version: 1, mode: "automatic", maxTransportRetriesPerScope: 1 });
  series.status = "blocked";
  const owner = series.config.participants.find(p => p.kind === "ai")!;
  series.providerCalls = [{ id: "lost", seriesId: series.config.seriesId, roundId: series.rounds[0].assignment.roundId, participantId: owner.id, callStage: "sender_target", technicalAttempt: 1, status: "uncertain", scopeKey: "step", requestSha256: "hash", createdAt: "t", updatedAt: "t", transportFailure: { code: "response_body_read", phase: "reading_body", retryable: true } }];
  series.config.recoveryPolicy!.mode = "manual";
  series.finalReflections = Object.fromEntries(series.config.participants.filter(p => p.kind === "ai").map(p => [p.id, "saved final"]));
  await f.repository.saveTelepathicSeries(series);
  await click(action(mode === "ai_ai_training" ? (pl ? "Otwórz trening" : "Open training") : (pl ? "Otwórz wymianę" : "Open exchange")));
  expect(textButton(pl ? "Wznów" : "Resume").disabled).toBe(true);
  expect(host.textContent).toContain(pl ? "Zezwól na ponowienie" : "Allow retry");
  const policyCheckbox = () => [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(input => input.closest("label")?.textContent?.includes(pl ? "Automatycznie kontynuuj" : "Continue automatically"))!;
  expect(policyCheckbox().checked).toBe(false);
  const before = mode === "ai_ai_training" ? execution.next.mock.calls.length : execution.advance.mock.calls.length;
  await click(policyCheckbox());
  expect((await f.repository.getTelepathicSeries(series.config.seriesId))!.config.recoveryPolicy?.mode).toBe("automatic");
  expect(textButton(pl ? "Wznów" : "Resume").disabled).toBe(false);
  expect(host.textContent).not.toContain(pl ? "Zezwól na ponowienie" : "Allow retry");
  expect(mode === "ai_ai_training" ? execution.next.mock.calls.length : execution.advance.mock.calls.length).toBe(before);
  await click(textButton(pl ? "Wznów" : "Resume"));
  expect(mode === "ai_ai_training" ? execution.next.mock.calls.length : execution.advance.mock.calls.length).toBe(before + 1);
  const exhausted = (await f.repository.getTelepathicSeries(series.config.seriesId))!;
  exhausted.status = "blocked"; exhausted.providerCalls[0].status = "failed";
  exhausted.providerCalls[0].recovery = { action: "transport_retry", originalStatus: "uncertain", at: "t" };
  exhausted.providerCalls.push({ ...exhausted.providerCalls[0], id: "lost-again", status: "uncertain", recovery: undefined, retryOfCallId: "lost" });
  await f.repository.saveTelepathicSeries(exhausted);
  await click(action(mode === "ai_ai_training" ? (pl ? "Otwórz trening" : "Open training") : (pl ? "Otwórz wymianę" : "Open exchange")));
  expect(textButton(pl ? "Wznów" : "Resume").disabled).toBe(true);
  expect(host.textContent).toContain(pl ? "limit odzyskiwania" : "recovery is exhausted");
  expect(host.textContent).not.toContain(pl ? "Zezwól na ponowienie" : "Allow retry");
 });
}

for (const pl of [false, true]) for (const mode of ["ai_ai_training", "conversation_exchange"] as const) {
 it(`${mode}/${pl ? "PL" : "EN"}: checkpoint errors block Resume until an explicit checkpoint read`, async () => {
  const f = fixture(mode, pl); await f.render(); await f.pick(0); await f.pick(1);
  await click(action(f.labels.participants)); await f.selectLead("a"); await click(action(f.labels.lead)); await click(textButton(f.labels.start));
  const [series] = await f.repository.listTelepathicSeries(); series.status = "paused";
  await f.repository.saveTelepathicSeries(series);
  const openLabel = mode === "ai_ai_training" ? (pl ? "Otwórz trening" : "Open training") : (pl ? "Otwórz wymianę" : "Open exchange");
  await click(action(openLabel));
  const failure = new TelepathicSeriesCheckpointError(new Error("disk full"), series);
  (mode === "ai_ai_training" ? execution.next : execution.advance).mockRejectedValueOnce(failure);
  await click(textButton(pl ? "Wznów" : "Resume"));
  expect(textButton(pl ? "Wznów" : "Resume").disabled).toBe(true);
  expect(host.textContent).toContain(pl ? "Zapis nie powiódł się" : "The checkpoint could not be saved");
  const checkbox = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(input => input.closest("label")?.textContent?.includes(pl ? "Automatycznie kontynuuj" : "Continue automatically"))!;
  expect(checkbox.disabled).toBe(true);
  await click(action(openLabel));
  expect(textButton(pl ? "Wznów" : "Resume").disabled).toBe(false);
  expect([...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(input => input.closest("label")?.textContent?.includes(pl ? "Automatycznie kontynuuj" : "Continue automatically"))!.disabled).toBe(false);
 });
}
for (const mode of ["ai_ai_training", "conversation_exchange"] as const) {
 it(`${mode}: the setup choice can save manual recovery for a new series`, async () => {
  const f = fixture(mode); await f.render(); await f.pick(0); await f.pick(1);
  await click(action(f.labels.participants)); await f.selectLead("a"); await click(action(f.labels.lead));
  const checkbox = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(input => input.closest("label")?.textContent?.includes("Continue automatically"))!;
  expect(checkbox.checked).toBe(true); await click(checkbox); await click(textButton(f.labels.start));
  expect((await f.repository.listTelepathicSeries())[0].config.recoveryPolicy?.mode).toBe("manual");
 });
}
