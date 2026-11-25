import { describe, expect, it } from "vitest";
import { sha256Text } from "../application/sha256";
import type { ProviderChatAttempt } from "../providers/requestExecutor";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import { createTelepathicSeriesState, runNextTelepathicAiRound, runTelepathicFinalReflections, revalidateTelepathicConfiguration } from "./engine";
import { createTelepathicAiTrainingSeries } from "./training";
import type { ResolvedTelepathicAiRoute } from "./providerGateway";
import { InMemoryTelepathicExchangeStore } from "./store";
import type { TelepathicParticipant, TelepathicSeriesConfig } from "./types";
import type { AppRepository } from "../storage/repository";
import type { Profile } from "../types";
import { BrowserTelepathicExchangeRepository } from "../storage/browser/telepathicExchangeRepository";
import { freezeTelepathicTrainingTargetCode, restoreTelepathicTrainingTargetCode } from "./trainingTargetCode";
import { telepathicExportDocument } from "./export";

async function ai(id: string): Promise<TelepathicParticipant> {
  const fg = `${id.toUpperCase()} FROZEN FIELD GUIDE`;
  const vn = `${id.toUpperCase()} FROZEN VIEWER NOTES`;
  return {
    id,
    kind: "ai",
    displayName: id.toUpperCase(),
    ai: {
      profileId: `profile-${id}`,
      profileName: id.toUpperCase(),
      workspaceId: `workspace-${id}`,
      aiIdentityId: `identity-${id}`,
      providerConfigId: `provider-${id}`,
      credentialId: `credential-${id}`,
      credentialFingerprint: `fingerprint-${id}`,
      modelId: `model-${id}`,
      route: `custom_openai:model-${id}`,
    },
    fieldGuide: { id: `fg-${id}`, version: "1", versionNumber: 1, content: fg, contentSha256: await sha256Text(fg), capturedAt: "2026-10-07T12:00:00.000Z", profileId: `profile-${id}`, aiIdentityId: `identity-${id}`, modelRoute: `custom_openai:model-${id}`, language: "en" },
    viewerNotes: { id: `vn-${id}`, version: "1", versionNumber: 1, content: vn, contentSha256: await sha256Text(vn), capturedAt: "2026-10-07T12:00:00.000Z", profileId: `profile-${id}`, aiIdentityId: `identity-${id}`, modelRoute: `custom_openai:model-${id}` },
  };
}

function model(id: string): ProviderModel {
  return {
    providerConfigId: `provider-${id}`,
    provider: "custom_openai",
    modelId: `model-${id}`,
    displayName: `${id} model`,
    route: `custom_openai:model-${id}`,
    capabilities: {
      contextTokens: 64_000,
      maxOutputTokens: 4096,
      inputModalities: ["text"],
      outputModalities: ["text"],
      supportsVision: false,
      supportsStreaming: false,
      reasoning: { supported: false, efforts: [], confidence: "unknown" },
      temperature: { supported: true, min: 0, max: 2, confidence: "provider_metadata" },
      supportedParameters: ["temperature"],
      source: "provider",
      capturedAt: "2026-10-07T12:00:00.000Z",
    },
    pricing: {},
    recommended: true,
    rawMetadata: {},
    refreshedAt: "2026-10-07T12:00:00.000Z",
  };
}

function provider(id: string): ProviderConfig {
  return {
    id: `provider-${id}`,
    provider: "custom_openai",
    label: id,
    credentialId: `credential-${id}`,
    credentialFingerprint: `fingerprint-${id}`,
    baseUrl: "https://example.test/v1",
    enabled: true,
    createdAt: "2026-10-07T12:00:00.000Z",
    updatedAt: "2026-10-07T12:00:00.000Z",
  };
}

