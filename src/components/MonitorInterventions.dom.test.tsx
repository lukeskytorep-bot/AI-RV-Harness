// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlindTranscriptRecord, buildBlindTranscriptBlocks } from "./BlindTranscriptRecord";
import { BrowserSessionsRepository } from "../storage/browser/sessionsRepository";
import type { AppRepository } from "../storage/repository";
import type { ProviderConfig, ProviderModel, ProviderMessage } from "../providers/types";
import type { SessionEventRecord } from "../sessions/types";
import { getTelepathicProtocol } from "../resources/protocolRegistry";
import { runAutomaticTelepathicSession } from "../sessions/telepathicController";
import { createSessionReplay } from "../sessions/resumeReplay";
import { readableBlindTranscript } from "../sessions/blindTranscriptEvidence";
import { renderCompleteSessionMarkdown } from "../exports/sessionDocument";

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();container = document.createElement("div");document.body.append(container);root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount());container.remove(); });
const config: ProviderConfig = { id: "p", provider: "openrouter", label: "P", credentialId: "c", enabled: true, createdAt: "now", updatedAt: "now" };
const model: ProviderModel = { providerConfigId: "p", provider: "openrouter", modelId: "m", displayName: "M", route: "openrouter:m", pricing: {}, recommended: false, rawMetadata: {}, refreshedAt: "now", capabilities: { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: false, confidence: "unknown" }, supportedParameters: [], maxOutputTokens: 65536, contextTokens: 131072, source: "provider", capturedAt: "now" } };
const command = "Observe the new spatial relations.";
async function run(language: "pl" | "en", kind: "normal" | "live-t9" | "predefined-t9", repeated = false, continuation = false) {
  const repository = Object.assign(new BrowserSessionsRepository({ storage: localStorage, isResearchScoresFrozen: () => false }), {
    createMonitorRun: async () => "mr", appendMonitorIntervention: async () => {}, recordTargetUsage: async () => {},
  }) as unknown as AppRepository;
  const viewerRequests: ProviderMessage[][] = [], monitorRequests: ProviderMessage[][] = [];
  const perStep = new Map<number, number>();
  const input = { repository, workspaceId: "w", profileId: "p", providerConfig: config, model, protocol: getTelepathicProtocol(language), sessionLanguage: language, requestedSettings: { maxOutputTokens: 1024 }, step8Questions: kind === "predefined-t9" ? { mode: "predefined" as const, questions: [command] } : { mode: "monitor" as const }, monitor: { providerConfig: config, model }, maxRetries: 0 };
  const result = await runAutomaticTelepathicSession({ ...input, chat: async ({ messages }) => {
    if (messages.some(m => m.role === "system" && /LOCKED TELEPATHIC EXECUTION RULE|ZABLOKOWANA REGUŁA WYKONANIA TELEPATYCZNEGO/.test(m.content))) {
      monitorRequests.push(structuredClone(messages));
      const packet = messages.at(-1)!.content;
      const step = Number(packet.match(/CURRENT STEP: (\d+)|BIEŻĄCY KROK: (\d+)/)?.slice(1).find(Boolean));
      const count = (perStep.get(step) ?? 0) + 1;perStep.set(step, count);
      return { content: count <= (repeated ? 2 : 1) && step === (kind === "normal" ? 3 : kind === "live-t9" ? 8 : -1) ? command : "CONTINUE_PROTOCOL", finishReason: "stop", usage: {} };
    }
    viewerRequests.push(structuredClone(messages));
    const reasoningDetails = continuation ? [{ type: "reasoning.summary", summary: "Opaque saved reasoning", id: `r${viewerRequests.length}`, format: "openai-responses-v1", index: 0 }] : undefined;
    return { ...(reasoningDetails ? { reasoningDetails } : {}), content: `Blind evidence ${viewerRequests.length}`, finishReason: "stop", usage: {} };
  } });
  expect(result.state).toBe("AwaitingReveal");
  return { repository, result, input, viewerRequests, monitorRequests };
}

