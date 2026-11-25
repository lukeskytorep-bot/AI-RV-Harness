import { describe, expect, it } from "vitest";
import { sha256Text } from "../application/sha256";
import { getTelepathicProtocol } from "../resources/protocolRegistry";
import { BrowserMonitorRepository } from "../storage/browser/monitorRepository";
import { BrowserSessionsRepository } from "../storage/browser/sessionsRepository";
import type { AppRepository } from "../storage/repository";
import { workflowTestRepository } from "../testing/workflowRepository";
import type { ProviderConfig, ProviderModel, ProviderMessage } from "../providers/types";
import { submitExternalReveal } from "./controller";
import { runAutomaticTelepathicSession, resumeTelepathicManualQuestionStage } from "./telepathicController";
import { telepathicStepPrompt } from "./telepathicControllerPrompts";
import { createSessionReplay } from "./resumeReplay";
import { sendMonitorPostRevealReview, sendPostRevealTurn } from "./postReveal";
import { verifyTelepathicTargetCodeTemplates, restoreTelepathicTargetCode } from "./telepathicTargetCode";
import { targetCodePolicy } from "../resources/rvLiteTargetCode";
import type { SessionSnapshot } from "./types";
import { capturedSessionTargetCode } from "../features/rvSessions/capturedSessionTargetCode";

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
  return { repository, workspaceId: "w", profileId: "u", providerConfig: config, model, protocol: getTelepathicProtocol(language), sessionLanguage: language, requestedSettings: { maxOutputTokens: 1024 }, maxRetries: 0, step8Questions: { mode: "predefined" as const, questions: ["Describe the subject's intention."] } };
}
const response = (n: number) => ({ content: `Distinct observation ${n}.`, finishReason: "stop", usage: {} });

