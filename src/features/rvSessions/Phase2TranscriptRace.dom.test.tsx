// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { getCopy } from "../../i18n";
import { createDefaultSettings } from "../../startupDefaults";
import type { AppRepository } from "../../storage/repository";
import { workflowTestRepository } from "../../testing/workflowRepository";
import type { SessionEventRecord } from "../../sessions/types";

const mocks = vi.hoisted(() => ({ identities: vi.fn(), blind: vi.fn() }));
vi.mock("../../components/AppDialogProvider", () => ({ useAppDialogs: () => ({ confirm: vi.fn(), information: vi.fn() }) }));
vi.mock("../../storage", async importOriginal => ({ ...await importOriginal<object>(), isTauriRuntime: () => true }));
vi.mock("../../aiCenter/viewerIdentitySelection", () => ({
  inspectViewerIdentities: async (input: unknown) => ({ identities: await mocks.identities(input), issues: [] }),
  preferredViewerIdentityId: () => "i",
  requireWorkspaceViewerRoute: async () => undefined,
  viewerIdentityLabel: () => "Viewer",
}));
vi.mock("../../aiCenter/fieldGuide", async importOriginal => ({ ...await importOriginal<object>(), prepareFieldGuideForSession: async () => ({}), viewerSystemPromptSnapshotFromFieldGuide: async () => ({}) }));
vi.mock("../../aiCenter/viewerNotes", async importOriginal => ({ ...await importOriginal<object>(), prepareViewerNotesForSession: async () => ({ enabled: false }) }));
vi.mock("../../sessions/controller", async importOriginal => ({ ...await importOriginal<object>(), runAutomaticRcpSession: mocks.blind }));

import { RvSessionPanel } from "./RvSessionPanel";

function staleEvents(language: "pl" | "en"): SessionEventRecord[] {
  const phase1Instruction = language === "pl" ? "Polecenie P1" : "P1 instruction";
  const phase1Answer = language === "pl" ? "Odpowiedź P1" : "P1 answer";
  const phase2Instruction = language === "pl" ? "Polecenie P2" : "P2 instruction";
  return [
    { id: "e1", sessionId: "s", sequenceNumber: 1, eventType: "CONTROLLER_STEP", content: phase1Instruction, metadata: { phase: 1 }, createdAt: "t" },
    { id: "e2", sessionId: "s", sequenceNumber: 2, eventType: "VIEWER_RESPONSE", content: phase1Answer, metadata: { phase: 1, accepted: true, finishReason: "stop" }, createdAt: "t" },
    { id: "e3", sessionId: "s", sequenceNumber: 3, eventType: "CONTROLLER_STEP", content: phase2Instruction, metadata: { phase: 2 }, createdAt: "t" },
  ];
}

function acceptedTranscript(language: "pl" | "en"): string {
  return language === "pl"
    ? "## Faza 1\n\n### Dokładne polecenie kontrolera\n\nPolecenie P1\n\n### Odpowiedź Viewera\n\nOdpowiedź P1\n\n## Faza 2\n\n### Dokładne polecenie kontrolera\n\nPolecenie P2\n\n### Odpowiedź Viewera\n\nPHASE2_UNIQUE_ANSWER"
    : "## Phase 1\n\n### Exact controller instruction\n\nP1 instruction\n\n### Viewer response\n\nP1 answer\n\n## Phase 2\n\n### Exact controller instruction\n\nP2 instruction\n\n### Viewer response\n\nPHASE2_UNIQUE_ANSWER";
}

