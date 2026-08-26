import { describe, expect, it } from "vitest";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import { getTelepathicProtocol } from "../resources/protocolRegistry";
import type { AppRepository } from "../storage/repository";
import { TELEPATHIC_STEP_MAPPING } from "./telepathicControllerPrompts";
import type { RvSession, SessionEventRecord, SessionSnapshot } from "./types";
import { resumeTelepathicManualQuestionStage, runAutomaticTelepathicSession, telepathicManualRecoveryState } from "./telepathicController";

const config: ProviderConfig = { id: "p", provider: "openrouter", label: "P", credentialId: "c", enabled: true, createdAt: "now", updatedAt: "now" };
const model: ProviderModel = {
  providerConfigId: "p", provider: "openrouter", modelId: "m", displayName: "M", route: "openrouter:m", pricing: {}, recommended: false, rawMetadata: {}, refreshedAt: "now",
  capabilities: { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: false, confidence: "unknown" }, supportedParameters: [], maxOutputTokens: 4096, source: "provider", capturedAt: "now" },
};

function repository(log: string[], snapshots: SessionSnapshot[] = []) {
  return {
    createRvSession: async () => ({} as never),
    updateRvSessionState: async (_id: string, state: string) => { log.push(`state:${state}`); },
    appendSessionEvent: async (_id: string, event: { eventType: string }) => { log.push(`event:${event.eventType}`); },
    updatePreRevealTranscript: async (_id: string, transcript: string) => { log.push(`saved:${(transcript.match(/Viewer response/g) ?? []).length}`); },
    saveSessionSnapshot: async (_id: string, snapshot: SessionSnapshot) => { snapshots.push(snapshot); },
    sealPreReveal: async () => { log.push("sealed"); },
    acceptReveal: async () => { log.push("reveal"); },
    recordTargetUsage: async () => undefined,
    createMonitorRun: async () => "monitor_1",
    appendMonitorIntervention: async () => undefined,
  } as unknown as Pick<AppRepository, "createRvSession" | "updateRvSessionState" | "appendSessionEvent" | "updatePreRevealTranscript" | "saveSessionSnapshot" | "sealPreReveal" | "acceptReveal" | "recordTargetUsage" | "createMonitorRun" | "appendMonitorIntervention">;
}

