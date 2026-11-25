import { describe, expect, it } from "vitest";
import { sha256Text } from "../application/sha256";
import { getFullRcp } from "../resources/protocolRegistry";
import { BrowserMonitorRepository } from "../storage/browser/monitorRepository";
import { BrowserSessionsRepository } from "../storage/browser/sessionsRepository";
import type { AppRepository } from "../storage/repository";
import { workflowTestRepository } from "../testing/workflowRepository";
import type { ProviderConfig, ProviderModel, ProviderMessage } from "../providers/types";
import { runAutomaticRcpSession, submitExternalReveal } from "./controller";
import { rcpPhasePrompt } from "./controllerPrompts";
import { createSessionReplay } from "./resumeReplay";
import { sendMonitorPostRevealReview, sendPostRevealTurn } from "./postReveal";
import { assertRcpTargetCodeSnapshotMatches, freezeRcpTargetCode, rcpTargetCodePolicy, verifyRcpTargetCodeTemplates } from "./rcpTargetCode";
import { capturedSessionTargetCode } from "../features/rvSessions/capturedSessionTargetCode";

const code = "RVH-RCP-PRIVATE-123";
const config: ProviderConfig = { id: "p", provider: "openrouter", label: "P", credentialId: "c", enabled: true, createdAt: "now", updatedAt: "now" };
const model: ProviderModel = { providerConfigId: "p", provider: "openrouter", modelId: "m", displayName: "M", route: "openrouter:m", pricing: {}, recommended: false, rawMetadata: {}, refreshedAt: "now", capabilities: { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: false, confidence: "unknown" }, supportedParameters: [], maxOutputTokens: 65536, contextTokens: 131072, source: "provider", capturedAt: "now" } };
function makeStorage(): Storage {
  const data = new Map<string, string>();
  return { get length() { return data.size; }, clear: () => data.clear(), key: i => [...data.keys()][i] ?? null, getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: k => { data.delete(k); } };
}
function setup(storage = makeStorage()) {
  const sessions = new BrowserSessionsRepository({ storage, isResearchScoresFrozen: () => false });
  const monitor = new BrowserMonitorRepository({ storage, listRvSessions: id => sessions.listRvSessions(id) });
  return workflowTestRepository(Object.assign(sessions, { recordTargetUsage: async () => undefined, createMonitorRun: monitor.createMonitorRun.bind(monitor), appendMonitorIntervention: monitor.appendMonitorIntervention.bind(monitor), listMonitorRuns: monitor.listMonitorRuns.bind(monitor), listMonitorInterventions: monitor.listMonitorInterventions.bind(monitor) }) as unknown as AppRepository);
}
function input(repository: AppRepository, language: "en" | "pl" = "en") {
  return { repository, workspaceId: "w", profileId: "u", providerConfig: config, model, protocol: getFullRcp(language), sessionLanguage: language, requestedSettings: { maxOutputTokens: 1024 }, maxRetries: 0, sessionIdentity: { id: "rcp-private", sessionCode: code } };
}
const response = (n: number) => ({ content: `Distinct observation ${n}.`, finishReason: "stop", usage: {} });