describe("RV Sessions live transcript revision coherence", () => {
  for (const language of ["pl", "en"] as const) it(`${language}: does not duplicate Phase 2 while listSessionEvents lags progress.transcript`, async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let finishRun!: () => void;
    let resolveEvents!: (events: SessionEventRecord[]) => void;
    let progressPublished = false;
    const provider = { id: "pc", provider: "custom_openai", credentialId: "k", enabled: true, label: "P" };
    const model = { providerConfigId: "pc", provider: "custom_openai", modelId: "m", route: "route", displayName: "M", capabilities: { inputModalities: ["text"], outputModalities: ["text"], reasoning: { supported: false, efforts: [] }, temperature: { supported: false }, supportedParameters: [] }, pricing: {} };
    mocks.identities.mockResolvedValue([{ identity: { id: "i", displayName: "Viewer" }, providerConfig: provider, model }]);
    mocks.blind.mockImplementation(async request => {
      progressPublished = true;
      request.onProgress({ sessionId: "s", sessionCode: "S", state: "BlindRunning", transcript: acceptedTranscript(language), phase: 2 });
      await new Promise<void>(resolve => { finishRun = resolve; });
      return { sessionId: "s", state: "AwaitingReveal", transcript: acceptedTranscript(language) };
    });
    const repository = workflowTestRepository({
      listProviderConfigs: async () => [provider],
      listProviderModels: async () => [model],
      listTargets: async () => [{ id: "t", collection: "user", sourceMetadata: {}, title: "T", revealText: "target", tags: [], createdAt: "t", updatedAt: "t" }],
      listRvSessions: async () => [],
      listSessionEvents: async (sessionId: string) => {
        if (sessionId !== "s" || !progressPublished) return [];
        return await new Promise<SessionEventRecord[]>(resolve => { resolveEvents = resolve; });
      },
      listCustomProtocols: async () => [],
    } as unknown as AppRepository);
    const copy = getCopy(language);
    try {
      await act(async () => root.render(<RvSessionPanel repository={repository} profile={{ id: "p", name: "P", credentialId: "k", createdAt: "t", updatedAt: "t" }} workspace={{ id: "w", profileId: "p", name: "W", kind: "rv", createdAt: "t", updatedAt: "t", lastOpenedAt: "t" }} settings={{ ...createDefaultSettings(), interfaceLanguage: language, defaultRevealSource: "automatic" }} copy={copy} />));
      const start = () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes(copy.startSession));
      await vi.waitFor(() => expect(start()?.disabled).toBe(false));
      await act(async () => start()!.click());
      await vi.waitFor(() => expect(progressPublished).toBe(true));
      await vi.waitFor(() => expect(resolveEvents).toBeTypeOf("function"));
      await act(async () => resolveEvents(staleEvents(language)));
      await vi.waitFor(() => expect(host.querySelector(".live-transcript")).not.toBeNull());
      const text = host.querySelector(".live-transcript")!.textContent ?? "";
      const phaseLabel = language === "pl" ? "Faza 2" : "Phase 2";
      expect((text.match(new RegExp(phaseLabel, "g")) ?? []).length).toBe(1);
      expect((text.match(/PHASE2_UNIQUE_ANSWER/g) ?? []).length).toBe(1);
      expect(mocks.blind).toHaveBeenCalledTimes(1);
    } finally {
      finishRun?.();
      await act(async () => root.unmount());
      host.remove();
      mocks.blind.mockReset();
      mocks.identities.mockReset();
    }
  });

  it("history load preserves stored transcript and separate incomplete evidence", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const session = {
      id: "history-s",
      workspaceId: "w",
      profileId: "p",
      sessionCode: "HISTORY-PARTIAL",
      state: "AwaitingReveal",
      runType: "automatic",
      preRevealTranscript: "## Phase 1\n\n### Viewer response\n\nACCEPTED_PHASE1",
      postRevealTranscript: "",
      createdAt: "t",
      updatedAt: "t",
    };
    const partialEvents: SessionEventRecord[] = [
      { id: "partial", sessionId: "history-s", sequenceNumber: 1, eventType: "VIEWER_OUTPUT_INCOMPLETE", content: "UNIQUE_PARTIAL_PHASE2", metadata: { phase: 2, accepted: false, finishReason: "length" }, createdAt: "t" },
    ];
    mocks.identities.mockResolvedValue([]);
    const repository = workflowTestRepository({
      listProviderConfigs: async () => [],
      listProviderModels: async () => [],
      listTargets: async () => [],
      listRvSessions: async () => [session],
      listSessionEvents: async (sessionId: string) => sessionId === "history-s" ? partialEvents : [],
      getSessionSnapshot: async () => null,
      getReveal: async () => null,
      listCustomProtocols: async () => [],
    } as unknown as AppRepository);
    const copy = getCopy("en");
    try {
      await act(async () => root.render(<RvSessionPanel repository={repository} profile={{ id: "p", name: "P", createdAt: "t", updatedAt: "t" }} workspace={{ id: "w", profileId: "p", name: "W", kind: "rv", createdAt: "t", updatedAt: "t", lastOpenedAt: "t" }} settings={{ ...createDefaultSettings(), interfaceLanguage: "en" }} copy={copy} />));
      await act(async () => host.querySelector<HTMLButtonElement>(".session-metadata-toggle")!.click());
      await vi.waitFor(() => expect(host.querySelector<HTMLButtonElement>(".recent-session-open")).not.toBeNull());
      await act(async () => host.querySelector<HTMLButtonElement>(".recent-session-open")!.click());
      await vi.waitFor(() => expect(host.querySelector(".live-transcript")?.textContent).toContain("ACCEPTED_PHASE1"));
      const text = host.querySelector(".live-transcript")!.textContent ?? "";
      expect(text).toContain("ACCEPTED_PHASE1");
      expect(text).toContain("UNIQUE_PARTIAL_PHASE2");
      expect(text).toContain("Stored transcript (legacy compatibility)");
    } finally {
      await act(async () => root.unmount());
      host.remove();
      mocks.blind.mockReset();
      mocks.identities.mockReset();
    }
  });

  it("leaves live-only projection after STOP so event evidence is visible again", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const provider = { id: "pc", provider: "custom_openai", credentialId: "k", enabled: true, label: "P" };
    const model = { providerConfigId: "pc", provider: "custom_openai", modelId: "m", route: "route", displayName: "M", capabilities: { inputModalities: ["text"], outputModalities: ["text"], reasoning: { supported: false, efforts: [] }, temperature: { supported: false }, supportedParameters: [] }, pricing: {} };
    mocks.identities.mockResolvedValue([{ identity: { id: "i", displayName: "Viewer" }, providerConfig: provider, model }]);
    mocks.blind.mockImplementation(async request => {
      const transcript = acceptedTranscript("en");
      request.onProgress({ sessionId: "s", sessionCode: "S", state: "BlindRunning", transcript, phase: 2 });
      await new Promise<void>(resolve => request.signal.addEventListener("abort", () => {
        request.onProgress({ sessionId: "s", sessionCode: "S", state: "Interrupted", transcript, stopReason: "USER STOP" });
        resolve();
      }, { once: true }));
      return { sessionId: "s", sessionCode: "S", state: "Interrupted", transcript, stopReason: "USER STOP" };
    });
    const repository = workflowTestRepository({
      listProviderConfigs: async () => [provider],
      listProviderModels: async () => [model],
      listTargets: async () => [{ id: "t", collection: "user", sourceMetadata: {}, title: "T", revealText: "target", tags: [], createdAt: "t", updatedAt: "t" }],
      listRvSessions: async () => [],
      listSessionEvents: async (sessionId: string) => sessionId === "s" ? staleEvents("en") : [],
      listCustomProtocols: async () => [],
    } as unknown as AppRepository);
    const copy = getCopy("en");
    try {
      await act(async () => root.render(<RvSessionPanel repository={repository} profile={{ id: "p", name: "P", credentialId: "k", createdAt: "t", updatedAt: "t" }} workspace={{ id: "w", profileId: "p", name: "W", kind: "rv", createdAt: "t", updatedAt: "t", lastOpenedAt: "t" }} settings={{ ...createDefaultSettings(), interfaceLanguage: "en", defaultRevealSource: "automatic" }} copy={copy} />));
      const start = () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes(copy.startSession));
      await vi.waitFor(() => expect(start()?.disabled).toBe(false));
      await act(async () => start()!.click());
      await vi.waitFor(() => expect(host.querySelector(".live-transcript")?.textContent).toContain("PHASE2_UNIQUE_ANSWER"));
      const activeText = host.querySelector(".live-transcript")!.textContent ?? "";
      expect((activeText.match(/Phase 2/g) ?? []).length).toBe(1);
      const stop = () => host.querySelector<HTMLButtonElement>(".stop-button");
      await vi.waitFor(() => expect(stop()).not.toBeNull());
      await act(async () => stop()!.click());
      await vi.waitFor(() => expect(stop()).toBeNull());
      const stoppedText = host.querySelector(".live-transcript")!.textContent ?? "";
      expect(stoppedText).toContain("Stored transcript (legacy compatibility)");
      expect((stoppedText.match(/Phase 2/g) ?? []).length).toBeGreaterThanOrEqual(2);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      mocks.blind.mockReset();
      mocks.identities.mockReset();
    }
  });

});