describe("STEP 4A AI-AI telepathic training core", () => {
  it("rotates three AI Profiles, uses only each participant's frozen learning, and preserves fresh round contexts", async () => {
    const participants = await Promise.all([ai("leo"), ai("nemo"), ai("aura")]);
    const config: TelepathicSeriesConfig = {
      schemaVersion: 1,
      seriesId: "training-4a",
      seriesWorkspaceId: "workspace-leo",
      mode: "ai_ai_training",
      language: "en",
      participants,
      roundCount: 3,
      topic: "structure_or_object",
      discloseTopicToReceivers: false,
      senderPolicy: { kind: "rotate" },
    };
    const store = new InMemoryTelepathicExchangeStore();
    await store.saveTelepathicSeries(createTelepathicSeriesState(config, "2026-10-07T12:00:00.000Z"));
    let idCounter = 0;
    const captured: Array<{ modelId: string; text: string }> = [];
    const attempt: ProviderChatAttempt = async (request) => {
      const text = request.messages.map((message) => message.content).join("\n");
      captured.push({ modelId: request.modelId, text });
      let content = "reflection";
      if (text.includes("please prepare one specific target")) content = `TARGET-${request.modelId}`;
      else if (text.includes("confirm the transmission")) content = "READY";
      else if (text.includes("Please give your first description")) content = "first impression";
      else if (text.includes("After this step we will close your description")) content = "second impression";
      else if (text.includes("Reply YES or NO")) content = "NO";
      else if (text.includes("All rounds in this series are complete")) content = "final reflection";
      return { content, usage: {}, providerRequestId: `req-${captured.length}` };
    };
    const deps = {
      store,
      providerAttempt: attempt,
      createId: (prefix: string) => `${prefix}-${++idCounter}`,
      resolveRoute: async (item: TelepathicParticipant): Promise<ResolvedTelepathicAiRoute> => ({
        snapshot: structuredClone(item.ai!),
        providerConfig: provider(item.id),
        model: model(item.id),
        requestedSettings: { temperature: 0.9 },
        validatedIdentity: { profileId: item.ai!.profileId, workspaceId: item.ai!.workspaceId, aiIdentityId: item.ai!.aiIdentityId, credentialFingerprint: item.ai!.credentialFingerprint },
      }),
    };

    for (let round = 0; round < 3; round += 1) await runNextTelepathicAiRound(deps, config.seriesId);
    const completed = await store.getTelepathicSeries(config.seriesId);
    expect(completed?.status).toBe("completed");
    expect(completed?.rounds.map((round) => round.assignment.senderParticipantId)).toEqual(["leo", "nemo", "aura"]);

    for (const id of ["leo", "nemo", "aura"]) {
      const ownCalls = captured.filter((call) => call.modelId === `model-${id}`);
      expect(ownCalls.length).toBeGreaterThan(0);
      for (const call of ownCalls) {
        expect(call.text).toContain(`${id.toUpperCase()} FROZEN FIELD GUIDE`);
        expect(call.text).toContain(`${id.toUpperCase()} FROZEN VIEWER NOTES`);
        for (const other of ["leo", "nemo", "aura"].filter((candidate) => candidate !== id)) {
          expect(call.text).not.toContain(`${other.toUpperCase()} FROZEN FIELD GUIDE`);
          expect(call.text).not.toContain(`${other.toUpperCase()} FROZEN VIEWER NOTES`);
        }
      }
    }

    const roundTwoReceiverCall = captured.find((call) => call.text.includes("Please give your first description") && call.text.includes("round 2"));
    expect(roundTwoReceiverCall?.text).not.toContain("TARGET-model-leo");
    expect(roundTwoReceiverCall?.text).not.toContain("structure or object");

    const withFinal = await runTelepathicFinalReflections(deps, config.seriesId);
    expect(Object.keys(withFinal.finalReflections).sort()).toEqual(["aura", "leo", "nemo"]);
    const finalLeo = [...captured].reverse().find((call) => call.modelId === "model-leo" && call.text.includes("All rounds in this series are complete"));
    expect(finalLeo?.text).toContain("LEO FROZEN FIELD GUIDE");
  });

  it("freezes learning through create -> save -> get and Resume keeps the frozen content after active learning changes", async () => {
    const participants = [await ai("leo"), await ai("nemo")].map((item) => ({ ...item, fieldGuide: undefined, viewerNotes: undefined }));
    const config: TelepathicSeriesConfig = {
      schemaVersion: 1,
      seriesId: "training-4a-freeze-resume",
      seriesWorkspaceId: "workspace-leo",
      mode: "ai_ai_training",
      language: "en",
      participants,
      roundCount: 1,
      topic: "any",
      discloseTopicToReceivers: false,
      senderPolicy: { kind: "rotate" },
    };
    const store = new InMemoryTelepathicExchangeStore();
    const activeLearning: Record<string, { fg: string; vn: string }> = {
      leo: { fg: "LEO ORIGINAL FIELD GUIDE", vn: "LEO ORIGINAL VIEWER NOTES" },
      nemo: { fg: "NEMO ORIGINAL FIELD GUIDE", vn: "NEMO ORIGINAL VIEWER NOTES" },
    };
    const repository = {
      listProfiles: async () => participants.map(item => ({ id: item.ai!.profileId, targetCodeMode: "without_code" })),
      getExistingFieldGuideBundle: async (identityId: string, language: "pl" | "en") => {
        const id = identityId.replace("identity-", "");
        const content = activeLearning[id].fg;
        return {
          identityId,
          language,
          activeVersion: {
            id: `fg-${id}-active`, aiIdentityId: identityId, language, versionNumber: 1, content,
            contentSha256: await sha256Text(content), estimatedTokens: 10,
          },
        };
      },
      getExistingViewerNoteBundle: async (identityId: string) => {
        const id = identityId.replace("identity-", "");
        const content = activeLearning[id].vn;
        return {
          activeVersion: {
            id: `vn-${id}-active`, aiIdentityId: identityId, versionNumber: 1, content,
            contentSha256: await sha256Text(content), estimatedTokens: 10,
          },
        };
      },
      getTelepathicSeries: (seriesId: string) => store.getTelepathicSeries(seriesId),
      saveTelepathicSeries: (state: any) => store.saveTelepathicSeries(state),
      withTelepathicSeriesLease: <T>(seriesId: string, task: () => Promise<T>) => store.withTelepathicSeriesLease(seriesId, task),
      assertTelepathicSeriesLease: (seriesId: string) => store.assertTelepathicSeriesLease(seriesId),
      telepathicSeriesLeaseSignal: (seriesId: string) => store.telepathicSeriesLeaseSignal(seriesId),
    } as unknown as import("../storage/repository").AppRepository;

    await createTelepathicAiTrainingSeries({ repository, config, now: () => "2026-10-07T12:00:00.000Z" });
    const persisted = await repository.getTelepathicSeries(config.seriesId);
    expect(persisted?.config.participants.find((item) => item.id === "leo")?.fieldGuide?.content).toBe("LEO ORIGINAL FIELD GUIDE");

    activeLearning.leo = { fg: "LEO NEW ACTIVE FIELD GUIDE", vn: "LEO NEW ACTIVE VIEWER NOTES" };
    activeLearning.nemo = { fg: "NEMO NEW ACTIVE FIELD GUIDE", vn: "NEMO NEW ACTIVE VIEWER NOTES" };

    const captured: string[] = [];
    let idCounter = 0;
    const attempt: ProviderChatAttempt = async (request) => {
      const body = request.messages.map((message) => message.content).join("\n");
      captured.push(body);
      let content = "reflection";
      if (body.includes("please prepare one specific target")) content = "TARGET-FROZEN-LEARNING";
      else if (body.includes("confirm the transmission")) content = "READY";
      else if (body.includes("Please give your first description")) content = "first impression";
      else if (body.includes("After this step we will close your description")) content = "second impression";
      else if (body.includes("Reply YES or NO")) content = "NO";
      return { content, usage: {}, providerRequestId: `resume-${captured.length}` };
    };
    const deps = {
      store: repository,
      providerAttempt: attempt,
      createId: (prefix: string) => `${prefix}-${++idCounter}`,
      resolveRoute: async (item: TelepathicParticipant): Promise<ResolvedTelepathicAiRoute> => ({
        snapshot: structuredClone(item.ai!),
        providerConfig: provider(item.id),
        model: model(item.id),
        requestedSettings: { temperature: 0.9 },
        validatedIdentity: { profileId: item.ai!.profileId, workspaceId: item.ai!.workspaceId, aiIdentityId: item.ai!.aiIdentityId, credentialFingerprint: item.ai!.credentialFingerprint },
      }),
    };

    await runNextTelepathicAiRound(deps, config.seriesId);
    const all = captured.join("\n");
    expect(all).toContain("LEO ORIGINAL FIELD GUIDE");
    expect(all).toContain("NEMO ORIGINAL FIELD GUIDE");
    expect(all).not.toContain("LEO NEW ACTIVE FIELD GUIDE");
    expect(all).not.toContain("NEMO NEW ACTIVE FIELD GUIDE");
  });

});

class TrainingCodeMemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

async function codeTrainingFixture(language: "pl" | "en", protectedId: "leo" | "nemo", rounds = 2) {
  const config: TelepathicSeriesConfig = {
    schemaVersion: 1, protocolVersion: "fixed_lead_v1", leadInstructionVersion: "fixed_lead_guidance_v2", maxGuidanceCycles: 3,
    seriesId: `training-code-${language}-${protectedId}`, seriesWorkspaceId: "workspace-leo", mode: "ai_ai_training",
    language, participants: [await ai("leo"), await ai("nemo")], roundCount: rounds, topic: "location", discloseTopicToReceivers: false,
    senderPolicy: { kind: "fixed_ai", participantId: "leo" },
  };
  const profiles: Profile[] = config.participants.map(item => ({ id: item.ai!.profileId, name: item.displayName, createdAt: "t", updatedAt: "t", ...(item.id === protectedId ? { targetCodeMode: "without_code" as const } : {}) }));
  const storage = new TrainingCodeMemoryStorage();
  let guide: string | undefined;
  let profileReads = 0;
  function reopen() {
    return Object.assign(new BrowserTelepathicExchangeRepository({ storage }), {
      listProfiles: async () => { profileReads++; return structuredClone(profiles); },
      getExistingFieldGuideBundle: async (identityId: string) => guide && identityId === `identity-${protectedId}` ? {
        activeVersion: { id: "fg", aiIdentityId: identityId, language, versionNumber: 1, content: guide, contentSha256: await sha256Text(guide) },
      } : null,
      getExistingViewerNoteBundle: async () => null,
    }) as unknown as AppRepository;
  }
  const requests: Array<{ id: string; text: string }> = [];
  function deps(repository: AppRepository, stop?: AbortController, leakInstruction?: string) {
    const attempt: ProviderChatAttempt = async request => {
      const text = request.messages.map(m => m.content).join("\n");
      requests.push({ id: request.modelId, text });
      let content = "Detailed observation and reflection.";
      if (/please prepare one specific target|przygotuj teraz jeden konkretny cel/.test(text)) content = "A large sandstone arch above a river.";
      else if (text.includes("CONTRACT:")) {
        const cycle = Number(text.match(/CONTRACT: \{"cycle":(\d+)/)?.[1]);
        content = JSON.stringify({ cycle, finishRound: cycle > 1, finishParticipantIds: [], individual: cycle === 1 ? [{ participantId: "nemo", instruction: leakInstruction ?? "Describe motion only." }] : [] });
      } else if (/Reply YES or NO|Odpowiedz TAK albo NIE/.test(text)) content = language === "pl" ? "TAK" : "YES";
      if (stop && text.includes("LEAD_INSTRUCTION:")) stop.abort(new DOMException("Stop", "AbortError"));
      return { content, finishReason: "stop", usage: {} };
    };
    return { store: repository, providerAttempt: attempt, signal: stop?.signal,
      resolveRoute: async (item: TelepathicParticipant): Promise<ResolvedTelepathicAiRoute> => ({
        snapshot: structuredClone(item.ai!), providerConfig: provider(item.id), model: { ...model(item.id), capabilities: { ...model(item.id).capabilities, maxOutputTokens: 32768 } },
        requestedSettings: { temperature: 0.9 }, validatedIdentity: { profileId: item.ai!.profileId, workspaceId: item.ai!.workspaceId, aiIdentityId: item.ai!.aiIdentityId, credentialFingerprint: item.ai!.credentialFingerprint },
      }),
    };
  }
  return { config, profiles, reopen, requests, deps, setGuide: (value: string) => { guide = value; }, profileReads: () => profileReads };
}

describe("CODE-5B frozen profile modes and model-bound round ID protection", () => {
  for (const language of ["pl", "en"] as const) for (const protectedId of ["leo", "nemo"] as const) {
    it(`${language}/${protectedId}: two real rounds, reload, profile drift, final reflection and local export`, async () => {
      const f = await codeTrainingFixture(language, protectedId);
      const initialRepository = f.reopen();
      const state = await createTelepathicAiTrainingSeries({ repository: initialRepository, config: f.config });
      const frozen = state.config.trainingTargetCodePolicy!;
      expect(frozen.participants.map(p => p.mode)).toEqual(protectedId === "leo" ? ["without_code", "with_code"] : ["with_code", "without_code"]);
      const first = await runNextTelepathicAiRound(f.deps(initialRepository), f.config.seriesId);
      expect(first.currentRoundIndex).toBe(1);
      // Actual Browser repository, reopened over the same persisted JSON.
      f.profiles.forEach(p => { p.targetCodeMode = p.targetCodeMode === "without_code" ? "with_code" : "without_code"; });
      const reopened = f.reopen();
      const complete = await runNextTelepathicAiRound(f.deps(reopened), f.config.seriesId);
      expect(complete.finalization).toBe("completed");
      expect(complete.config.trainingTargetCodePolicy).toEqual(frozen);
      expect(f.profileReads()).toBe(1);
      const local = (await reopened.getTelepathicSeries(f.config.seriesId))!;
      expect(local.config.trainingTargetCodePolicy).toEqual(frozen);
      for (const round of local.rounds) {
        expect(round.target?.roundId).toBe(round.assignment.roundId);
        for (const req of f.requests.filter(r => r.id === `model-${protectedId}`)) expect(req.text).not.toContain(round.assignment.roundId);
      }
      const finalLead = f.requests.find(r => r.id === "model-leo" && /All rounds in this series are complete|Wszystkie rundy serii zostały zakończone/.test(r.text))!;
      expect(finalLead.text).toContain("A large sandstone arch above a river.");
      if (protectedId === "leo") expect(finalLead.text).not.toContain('"roundId"');
      else expect(finalLead.text).toContain(local.rounds[0].assignment.roundId);
      expect(telepathicExportDocument(local)).toContain(language === "pl" ? "bez kodu (ochrona ID rund)" : "without code (round ID guard)");
    });
  }
  it("STOP during protected guidance and resume on reopened Browser repository without repeating the completed call", async () => {
    const f = await codeTrainingFixture("en", "nemo", 1);
    const repository = f.reopen();
    await createTelepathicAiTrainingSeries({ repository, config: f.config });
    const stop = new AbortController();
    await expect(runNextTelepathicAiRound(f.deps(repository, stop), f.config.seriesId)).rejects.toThrow();
    const checkpoint = (await repository.getTelepathicSeries(f.config.seriesId))!;
    expect(checkpoint.status).toBe("paused");
    expect(checkpoint.providerCalls.filter(c => c.callStage.startsWith("receiver_guidance:") && c.status === "succeeded")).toHaveLength(1);
    f.profiles[1].targetCodeMode = "with_code";
    const completed = await runNextTelepathicAiRound(f.deps(f.reopen()), f.config.seriesId);
    expect(completed.finalization).toBe("completed");
    expect(f.requests.filter(r => r.text.includes("LEAD_INSTRUCTION:") && r.id === "model-nemo")).toHaveLength(1);
    expect(completed.config.trainingTargetCodePolicy).toEqual(checkpoint.config.trainingTargetCodePolicy);
    expect(f.profileReads()).toBe(1);
  });
  for (const protectedId of ["leo", "nemo"] as const) it(`rejects a round ID from ${protectedId}'s frozen learning before that participant's dispatch`, async () => {
    const f = await codeTrainingFixture("en", protectedId, 1);
    f.setGuide(`Accidental technical reference ${f.config.seriesId}:round:1`);
    const repository = f.reopen();
    await createTelepathicAiTrainingSeries({ repository, config: f.config });
    await expect(runNextTelepathicAiRound(f.deps(repository), f.config.seriesId)).rejects.toThrow(/Target-code policy/);
    expect(f.requests.filter(r => r.id === `model-${protectedId}`)).toHaveLength(0);
    const before = f.requests.length;
    const blocked = await revalidateTelepathicConfiguration(f.deps(f.reopen()), f.config.seriesId);
    expect(blocked.recoveryBlock?.message).toContain("Target-code policy");
    expect(f.requests.length).toBe(before);
  });
  it("rejects a known round ID in lead-generated guidance before the protected receiver sees it", async () => {
    const f = await codeTrainingFixture("en", "nemo", 1);
    const repository = f.reopen();
    await createTelepathicAiTrainingSeries({ repository, config: f.config });
    await expect(runNextTelepathicAiRound(f.deps(repository, undefined, `${f.config.seriesId}:round:1`), f.config.seriesId)).rejects.toThrow(/Target-code policy/);
    expect(f.requests.filter(r => r.id === "model-nemo" && r.text.includes("LEAD_INSTRUCTION:"))).toHaveLength(0);
    expect((await repository.getTelepathicSeries(f.config.seriesId))?.rounds[0].revealedAt).toBe(undefined);
  });
  it("does not dispatch on a corrupted frozen policy after reopen", async () => {
    const f = await codeTrainingFixture("en", "leo", 1);
    const repository = f.reopen();
    const state = await createTelepathicAiTrainingSeries({ repository, config: f.config });
    state.config.trainingTargetCodePolicy!.participants[0].mode = "with_code";
    await repository.saveTelepathicSeries(state);
    await expect(runNextTelepathicAiRound(f.deps(f.reopen()), f.config.seriesId)).rejects.toThrow(/Invalid frozen/);
    expect(f.requests).toHaveLength(0);
  });
  it("rejects missing, archived and invalid profile preferences before save", async () => {
    const f = await codeTrainingFixture("en", "leo", 1);
    await expect(freezeTelepathicTrainingTargetCode(f.config, [f.profiles[0]])).rejects.toThrow(/active Profile/);
    await expect(freezeTelepathicTrainingTargetCode(f.config, [{ ...f.profiles[0], archivedAt: "t" }, f.profiles[1]])).rejects.toThrow(/active Profile/);
    await expect(freezeTelepathicTrainingTargetCode(f.config, [{ ...f.profiles[0], targetCodeMode: "invalid" as never }, f.profiles[1]])).rejects.toThrow();
    expect((await f.reopen().listTelepathicSeries())).toHaveLength(0);
  });
  it("rejects sender/receiver role drift in either durable plan copy", async () => {
    const f = await codeTrainingFixture("en", "leo", 2);
    const frozen = createTelepathicSeriesState(await freezeTelepathicTrainingTargetCode(f.config, f.profiles));
    const corruptions: Array<(state: typeof frozen) => void> = [
      state => { state.rounds[0].assignment.senderParticipantId = state.rounds[0].assignment.receiverParticipantIds[0]; },
      state => { state.plan.rounds[0].senderParticipantId = state.plan.rounds[0].receiverParticipantIds[0]; },
      state => { state.rounds[0].assignment.receiverParticipantIds = [state.rounds[0].assignment.senderParticipantId]; },
      state => { state.plan.rounds[0].receiverParticipantIds = [state.plan.rounds[0].senderParticipantId]; },
    ];
    for (const corrupt of corruptions) {
      const bad = structuredClone(frozen); corrupt(bad);
      await expect(restoreTelepathicTrainingTargetCode(bad)).rejects.toThrow(/Invalid frozen/);
    }
  });
  it("rejects duplicated, unknown and mutually-consistent-but-wrong round roles", async () => {
    const f = await codeTrainingFixture("en", "leo", 2);
    const frozen = createTelepathicSeriesState(await freezeTelepathicTrainingTargetCode(f.config, f.profiles));
    const duplicated = structuredClone(frozen);
    duplicated.plan.rounds[0].receiverParticipantIds = [duplicated.plan.rounds[0].receiverParticipantIds[0], duplicated.plan.rounds[0].receiverParticipantIds[0]];
    duplicated.rounds[0].assignment.receiverParticipantIds = [...duplicated.plan.rounds[0].receiverParticipantIds];
    await expect(restoreTelepathicTrainingTargetCode(duplicated)).rejects.toThrow(/Invalid frozen/);
    const unknown = structuredClone(frozen);
    unknown.plan.rounds[0].receiverParticipantIds = ["unknown"];
    unknown.rounds[0].assignment.receiverParticipantIds = ["unknown"];
    await expect(restoreTelepathicTrainingTargetCode(unknown)).rejects.toThrow(/Invalid frozen/);
    const swapped = structuredClone(frozen);
    const expectedReceiver = swapped.plan.rounds[0].receiverParticipantIds[0];
    swapped.plan.rounds[0].senderParticipantId = expectedReceiver;
    swapped.rounds[0].assignment.senderParticipantId = expectedReceiver;
    swapped.plan.rounds[0].receiverParticipantIds = [frozen.plan.rounds[0].senderParticipantId];
    swapped.rounds[0].assignment.receiverParticipantIds = [frozen.plan.rounds[0].senderParticipantId];
    await expect(restoreTelepathicTrainingTargetCode(swapped)).rejects.toThrow(/Invalid frozen/);
  });
  it("validates all saved identity and mode fields; legacy remains compatible", async () => {
    const f = await codeTrainingFixture("en", "leo", 1);
    const initial = createTelepathicSeriesState(await freezeTelepathicTrainingTargetCode(f.config, f.profiles));
    expect(await restoreTelepathicTrainingTargetCode(initial)).toEqual(initial.config.trainingTargetCodePolicy);
    const changes: Array<(state: typeof initial) => void> = [
      s => { s.config.trainingTargetCodePolicy = null as never; },
      s => { s.config.trainingTargetCodePolicy!.version = "bad" as never; },
      s => { s.config.trainingTargetCodePolicy!.exposure = "bad" as never; },
      s => { s.config.trainingTargetCodePolicy!.policySha256 = "0".repeat(64); },
      s => { s.config.trainingTargetCodePolicy!.participants[0].mode = "invalid" as never; },
      s => { s.config.trainingTargetCodePolicy!.participants[0].profileId = "other"; },
      s => { s.config.trainingTargetCodePolicy!.participants.reverse(); },
      s => { s.config.trainingTargetCodePolicy!.participants.pop(); },
      s => { s.config.mode = "conversation_exchange"; },
      s => { s.plan.rounds[0].roundId = "other"; },
      s => { s.rounds[0].assignment = { ...s.rounds[0].assignment, roundId: "other" }; },
      s => { s.config.seriesId = "other"; },
    ];
    for (const change of changes) {
      const bad = structuredClone(initial); change(bad);
      await expect(restoreTelepathicTrainingTargetCode(bad)).rejects.toThrow(/Invalid frozen/);
    }
    const legacy = createTelepathicSeriesState(f.config);
    expect(await restoreTelepathicTrainingTargetCode(legacy)).toBe(undefined);
  });
});