describe("ordinary RCP target-code mode", () => {
  it("verifies the frozen template matrix and preserves the phase bodies", async () => {
    await verifyRcpTargetCodeTemplates();
    for (const language of ["pl", "en"] as const) for (let phase = 1; phase <= 6; phase++) {
      const legacy = rcpPhasePrompt(language, phase, code);
      expect(rcpPhasePrompt(language, phase, code, "with_code")).toBe(legacy);
      const expected = legacy.slice(legacy.indexOf("\n") + 1);
      expect(rcpPhasePrompt(language, phase, code, "without_code")).toBe((phase === 1 ? (language === "pl" ? "Cel został wybrany.\n" : "The target has been selected.\n") : "") + expected);
    }
  });
  for (const language of ["pl", "en"] as const) for (const mode of ["with_code", "without_code", undefined] as const) {
    it(`dispatches six ${language} phases in ${mode ?? "legacy"} mode`, async () => {
      const repository = setup(); const requests: ProviderMessage[][] = [];
      const result = await runAutomaticRcpSession({ ...input(repository, language), ...(mode ? { targetCodeMode: mode } : {}), chat: async ({ messages }) => { requests.push(structuredClone(messages)); return response(requests.length); } });
      expect(result.state).toBe("AwaitingReveal"); expect(result.sessionCode).toBe(code); expect(requests).toHaveLength(6);
      for (const messages of requests) expect(JSON.stringify(messages).includes(code)).toBe(mode !== "without_code");
      const snapshot = (await repository.getSessionSnapshot(result.sessionId))!;
      expect(snapshot.rcpProfileTargetCode?.policy.mode).toBe(mode);
      if (mode) {
        expect(snapshot.rcpProfileTargetCode!.renderedPrompts).toHaveLength(6);
        for (const prompt of snapshot.rcpProfileTargetCode!.renderedPrompts) expect(await sha256Text(prompt.content)).toBe(prompt.sha256);
      }
      expect(snapshot.sessionCode).toBe(code);
    });
  }
  it("freezes without-code through two Focus passes, Special Task, STOP, persisted replay and post-Reveal", async () => {
    const storage = makeStorage(); const repository = setup(storage); const stop = new AbortController(); let calls = 0;
    const common = { targetCodeMode: "without_code" as const, sessionFocus: { version: 1 as const, first: "location" as const, second: "activity" as const }, specialTask: { selectedOptions: [], customText: "Describe Subject A." } };
    const checked = ({ messages }: { messages: ProviderMessage[] }) => { expect(JSON.stringify(messages)).not.toContain(code); return response(++calls); };
    const first = await runAutomaticRcpSession({ ...input(repository), ...common, signal: stop.signal, chat: async request => { const result = checked(request); if (calls === 2) stop.abort(); return result; } });
    expect(first.state).toBe("Interrupted");
    const restored = setup(storage), session = (await restored.getRvSession(first.sessionId))!, snapshot = (await restored.getSessionSnapshot(session.id))!;
    const replay = await createSessionReplay({ repository: restored, session, events: await restored.listSessionEvents(session.id), liveChat: async request => checked(request) });
    const final = await runAutomaticRcpSession({ ...input(replay.repository), ...common, targetCodeMode: "with_code", resumeSession: session, resumeContinuationRoute: snapshot.continuationRoute, chat: replay.chat });
    expect(final.state).toBe("AwaitingReveal"); expect(calls).toBe(14); expect(final.transcript).not.toContain(code);
    expect((await restored.getSessionSnapshot(session.id))?.rcpProfileTargetCode?.policy.mode).toBe("without_code");
    await submitExternalReveal(restored, session.id, "Stone lighthouse");
    let reviewCalls = 0;
    const review = await sendPostRevealTurn({ repository: restored, sessionId: session.id, existingTranscript: "", providerConfig: config, model, content: "Compare the observations.", chat: async ({ messages }) => { expect(JSON.stringify(messages)).not.toContain(code); reviewCalls++; return response(20); } });
    expect(reviewCalls).toBe(1);
    let rejectedCalls = 0;
    await expect(sendPostRevealTurn({ repository: restored, sessionId: session.id, existingTranscript: review.transcript, providerConfig: config, model, content: code, chat: async () => { rejectedCalls++; return response(21); } })).rejects.toThrow(/Target-code policy/);
    expect(rejectedCalls).toBe(0);
  });
  it("checks Monitor and Viewer intervention requests without transmitting the code", async () => {
    const repository = setup(); let viewer = 0, monitor = 0;
    const result = await runAutomaticRcpSession({ ...input(repository), targetCodeMode: "without_code", monitor: { providerConfig: config, model }, chat: async ({ messages }) => {
      expect(JSON.stringify(messages)).not.toContain(code);
      if (messages.some(m => m.role === "system" && m.content.includes("AI Monitor conducting a blind"))) { monitor++; return { content: monitor === 1 ? "Describe new spatial data." : "CONTINUE_PROTOCOL", usage: {} }; }
      return response(++viewer);
    } });
    expect(result.state).toBe("AwaitingReveal"); expect(viewer).toBe(7); expect(monitor).toBe(6);
  });
  it("rejects a leaked code in the system prompt before any Viewer dispatch", async () => {
    let calls = 0;
    const result = await runAutomaticRcpSession({ ...input(setup()), targetCodeMode: "without_code", rvSystemPrompt: { id: "x", version: "1", content: code, contentSha256: "x" }, chat: async () => response(++calls) });
    expect(result.state).toBe("Interrupted"); expect(calls).toBe(0);
  });
  it("rejects profile mode on Research before dispatch", async () => {
    let calls = 0;
    await expect(runAutomaticRcpSession({ ...input(setup()), targetCodeMode: "without_code", researchProjectId: "r", operationKind: "research_viewer", chat: async () => response(++calls) })).rejects.toThrow(/cannot override Research/);
    expect(calls).toBe(0);
  });
  it("restarts with a new identifier but the original condition, independently of the current profile", async () => {
    for (const mode of ["with_code", "without_code", undefined] as const) {
      const repository = setup();
      const original = await runAutomaticRcpSession({ ...input(repository), ...(mode ? { targetCodeMode: mode } : {}), chat: async () => response(1) });
      const snapshot = (await repository.getSessionSnapshot(original.sessionId))!;
      const current = mode === "without_code" ? "with_code" : "without_code";
      const restart = capturedSessionTargetCode(snapshot, false, current);
      const newCode = "RVH-RCP-RESTART-456";
      const payloads: string[] = [];
      const restarted = await runAutomaticRcpSession({ ...input(repository), ...restart.restartOptions, sessionIdentity: { id: "rcp-restarted", sessionCode: newCode }, chat: async ({ messages }) => { payloads.push(JSON.stringify(messages)); return response(payloads.length); } });
      expect(restarted.state).toBe("AwaitingReveal"); expect(restarted.sessionCode).toBe(newCode); expect(payloads).toHaveLength(6);
      for (const payload of payloads) { expect(payload).not.toContain(code); expect(payload.includes(newCode)).toBe(mode !== "without_code"); }
      expect((await repository.getSessionSnapshot(restarted.sessionId))?.rcpProfileTargetCode?.policy.mode).toBe(mode);
    }
  });
  it("inherits either frozen RCP restart condition and rejects incompatible hashes", async () => {
    const protocol = { id: "full-rcp", version: "1.5a", language: "en" as const, fullContent: "", contentSha256: "" };
    for (const mode of ["with_code", "without_code"] as const) {
      const frozen = await freezeRcpTargetCode("en", code, rcpTargetCodePolicy(mode));
      const snapshot = { protocol, rcpProfileTargetCode: frozen };
      const current = mode === "with_code" ? "without_code" : "with_code";
      expect(capturedSessionTargetCode(snapshot, false, current)).toEqual({ blocked: false, restartOptions: { targetCodeMode: mode } });
      expect(capturedSessionTargetCode(snapshot, true, current)).toEqual({ blocked: false, restartOptions: {} });
      for (const field of ["version", "templatesSha256"] as const) expect(() => capturedSessionTargetCode({ ...snapshot, rcpProfileTargetCode: { ...frozen, policy: { ...frozen.policy, [field]: "bad" } } }, false, current)).toThrow(/mismatch/);
    }
    expect(capturedSessionTargetCode({ protocol }, false, "without_code")).toEqual({ blocked: false, restartOptions: {} });
  });
  it("rejects Resume without a saved snapshot, including legacy callers, before dispatch", async () => {
    const repository = setup(); let calls = 0;
    const first = await runAutomaticRcpSession({ ...input(repository), targetCodeMode: "without_code", chat: async () => response(++calls) });
    const session = (await repository.getRvSession(first.sessionId))!;
    const snapshot = (await repository.getSessionSnapshot(first.sessionId))!;
    const missing = Object.create(repository) as AppRepository;
    missing.getSessionSnapshot = async () => null;
    calls = 0;
    await expect(runAutomaticRcpSession({ ...input(missing), resumeSession: session, resumeContinuationRoute: snapshot.continuationRoute, chat: async () => response(++calls) })).rejects.toThrow(/snapshot/i);
    expect(calls).toBe(0);
  });
  it("compares frozen fields regardless of property order but rejects changed prompts and hashes", async () => {
    const expected = await freezeRcpTargetCode("en", code, rcpTargetCodePolicy("without_code"));
    const reordered = { renderedPrompts: expected.renderedPrompts.map(p => ({ sha256: p.sha256, content: p.content })), policy: { templatesSha256: expected.policy.templatesSha256, version: expected.policy.version, mode: expected.policy.mode } };
    assertRcpTargetCodeSnapshotMatches(reordered, expected);
    for (const field of ["content", "sha256"] as const) {
      const altered = structuredClone(reordered); altered.renderedPrompts[0][field] = "altered";
      expect(() => assertRcpTargetCodeSnapshotMatches(altered, expected)).toThrow(/mismatch/);
    }
    expect(() => assertRcpTargetCodeSnapshotMatches({ ...reordered, renderedPrompts: [...reordered.renderedPrompts].reverse() }, expected)).toThrow(/mismatch/);
    expect(() => assertRcpTargetCodeSnapshotMatches({ ...reordered, renderedPrompts: [] }, expected)).toThrow(/mismatch/);
  });
  it("guards the Monitor after Reveal without affecting ordinary with-code review", async () => {
    for (const mode of ["without_code", "with_code"] as const) {
      const repository = setup();
      const result = await runAutomaticRcpSession({ ...input(repository), targetCodeMode: mode, monitor: { providerConfig: config, model }, chat: async ({ messages }) => messages.some(m => m.role === "system" && m.content.includes("AI Monitor conducting a blind")) ? { content: "CONTINUE_PROTOCOL", usage: {} } : response(1) });
      await submitExternalReveal(repository, result.sessionId, "Stone lighthouse");
      let calls = 0;
      const reviewInput = { repository, sessionId: result.sessionId, existingTranscript: "", providerConfig: config, model, chat: async ({ messages }: { messages: ProviderMessage[] }) => { if (mode === "without_code") expect(JSON.stringify(messages)).not.toContain(code); return response(++calls); } };
      if (mode === "without_code") {
        const getReveal = repository.getReveal.bind(repository);
        repository.getReveal = async id => ({ ...(await getReveal(id))!, text: code });
        await expect(sendMonitorPostRevealReview(reviewInput)).rejects.toThrow(/Target-code policy/);
        expect(calls).toBe(0);
        repository.getReveal = getReveal;
      }
      await sendMonitorPostRevealReview(reviewInput);
      expect(calls).toBe(1);
    }
  });

});