describe("automatic Telepathic Protocol controller", () => {
  it("runs nine controller steps, fixed deepenings after Steps 3–5, T9 questions, then T10 and reveal boundary", async () => {
    const log: string[] = [];
    const snapshots: SessionSnapshot[] = [];
    const prompts: string[] = [];
    const result = await runAutomaticTelepathicSession({
      repository: repository(log, snapshots),
      workspaceId: "w",
      profileId: "profile",
      aiIsBeDisplayName: "Leo",
      providerConfig: config,
      model,
      protocol: getTelepathicProtocol("en"),
      sessionLanguage: "en",
      requestedSettings: { maxOutputTokens: 1024 },
      step8Questions: { mode: "predefined", questions: ["What is the subject's primary intention?"] },
      chat: async ({ messages }) => {
        prompts.push(messages.at(-1)?.content ?? "");
        return { content: `Distinct blind telepathic response ${prompts.length}.`, usage: {} };
      },
    });
    expect(result.state).toBe("AwaitingReveal");
    expect(prompts).toHaveLength(13);
    expect(prompts[0]).toContain("Hello, Leo.");
    expect(prompts[0]).toContain("T0 (Telepathic Reset), followed by T1");
    expect(prompts[3]).toContain("Return now only to Step 3");
    expect(prompts[5]).toContain("Return now only to Step 4");
    expect(prompts[7]).toContain("Return now only to Step 5");
    expect(prompts[11]).toContain("T9 — tasking question 1");
    expect(prompts[12]).toContain("T10 (Telepathic Summary)");
    expect(log.at(-1)).toBe("event:PRE_REVEAL_SEALED");
    expect(snapshots[0].telepathic).toEqual(expect.objectContaining({ controllerStepCount: 9, fixedDeepeningAfterSteps: [3, 4, 5] }));
  });

  it("invokes AI Monitor after Steps 2–8 only and uses the telepathic whole-session scope after Step 8", async () => {
    const log: string[] = [];
    let viewerCalls = 0;
    let monitorCalls = 0;
    const monitorPackets: string[] = [];
    const result = await runAutomaticTelepathicSession({
      repository: repository(log), workspaceId: "w", profileId: "p", providerConfig: config, model,
      protocol: getTelepathicProtocol("en"), sessionLanguage: "en", requestedSettings: { maxOutputTokens: 1024 },
      step8Questions: { mode: "monitor" }, monitor: { providerConfig: config, model },
      chat: async ({ messages }) => {
        const monitorRequest = messages.some((message) => message.role === "system" && message.content.includes("LOCKED TELEPATHIC EXECUTION RULE"));
        if (monitorRequest) {
          monitorCalls += 1;
          monitorPackets.push(messages.at(-1)?.content ?? "");
          return { content: "CONTINUE_PROTOCOL", usage: {} };
        }
        viewerCalls += 1;
        return { content: `Viewer response ${viewerCalls} with distinct telepathic evidence.`, usage: {} };
      },
    });
    expect(result.state).toBe("AwaitingReveal");
    expect(viewerCalls).toBe(12);
    expect(monitorCalls).toBe(7);
    expect(monitorPackets.map((packet) => packet.match(/CURRENT STEP: (\d+)/)?.[1])).toEqual(["2", "3", "4", "5", "6", "7", "8"]);
    expect(monitorPackets.at(-1)).toContain("SCOPE: You may formulate a T9 question");
  });

  it("reveals an eligible stored telepathic target automatically after Step 9", async () => {
    const log: string[] = [];
    const result = await runAutomaticTelepathicSession({
      repository: repository(log), workspaceId: "w", profileId: "p", providerConfig: config, model,
      protocol: getTelepathicProtocol("en"), sessionLanguage: "en", requestedSettings: { maxOutputTokens: 1024 },
      step8Questions: { mode: "predefined", questions: ["What is most important now?"] },
      automaticTarget: {
        id: "telepathic_person", collection: "user", title: "Person", revealText: "A historical person", tags: [],
        sourceMetadata: { targetKind: "telepathic" }, createdAt: "now", updatedAt: "now",
      },
      chat: async () => ({ content: "Distinct blind response.", usage: {} }),
    });
    expect(result.state).toBe("Revealed");
    expect(log).toContain("sealed");
    expect(log).toContain("reveal");
    expect(log.indexOf("sealed")).toBeLessThan(log.indexOf("reveal"));
  });

  it("runs the approved Polish protocol and Polish controller prompts", async () => {
    const prompts: string[] = [];
    const result = await runAutomaticTelepathicSession({
      repository: repository([]), workspaceId: "w", profileId: "p", providerConfig: config, model,
      protocol: getTelepathicProtocol("pl"), sessionLanguage: "pl", requestedSettings: { maxOutputTokens: 1024 },
      step8Questions: { mode: "predefined", questions: ["Jaka jest główna intencja podmiotu?"] },
      chat: async ({ messages }) => {
        prompts.push(messages.at(-1)?.content ?? "");
        return { content: `Odrębna ślepa odpowiedź ${prompts.length}.`, usage: {} };
      },
    });
    expect(result.state).toBe("AwaitingReveal");
    expect(prompts[0]).toContain("ŚLEPY KOD CELU");
    expect(prompts[3]).toContain("Wróć teraz wyłącznie do Kroku 3");
    expect(prompts[11]).toContain("T9 — pytanie taskingu 1");
    expect(prompts[12]).toContain("Podsumowanie telepatyczne");
  });

  it("pauses after Step 8 for operator questions and continues to Step 9 only after finish", async () => {
    const prompts: string[] = [];
    const result = await runAutomaticTelepathicSession({
      repository: repository([]), workspaceId: "w", profileId: "p", providerConfig: config, model,
      protocol: getTelepathicProtocol("en"), sessionLanguage: "en", requestedSettings: { maxOutputTokens: 1024 },
      step8Questions: { mode: "manual" },
      onManualQuestionStage: (handle) => {
        if (handle) void handle.ask("What is the subject withholding?").then(() => handle.finish());
      },
      chat: async ({ messages }) => {
        prompts.push(messages.at(-1)?.content ?? "");
        return { content: `Manual flow response ${prompts.length}.`, usage: {} };
      },
    });
    expect(result.state).toBe("AwaitingReveal");
    expect(prompts).toHaveLength(13);
    expect(prompts[11]).toContain("What is the subject withholding?");
    expect(prompts[12]).toContain("T10 (Telepathic Summary)");
  });

  it("resumes a durable manual Step 8 checkpoint without rerunning Steps 1–8", async () => {
    const protocol = getTelepathicProtocol("en");
    const session: RvSession = {
      id: "session_resume", workspaceId: "w", profileId: "p", sessionCode: "RV-RESUME", state: "BlindRunning", runType: "automatic",
      preRevealTranscript: "## Telepathic Protocol — Step 8 (T8)\n\n### Viewer response\n\nExisting response.", postRevealTranscript: "", createdAt: "now", updatedAt: "now",
    };
    const snapshot = {
      schemaVersion: 2, sessionId: session.id, sessionCode: session.sessionCode, profileId: "p", workspaceId: "w",
      providerConfigId: config.id, credentialId: config.credentialId, provider: config.provider, modelId: model.modelId, modelRoute: model.route,
      capabilitySnapshot: {}, capabilityCapturedAt: "now", generationSettings: { requested: { maxOutputTokens: 1024 }, effective: { maxOutputTokens: 1024 }, omitted: [] },
      sessionLanguage: "en", protocol: { id: protocol.id, version: protocol.version, language: protocol.language, contentSha256: protocol.contentSha256, fullContent: protocol.content },
      controllerPrompt: { id: "telepathic-nine-step-controller", version: "1.0.0", language: "en" },
      telepathic: { controllerStepCount: 9, step8QuestionMode: "manual", predefinedQuestions: [], fixedDeepeningAfterSteps: [3, 4, 5], stepMapping: TELEPATHIC_STEP_MAPPING.map((entry) => ({ controllerStep: entry.controllerStep, protocolSections: [...entry.protocolSections] })), targetKind: "external" },
      revealSource: "external", applicationVersion: "0.7.9", createdAt: "now",
    } satisfies SessionSnapshot;
    const events: SessionEventRecord[] = [
      { id: "e1", sessionId: session.id, sequenceNumber: 1, eventType: "CONTROLLER_STEP", role: "controller", content: "Execute Step 8", metadata: { step: 8 }, createdAt: "now" },
      { id: "e2", sessionId: session.id, sequenceNumber: 2, eventType: "VIEWER_RESPONSE", role: "assistant", content: "Existing response.", metadata: { step: 8 }, createdAt: "now" },
      { id: "e3", sessionId: session.id, sequenceNumber: 3, eventType: "TELEPATHIC_QUESTIONS_AWAITING_OPERATOR", role: "controller", metadata: { step: 8 }, createdAt: "now" },
    ];
    let transcript = session.preRevealTranscript;
    const prompts: string[] = [];
    const repository = {
      getSessionSnapshot: async () => snapshot,
      listSessionEvents: async () => events,
      updateRvSessionState: async () => undefined,
      appendSessionEvent: async (_sessionId: string, event: { eventType: string; role?: SessionEventRecord["role"]; content?: string; metadata?: Record<string, unknown> }) => {
        events.push({ ...event, id: `e${events.length + 1}`, sessionId: session.id, sequenceNumber: events.length + 1, createdAt: "now" });
      },
      updatePreRevealTranscript: async (_sessionId: string, next: string) => { transcript = next; },
      sealPreReveal: async () => undefined,
      acceptReveal: async () => undefined,
      recordTargetUsage: async () => undefined,
      createRvSession: async () => session,
      saveSessionSnapshot: async () => undefined,
      createMonitorRun: async () => "monitor",
      appendMonitorIntervention: async () => undefined,
    } as unknown as Parameters<typeof resumeTelepathicManualQuestionStage>[0]["repository"];

    const result = await resumeTelepathicManualQuestionStage({
      repository, session, providerConfig: config, model,
      onManualQuestionStage: (handle) => { if (handle) void handle.ask("What remains concealed?").then(() => handle.finish()); },
      chat: async ({ messages }) => {
        prompts.push(messages.at(-1)?.content ?? "");
        return { content: `Resumed response ${prompts.length}.`, usage: {} };
      },
    });

    expect(result.state).toBe("AwaitingReveal");
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("T9 — tasking question 1");
    expect(prompts[1]).toContain("T10 (Telepathic Summary)");
    expect(prompts.every((prompt) => !prompt.includes("Controller Step 1:"))).toBe(true);
    expect(transcript).toContain("What remains concealed?");
    expect(transcript).toContain("Telepathic Protocol — Step 9");
  });

  it("recognizes question, Step 9, and seal recovery boundaries", () => {
    const base = [{ id: "a", sessionId: "s", sequenceNumber: 1, eventType: "TELEPATHIC_QUESTIONS_AWAITING_OPERATOR", createdAt: "now" }] as SessionEventRecord[];
    expect(telepathicManualRecoveryState(base)).toBe("questions");
    expect(telepathicManualRecoveryState([...base, { id: "b", sessionId: "s", sequenceNumber: 2, eventType: "TELEPATHIC_QUESTIONS_COMPLETED", createdAt: "now" }])).toBe("step9");
    expect(telepathicManualRecoveryState([...base, { id: "b", sessionId: "s", sequenceNumber: 2, eventType: "VIEWER_RESPONSE", metadata: { step: 9 }, createdAt: "now" }])).toBe("seal");
    expect(telepathicManualRecoveryState([...base, { id: "b", sessionId: "s", sequenceNumber: 2, eventType: "PRE_REVEAL_SEALED", createdAt: "now" }])).toBeNull();
  });
});