describe("mounted Monitor intervention presentation", () => {
  it.each(["en", "pl"] as const)("shows one instruction for one %s decision/request/response while keeping both events and exact replay", async language => {
    const { repository, result, input, viewerRequests } = await run(language, "normal");
    const events = await repository.listSessionEvents(result.sessionId), original = structuredClone(events);
    const monitor = events.find(e => e.eventType === "MONITOR_INTERVENTION")!;
    const controller = events.find(e => e.eventType === "CONTROLLER_STEP" && e.metadata?.interventionId === monitor.metadata?.interventionId)!;
    expect(events.filter(e => e.eventType === "MONITOR_DECISION" && e.metadata?.decision === "INTERVENE")).toHaveLength(1);
    expect(controller.content).toBe(command);expect(controller.metadata?.stepId).toBe(monitor.metadata?.viewerStepId);
    expect(viewerRequests.filter(r => r.at(-1)?.content === command)).toHaveLength(1);
    expect(events.filter(e => e.eventType === "VIEWER_RESPONSE" && e.metadata?.interventionId === monitor.metadata?.interventionId)).toHaveLength(1);
    await act(async () => root.render(<BlindTranscriptRecord events={events} fallbackTranscript={result.transcript} interfaceLanguage={language} sessionLanguage={language} />));
    expect(container.querySelector(".blind-transcript-fallback")).toBeNull();
    expect([...container.querySelectorAll(".blind-transcript-block")].filter(e => e.textContent?.includes(command))).toHaveLength(1);
    const session = (await repository.getRvSession(result.sessionId))!, snapshot = (await repository.getSessionSnapshot(session.id))!;
    const liveChat = vi.fn(async () => { throw new Error("unexpected paid replay"); });
    const replay = await createSessionReplay({ repository, session, events, monitorRun: { id: "mr", sessionId: session.id, sessionCode: session.sessionCode, modelRoute: model.route, libraryVersion: "v1", maxInterventions: 5, createdAt: "now", interventionCount: 1 }, liveChat });
    const resumed = await runAutomaticTelepathicSession({ ...input, repository: replay.repository, resumeSession: session, resumeContinuationRoute: snapshot.continuationRoute, chat: replay.chat });
    expect(resumed.transcript).toBe(result.transcript);expect(liveChat).not.toHaveBeenCalled();
    expect(await repository.listSessionEvents(session.id)).toEqual(original);
  });
  it("preserves legacy replay and stored OpenRouter continuation while keeping identical separate exchanges", async () => {
    const { repository, result, input, viewerRequests } = await run("en", "normal", true, true);
    const events = await repository.listSessionEvents(result.sessionId);
    const interventions = events.filter(event => event.eventType === "MONITOR_INTERVENTION");
    expect(interventions).toHaveLength(2);expect(interventions[0].metadata?.interventionId).not.toBe(interventions[1].metadata?.interventionId);
    expect(viewerRequests.filter(request => request.at(-1)?.content === command)).toHaveLength(2);
    const legacy = events.map(event => {
      const metadata = { ...event.metadata };delete metadata.interventionId;delete metadata.viewerStepId;
      if (event.eventType === "CONTROLLER_STEP") delete metadata.stepId;
      return { ...event, metadata };
    });
    localStorage.setItem("rvh.dev.session_events", JSON.stringify(legacy));
    const response = legacy.find(event => event.eventType === "VIEWER_RESPONSE" && event.metadata?.source === "monitor_intervention")!;
    const stateBefore = await repository.getSessionEventProviderState(response.id);expect(stateBefore?.state).toBeDefined();
    const session = (await repository.getRvSession(result.sessionId))!, snapshot = (await repository.getSessionSnapshot(session.id))!;
    const liveChat = vi.fn(async () => { throw new Error("legacy replay must not dispatch"); });
    const replay = await createSessionReplay({ repository, session, events: legacy, monitorRun: { id: "mr", sessionId: session.id, sessionCode: session.sessionCode, modelRoute: model.route, libraryVersion: "v1", maxInterventions: 5, createdAt: "now", interventionCount: 2 }, liveChat });
    const final = await runAutomaticTelepathicSession({ ...input, repository: replay.repository, resumeSession: session, resumeContinuationRoute: snapshot.continuationRoute, chat: replay.chat });
    expect(final.transcript).toBe(result.transcript);expect(liveChat).not.toHaveBeenCalled();
    expect(await repository.getSessionEventProviderState(response.id)).toEqual(stateBefore);
    expect(buildBlindTranscriptBlocks(legacy, "en").filter(block => block.content === command)).toHaveLength(2);
  });
  it.each([["en", "live-t9"], ["pl", "live-t9"], ["en", "predefined-t9"], ["pl", "predefined-t9"]] as const)("keeps both command and wrapper for %s %s in UI and export", async (language, kind) => {
    const { repository, result, viewerRequests } = await run(language, kind);
    const events = await repository.listSessionEvents(result.sessionId), session = (await repository.getRvSession(result.sessionId))!;
    const sent = events.find(e => e.eventType === "CONTROLLER_STEP" && e.metadata?.interventionId)!;
    expect(sent.content).toContain(language === "pl" ? "T9 — pytanie" : "T9 — tasking question");
    expect(viewerRequests.filter(r => r.at(-1)?.content === sent.content)).toHaveLength(1);
    await act(async () => root.render(<BlindTranscriptRecord events={events} fallbackTranscript={result.transcript} interfaceLanguage="pl" sessionLanguage={language} />));
    expect(container.textContent).toContain("Interwencja Monitora");expect(container.textContent).toContain("Faktycznie wysłana instrukcja");
    expect(container.textContent).toContain(sent.content);expect(container.querySelector(".blind-transcript-fallback")).toBeNull();
    const exportText = renderCompleteSessionMarkdown({ title: "Export", language: "pl", session, events, sessionLanguage: language, revealText: "Target", revealFilesMarkdown: "", scores: [], clarifications: [] });
    expect(exportText).toContain(language === "pl" ? "Faktycznie wysłana instrukcja" : "Actually sent instruction");expect(exportText).toContain(sent.content);
    expect(await repository.getViewerEvidence(session.id)).toBe(result.transcript); // No rewritten sealed evidence.
  });
  it("retains identical commands from separate calls and an unclosed fence cannot consume the next card", async () => {
    const events: SessionEventRecord[] = [];
    for (let exchange = 1; exchange <= 2; exchange++) {
      for (const [offset, eventType, content, source] of [[0, "MONITOR_INTERVENTION", command, undefined], [1, "CONTROLLER_STEP", command, "monitor_intervention"], [2, "VIEWER_RESPONSE", exchange === 1 ? "```text\nunfinished" : "**Second evidence**", "monitor_intervention"]] as const) {
        events.push({ id: `e${events.length}`, sessionId: "s", sequenceNumber: exchange * 3 + offset, eventType, content, metadata: { step: 3, exchangeNumber: exchange, ...(source ? { source } : {}) }, createdAt: "now" });
      }
    }
    expect(buildBlindTranscriptBlocks(events, "en").filter(b => b.content === command)).toHaveLength(2);
    await act(async () => root.render(<BlindTranscriptRecord events={events} fallbackTranscript="" interfaceLanguage="en" />));
    expect(container.querySelectorAll(".blind-transcript-block.monitor")).toHaveLength(2);
    expect(container.querySelector("strong")?.textContent).toBe("Second evidence");
    expect(readableBlindTranscript(events, "unknown legacy data", "en")).toBe("unknown legacy data");
  });
});
