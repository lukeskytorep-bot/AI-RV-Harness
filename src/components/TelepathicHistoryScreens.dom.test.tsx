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
import type { AppRepository } from "../storage/repository";
import type { Profile, Workspace } from "../types";
import type { TelepathicMode, TelepathicSeriesConfig } from "../telepathicExchange/types";

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

for (const pl of [false, true]) for (const mode of ["ai_ai_training", "conversation_exchange"] as const) {
  it(`${mode}/${pl ? "PL" : "EN"}: shows archive immediately, keeps it read-only, restores without dispatch`, async () => {
    const repository = Object.assign(new BrowserTelepathicExchangeRepository({ storage: localStorage }), {
      listProviderConfigs: vi.fn(async () => []), listProviderModels: vi.fn(async () => []),
    }) as unknown as AppRepository;
    const participant = (id: string) => ({ id, kind: "ai" as const, displayName: `Participant ${id}`, ai: { profileId: id, profileName: id, workspaceId: "w", aiIdentityId: id, providerConfigId: id, credentialId: id, credentialFingerprint: id, modelId: id, route: id } });
    const config: TelepathicSeriesConfig = { schemaVersion: 1, protocolVersion: "fixed_lead_v1", leadInstructionVersion: "fixed_lead_guidance_v1", maxGuidanceCycles: 3, seriesId: "active", seriesWorkspaceId: "w", mode: mode as TelepathicMode,
      language: pl ? "pl" : "en", participants: [participant("lead"), participant("a")], senderPolicy: { kind: "fixed_ai", participantId: "lead" },
      roundCount: 2, topic: "any", discloseTopicToReceivers: false };
    const active = createTelepathicSeriesState(config); active.status = "paused";
    active.providerCalls = [{ id: "missing", seriesId: "active", roundId: "r", participantId: "a", callStage: "receiver_first", technicalAttempt: 1, status: "succeeded", scopeKey: "k", requestSha256: "h", createdAt: "t", updatedAt: "t" }];
    const archived = createTelepathicSeriesState({ ...config, seriesId: "archived" }); archived.archivedAt = "2026-10-12T12:00:00Z"; archived.archiveRevision = 1; archived.status = "blocked";
    archived.providerCalls = [{ id: "uncertain", seriesId: "archived", roundId: archived.rounds[0].assignment.roundId, participantId: "lead", callStage: "sender_target", technicalAttempt: 1, status: "uncertain", scopeKey: "unknown", requestSha256: "h", createdAt: "t", updatedAt: "t" }];
    await repository.saveTelepathicSeries(active); await repository.saveTelepathicSeries(archived);
    const dispatch = vi.spyOn(gateway, "executeTelepathicProviderPacket");
    const settings = { ...createDefaultSettings(), interfaceLanguage: pl ? "pl" as const : "en" as const, sessionLanguage: pl ? "pl" as const : "en" as const };
    const shared = { repository, settings, copy: getCopy(settings.interfaceLanguage), profiles: [] as Profile[], workspaces: [] as Workspace[] };
    await act(async () => root.render(mode === "ai_ai_training" ? <TelepathicTrainingPanel {...shared} /> : <TelepathicExchangePanel {...shared} profile={{ id: "human", name: "Human" } as Profile} workspace={{ id: "w" } as Workspace} />));
    const history = host.querySelector(".telepathic-history")!;
    expect(history.querySelectorAll("article")).toHaveLength(2); expect(history.querySelector('input[type="checkbox"]')).toBeNull();
    const missing = pl ? "brak danych" : "unavailable";
    expect(host.querySelector(".session-run-metrics > span:nth-child(2) strong")?.textContent).toBe(missing);
    expect(host.querySelector(".session-run-metrics > span:nth-child(3) strong")?.textContent).toBe(missing);
    const roundSelector = mode === "ai_ai_training" ? ".telepathic-round-tabs button.active" : ".telepathic-schedule button.active";
    const viewed = host.querySelector(roundSelector)?.textContent;
    const toggle = history.querySelector<HTMLButtonElement>(".training-history-toggle")!;
    await act(async () => toggle.click()); expect(history.querySelector("aside")?.hidden).toBe(true);
    await act(async () => toggle.click()); expect(host.querySelector(roundSelector)?.textContent).toBe(viewed);
    const archiveCard = history.querySelector(".telepathic-history-archived")!.closest("article")!;
    await act(async () => archiveCard.querySelector<HTMLButtonElement>("button")!.click());
    expect(host.querySelector(".telepathic-action-box")).toBeNull();
    expect([...host.querySelectorAll("button")].some(b => /Odblokuj i wznów|Unblock and resume|Zezwól na ponowienie|Allow retry/.test(b.textContent ?? ""))).toBe(false);
    expect(host.textContent).not.toContain(pl ? "Niepewne wywołania providera" : "Uncertain provider calls");
    await act(async () => archiveCard.querySelectorAll<HTMLButtonElement>("button")[2].click());
    expect((await repository.getTelepathicSeries("archived"))?.archivedAt).toBeUndefined();
    expect(history.querySelectorAll("article")).toHaveLength(2); expect(history.querySelector(".telepathic-history-archived")).toBeNull();
    const restored = (await repository.listTelepathicSeries()).findIndex(s => s.config.seriesId === "archived");
    await act(async () => history.querySelectorAll("article")[restored].querySelector<HTMLButtonElement>("button")!.click());
    expect([...host.querySelectorAll("button")].some(b => /Zezwól na ponowienie|Allow retry/.test(b.textContent ?? ""))).toBe(true);
    expect((await repository.getTelepathicSeries("archived"))?.providerCalls).toEqual(archived.providerCalls);
    expect(dispatch).not.toHaveBeenCalled();
  });
}