describe("ordinary Telepathic target-code mode", () => {
  it("verifies the matrix and preserves all original step bodies", async () => {
    await verifyTelepathicTargetCodeTemplates();
    for (const language of ["pl", "en"] as const) for (let step = 1; step <= 9; step++) {
      const code = "RVH-PRIVATE";
      const legacy = telepathicStepPrompt(language, step, code);
      expect(telepathicStepPrompt(language, step, code, "with_code")).toBe(legacy);
      expect(telepathicStepPrompt(language, step, code, "without_code")).toBe((step === 1 ? (language === "pl" ? "Cel został wybrany.\n" : "The target has been selected.\n") : "") + legacy.slice(legacy.indexOf("\n") + 1));
    }
  });
  for (const language of ["pl", "en"] as const) for (const mode of ["with_code", "without_code", undefined] as const) {
    it(`runs nine steps, three deepenings and T9 in ${language} / ${mode ?? "legacy"}`, async () => {
      const repository = setup(), requests: ProviderMessage[][] = [];
      const result = await runAutomaticTelepathicSession({ ...input(repository, language), ...(mode ? { targetCodeMode: mode } : {}), chat: async ({ messages }) => { requests.push(structuredClone(messages)); return response(requests.length); } });
      expect(result.state).toBe("AwaitingReveal"); expect(requests).toHaveLength(13);
      for (const messages of requests) expect(JSON.stringify(messages).includes(result.sessionCode)).toBe(mode !== "without_code");
      const snapshot = (await repository.getSessionSnapshot(result.sessionId))!;
      expect(snapshot.sessionCode).toBe(result.sessionCode); expect(snapshot.telepathicProfileTargetCode?.policy.mode).toBe(mode);
      if (mode) {
        expect(snapshot.telepathicProfileTargetCode!.renderedPrompts).toHaveLength(9);
        for (const p of snapshot.telepathicProfileTargetCode!.renderedPrompts) expect(await sha256Text(p.content)).toBe(p.sha256);
      }
      const session = (await repository.getRvSession(result.sessionId))!;
      const restart = await capturedSessionTargetCode(snapshot, false, mode === "without_code" ? "with_code" : "without_code", session);
      expect(restart.blocked).toBe(false); expect(restart.restartOptions.targetCodeMode).toBe(mode);
      expect((await capturedSessionTargetCode(snapshot, true, "with_code", session)).restartOptions).toEqual({});
    });
  }
  it("restarts with a new identifier and the frozen condition, including legacy", async () => {
    for (const mode of ["with_code", "without_code", undefined] as const) {
      const repository = setup();
      const original = await runAutomaticTelepathicSession({ ...input(repository), ...(mode ? { targetCodeMode: mode } : {}), chat: async () => response(1) });
      const snapshot = (await repository.getSessionSnapshot(original.sessionId))!;
      const session = (await repository.getRvSession(original.sessionId))!;
      const captured = await capturedSessionTargetCode(snapshot, false, mode === "without_code" ? "with_code" : "without_code", session);
      const payloads: string[] = [];
      const restarted = await runAutomaticTelepathicSession({ ...input(repository), ...captured.restartOptions, chat: async ({ messages }) => { payloads.push(JSON.stringify(messages)); return response(payloads.length); } });
      expect(restarted.state).toBe("AwaitingReveal"); expect(restarted.sessionCode).not.toBe(original.sessionCode);
      expect(payloads).toHaveLength(13);
      expect(payloads.every(p => p.includes(restarted.sessionCode) === (mode !== "without_code"))).toBe(true);
      expect(payloads.every(p => !p.includes(original.sessionCode))).toBe(true);
      expect((await repository.getSessionSnapshot(restarted.sessionId))?.telepathicProfileTargetCode?.policy.mode).toBe(mode);
    }
  });
  it("uses predefined T9 in a monitored session without leaking the code", async () => {
    const repository = setup(), payloads: string[] = []; let monitor = 0;
    const result = await runAutomaticTelepathicSession({ ...input(repository), targetCodeMode: "without_code", monitor: { providerConfig: config, model }, chat: async ({ messages }) => { payloads.push(JSON.stringify(messages)); if (messages.some(m => m.role === "system" && m.content.includes("LOCKED TELEPATHIC EXECUTION RULE"))) { monitor++; return { content: "CONTINUE_PROTOCOL", usage: {} }; } return response(payloads.length); } });
    expect(result.state).toBe("AwaitingReveal"); expect(monitor).toBe(6); expect(payloads).toHaveLength(19);
    expect(payloads.every(p => !p.includes(result.sessionCode))).toBe(true);
  });
  it("resumes from saved mode through STOP and replay despite a different requested mode", async () => {
    const storage = makeStorage(), repository = setup(storage), stop = new AbortController(); let calls = 0; const payloads: string[] = [];
    const checked = ({ messages }: { messages: ProviderMessage[] }) => { payloads.push(JSON.stringify(messages)); return response(++calls); };
    const first = await runAutomaticTelepathicSession({ ...input(repository), targetCodeMode: "without_code", signal: stop.signal, chat: async request => { const r = checked(request); if (calls === 2) stop.abort(); return r; } });
    expect(first.state).toBe("Interrupted");
    const restored = setup(storage), session = (await restored.getRvSession(first.sessionId))!, snapshot = (await restored.getSessionSnapshot(session.id))!;
    const replay = await createSessionReplay({ repository: restored, session, events: await restored.listSessionEvents(session.id), liveChat: async request => checked(request) });
    const final = await runAutomaticTelepathicSession({ ...input(replay.repository), targetCodeMode: "with_code", resumeSession: session, resumeContinuationRoute: snapshot.continuationRoute, chat: replay.chat });
    expect(final.state).toBe("AwaitingReveal"); expect(calls).toBe(13); expect(payloads.every(p => !p.includes(first.sessionCode))).toBe(true);
    expect((await restored.getSessionSnapshot(session.id))?.telepathicProfileTargetCode?.policy.mode).toBe("without_code");
  });
  it("fails closed on absent or altered snapshots", async () => {
    const repository = setup(); let calls = 0;
    const first = await runAutomaticTelepathicSession({ ...input(repository), targetCodeMode: "without_code", chat: async () => response(1) });
    const session = (await repository.getRvSession(first.sessionId))!, snapshot = (await repository.getSessionSnapshot(session.id))!;
    const restart = { ...input(repository), resumeSession: session, chat: async () => response(++calls) };
    const get = repository.getSessionSnapshot.bind(repository);
    repository.getSessionSnapshot = async () => null;
    await expect(runAutomaticTelepathicSession(restart)).rejects.toThrow(/saved Session Snapshot/);
    for (const field of ["version", "templatesSha256"] as const) {
      const policy = snapshot.telepathicProfileTargetCode!;
      const corrupt = { ...snapshot, telepathicProfileTargetCode: { ...policy, policy: { ...policy.policy, [field]: "invalid" } } } as typeof snapshot;
      repository.getSessionSnapshot = async () => corrupt;
      await expect(runAutomaticTelepathicSession(restart)).rejects.toThrow(/mismatch/);
      await expect(capturedSessionTargetCode(corrupt, false, "with_code", session)).rejects.toThrow(/mismatch/);
    }
    const reordered = { ...snapshot, telepathicProfileTargetCode: { renderedPrompts: snapshot.telepathicProfileTargetCode!.renderedPrompts, policy: snapshot.telepathicProfileTargetCode!.policy } };
    await restoreTelepathicTargetCode(reordered, session);
    const altered = structuredClone(snapshot); altered.telepathicProfileTargetCode!.renderedPrompts[8].content += "!";
    await expect(restoreTelepathicTargetCode(altered, session)).rejects.toThrow(/mismatch/);
    repository.getSessionSnapshot = get; expect(calls).toBe(0);
  });
  it("rejects inconsistent captured prompts and conflicting policies on restart and both post-Reveal paths before dispatch", async () => {
    const repository = setup();
    const result = await runAutomaticTelepathicSession({ ...input(repository), targetCodeMode: "without_code", monitor: { providerConfig: config, model }, chat: async ({ messages }) => messages.some(m => m.role === "system" && m.content.includes("LOCKED TELEPATHIC EXECUTION RULE")) ? { content: "CONTINUE_PROTOCOL", usage: {} } : response(1) });
    expect(result.state).toBe("AwaitingReveal");
    await submitExternalReveal(repository, result.sessionId, "Subject near a lighthouse");
    const session = (await repository.getRvSession(result.sessionId))!;
    const snapshot = (await repository.getSessionSnapshot(result.sessionId))!;
    const getSnapshot = repository.getSessionSnapshot.bind(repository);
    const baselineTranscript = session.postRevealTranscript;
    await expect(capturedSessionTargetCode(snapshot, false, "with_code")).rejects.toThrow(/saved Telepathic session/);
    let calls = 0;
    const reviewInput = { repository, sessionId: session.id, existingTranscript: "", providerConfig: config, model, chat: async () => response(++calls) };
    const corruptions: Array<{ change: (s: SessionSnapshot) => void; error: RegExp }> = [
      { change: s => { s.telepathicProfileTargetCode!.renderedPrompts = []; }, error: /mismatch/ },
      { change: s => { s.telepathicProfileTargetCode!.renderedPrompts[8].content += "!"; }, error: /mismatch/ },
      { change: s => { s.telepathicProfileTargetCode!.renderedPrompts[0].sha256 = "bad"; }, error: /mismatch/ },
      { change: s => { s.telepathicProfileTargetCode!.renderedPrompts.reverse(); }, error: /mismatch/ },
      { change: s => { s.telepathicProfileTargetCode!.policy.mode = "with_code"; }, error: /mismatch/ },
      { change: s => { s.telepathicProfileTargetCode!.policy.templatesSha256 = "bad"; }, error: /mismatch/ },
      { change: s => { s.researchTargetCode = { policy: targetCodePolicy("without_code"), renderedPrompts: [] }; }, error: /Conflicting/ },
      { change: s => { s.sessionCode = "RVH-OTHER-SESSION"; }, error: /Session Snapshot/ },
    ];
    try {
      for (const { change, error } of corruptions) {
        const corrupt = structuredClone(snapshot);
        change(corrupt);
        repository.getSessionSnapshot = async () => corrupt;
        await expect(capturedSessionTargetCode(corrupt, false, "with_code", session)).rejects.toThrow(error);
        await expect(capturedSessionTargetCode(corrupt, true, "with_code", session)).rejects.toThrow(error);
        await expect(sendPostRevealTurn({ ...reviewInput, content: "Compare observations." })).rejects.toThrow(error);
        await expect(sendMonitorPostRevealReview(reviewInput)).rejects.toThrow(error);
        expect(calls).toBe(0);
        expect((await repository.getRvSession(session.id))?.postRevealTranscript).toBe(baselineTranscript);
      }
    } finally { repository.getSessionSnapshot = getSnapshot; }
    expect(await capturedSessionTargetCode(snapshot, false, "with_code", session)).toEqual({ blocked: false, restartOptions: { targetCodeMode: "without_code" } });
    await sendPostRevealTurn({ ...reviewInput, content: "Compare observations." });
    await sendMonitorPostRevealReview(reviewInput);
    expect(calls).toBe(2);
  });
  it("recovers a manual T9 checkpoint and rejects a question containing the code", async () => {
    const storage = makeStorage(), repository = setup(storage); let id = "";
    await expect(runAutomaticTelepathicSession({ ...input(repository), targetCodeMode: "without_code", step8Questions: { mode: "manual" }, chat: async () => response(1), onManualQuestionStage: handle => { if (handle) { id = handle.sessionId; throw new Error("simulated checkpoint interruption"); } } })).rejects.toThrow(/simulated checkpoint interruption/);
    const restored = setup(storage), session = (await restored.getRvSession(id))!;
    const payloads: string[] = []; let rejected = false;
    const result = await resumeTelepathicManualQuestionStage({ repository: restored, session, providerConfig: config, model, onManualQuestionStage: handle => { if (handle) void (async () => { try { await handle.ask(session.sessionCode); } catch { rejected = true; } try { await handle.ask("What is the intention?"); } finally { handle.finish(); } })(); }, chat: async ({ messages }) => { payloads.push(JSON.stringify(messages)); return response(payloads.length); } });
    expect(result.state).toBe("AwaitingReveal"); expect(rejected).toBe(true); expect(payloads).toHaveLength(2); expect(payloads.every(p => !p.includes(session.sessionCode))).toBe(true);
  });
  it("protects Viewer and Monitor blind and after Reveal, rejecting a leaked code", async () => {
    const repository = setup(); const payloads: string[] = []; let monitor = 0;
    const result = await runAutomaticTelepathicSession({ ...input(repository), targetCodeMode: "without_code", step8Questions: { mode: "monitor" }, monitor: { providerConfig: config, model }, chat: async ({ messages }) => { payloads.push(JSON.stringify(messages)); if (messages.some(m => m.role === "system" && m.content.includes("LOCKED TELEPATHIC EXECUTION RULE"))) { monitor++; return { content: monitor === 1 ? "Describe new details." : "CONTINUE_PROTOCOL", usage: {} }; } return response(payloads.length); } });
    expect(result.state).toBe("AwaitingReveal"); expect(monitor).toBe(8); expect(payloads.every(p => !p.includes(result.sessionCode))).toBe(true);
    await submitExternalReveal(repository, result.sessionId, "Subject near a lighthouse");
    let calls = 0; const reviewInput = { repository, sessionId: result.sessionId, existingTranscript: "", providerConfig: config, model, chat: async ({ messages }: { messages: ProviderMessage[] }) => { expect(JSON.stringify(messages)).not.toContain(result.sessionCode); return response(++calls); } };
    await expect(sendPostRevealTurn({ ...reviewInput, content: result.sessionCode })).rejects.toThrow(/Target-code policy/); expect(calls).toBe(0);
    const getReveal = repository.getReveal.bind(repository); repository.getReveal = async id => ({ ...(await getReveal(id))!, text: result.sessionCode });
    await expect(sendMonitorPostRevealReview(reviewInput)).rejects.toThrow(/Target-code policy/); expect(calls).toBe(0); repository.getReveal = getReveal;
    await sendPostRevealTurn({ ...reviewInput, content: "Compare observations." }); await sendMonitorPostRevealReview(reviewInput); expect(calls).toBe(2);
  });
  it.each(["with_code", undefined] as const)("preserves valid %s post-Reveal Viewer and Monitor reviews", async mode => {
    const repository = setup();
    const result = await runAutomaticTelepathicSession({ ...input(repository), ...(mode ? { targetCodeMode: mode } : {}), monitor: { providerConfig: config, model }, chat: async ({ messages }) => messages.some(m => m.role === "system" && m.content.includes("LOCKED TELEPATHIC EXECUTION RULE")) ? { content: "CONTINUE_PROTOCOL", usage: {} } : response(1) });
    expect(result.state).toBe("AwaitingReveal");
    await submitExternalReveal(repository, result.sessionId, `Subject near a lighthouse. Reference: ${result.sessionCode}`);
    const payloads: string[] = [];
    const reviewInput = { repository, sessionId: result.sessionId, existingTranscript: "", providerConfig: config, model, chat: async ({ messages }: { messages: ProviderMessage[] }) => { payloads.push(JSON.stringify(messages)); return response(payloads.length); } };
    await sendPostRevealTurn({ ...reviewInput, content: "Compare observations." });
    await sendMonitorPostRevealReview(reviewInput);
    expect(payloads).toHaveLength(2);
    expect(payloads.every(p => p.includes(result.sessionCode))).toBe(true);
  });
  it("blocks a code echoed into history before a second Viewer request", async () => {
    const repository = setup(); let code = "", calls = 0;
    const result = await runAutomaticTelepathicSession({ ...input(repository), targetCodeMode: "without_code", onProgress: p => { code = p.sessionCode; }, chat: async () => { calls++; return { content: `Observation ${code}`, finishReason: "stop", usage: {} }; } });
    expect(result.state).toBe("Interrupted"); expect(calls).toBe(1);
  });
});
