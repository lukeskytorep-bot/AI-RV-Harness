import { expect, it, vi } from "vitest";
import {
  buildLeadDecisionPacket, guidanceInstructions, individualLeadCommand, leadGuidanceVersion,
  LEAD_INSTRUCTION_VERSION, LEGACY_LEAD_INSTRUCTION_VERSION, validateLeadDecision,
} from "./leadGuidance";
import { leadDecisionErrorMessage, parseLeadDecisionResponse } from "./leadDecisionResponse";
import {
  advanceTelepathicConversationSeries, createTelepathicSeriesState, runNextTelepathicAiRound,
  saveHumanGuidanceResponse, saveHumanTelepathicFirstBlind, saveHumanTelepathicReflection,
  saveHumanTelepathicSharing, telepathicConversationHumanStep, resumeBlockedTelepathicSeries,
} from "./engine";
import { legacyLeadState } from "./__fixtures__/legacyLeadState";
import { displayFixture } from "./__fixtures__/readableRuns";
import { InMemoryTelepathicExchangeStore } from "./store";
import { buildTelepathicConversationView } from "./conversationView";
import { withReadableInstruction } from "./displayProjection";
import type { LeadGuidanceDecision, TelepathicMode } from "./types";
import type { ProviderChatAttempt } from "../providers/requestExecutor";

const ids = ["ai:viewer-001", "ai:viewer-002", "ai:viewer-003"];
const question = (participantId: string, instruction = "Describe new movement.") => ({ participantId, instruction });
const decision = (recipients = ids): LeadGuidanceDecision => ({ cycle: 1, finishRound: false, finishParticipantIds: [], individual: recipients.map(id => question(id)) });
const roundDecision = (recipients: string[], roundNumber: number) => ({ ...decision(recipients), individual: recipients.map(id => question(id, roundNumber === 1 ? "Describe new movement." : `Describe new movement for ${id}.`)) });
const finish = (cycle: 1|2|3): LeadGuidanceDecision => ({ cycle, finishRound: true, finishParticipantIds: [], individual: [] });
const validate = (raw: unknown, active = ids) => validateLeadDecision(raw, 1, active, ["SECRET_FROZEN_SUBJECT"], LEAD_INSTRUCTION_VERSION);

async function fixture(language: "pl"|"en" = "en", mode: TelepathicMode = "ai_ai_training", count = 3, roundCount = 2) {
  const legacy = await displayFixture(language);
  const viewers = ids.slice(0, count).map(id => ({ ...structuredClone(legacy.participant), id,
    ai: { ...legacy.participant.ai!, profileId: id, workspaceId: id, aiIdentityId: id },
    fieldGuide: undefined, viewerNotes: undefined }));
  const input = { ...legacy.state.config, seriesId: "individual", mode, roundCount,
    outputBudgetPolicyVersion: 3 as const, participants: [legacy.state.config.participants[0], ...viewers] };
  const state = createTelepathicSeriesState(input, "2026-10-16T00:00:00.000Z");
  const store = new InMemoryTelepathicExchangeStore();
  await store.saveTelepathicSeries(state);
  const deps = { store, resolveRoute: async (p: typeof viewers[number]) => ({ ...legacy.route, snapshot: p.ai!,
    validatedIdentity: { profileId: p.ai!.profileId, workspaceId: p.ai!.workspaceId, aiIdentityId: p.ai!.aiIdentityId, credentialFingerprint: p.ai!.credentialFingerprint } }) };
  const run = mode === "ai_ai_training" ? runNextTelepathicAiRound : advanceTelepathicConversationSeries;
  const execute = (providerAttempt: ProviderChatAttempt, signal?: AbortSignal) => run({ ...deps, providerAttempt, signal }, state.config.seriesId);
  const answer: ProviderChatAttempt = async request => {
    const checkpoint = (await store.getTelepathicSeries(state.config.seriesId))!;
    const call = checkpoint.providerCalls.at(-1)!;
    const text = call.callStage === "sender_target" ? "SECRET_FROZEN_SUBJECT"
      : call.callStage === "sender_transmission_confirmation" ? "READY"
      : call.callStage === "sharing_consent" ? "NO"
      : call.callStage.startsWith("lead_guidance:") ? (() => {
        const cycle = Number(call.callStage.split(":").at(-1)) as 1|2|3;
        const active = JSON.parse(request.messages.at(-1)!.content.split("CURRENT_ROUND_DATA:\n")[1]).activeIds as string[];
        return JSON.stringify(cycle === 1 ? roundDecision(active, checkpoint.rounds[checkpoint.currentRoundIndex].assignment.roundNumber) : finish(cycle));
      })()
      : `Private perception of ${call.participantId}`;
    if (call.callStage === "receiver_first" || call.callStage.startsWith("receiver_guidance:")) {
      expect(JSON.stringify(request.messages)).not.toContain("SECRET_FROZEN_SUBJECT");
      for (const other of checkpoint.rounds[0].assignment.receiverParticipantIds.filter(id => id !== call.participantId)) {
        expect(JSON.stringify(request.messages)).not.toContain(`Private perception of ${other}`);
      }
    }
    return { content: text, finishReason: "stop", usage: { totalTokens: 12, costUsd: 0.01 } };
  };
  return { input, state, store, deps, execute, answer };
}

for (const language of ["pl", "en"] as const) for (const mode of ["ai_ai_training", "conversation_exchange"] as const) for (const count of [1, 3]) {
  it(`S1 ${language}/${mode}/${count}: new series replaces stale creation defaults; prompt/schema/example match actual IDs`, async () => {
    const f = await fixture(language, mode, count);
    expect(f.input.leadInstructionVersion).toBe(LEGACY_LEAD_INSTRUCTION_VERSION);
    expect(f.state.config.leadInstructionVersion).toBe(LEAD_INSTRUCTION_VERSION);
    expect(f.state.config.leadInstruction).toContain(individualLeadCommand(language));
    const packet = buildLeadDecisionPacket(f.state, f.state.rounds[0], 1);
    expect(packet.display?.instruction).toBe(individualLeadCommand(language));
    const [command, contract, example] = packet.messages.at(-1)!.content.split("\n");
    expect(command).toBe(individualLeadCommand(language));
    expect(contract).not.toContain('"broadcast"');
    expect(JSON.parse(example.slice("EXAMPLE: ".length))).toEqual({
      ...decision(ids.slice(0, count)), individual: ids.slice(0, count).map(id => question(id, language === "pl" ? "Opisz tylko nowe percepcje." : "Describe only new perceptions.")),
    });
    expect(packet.messages.at(-1)!.content).not.toMatch(/viewer_A|viewer_B/);
  });
  it(`S1 ${language}/${mode}/${count}: two full rounds dispatch one exact instruction per Viewer and preserve raw decisions`, async () => {
    const f = await fixture(language, mode, count);
    let result = await f.execute(f.answer);
    if (result.status !== "completed") result = await f.execute(f.answer);
    expect(result.finalization).toBe("completed");
    for (const round of result.rounds) {
      expect(round.revealedAt).toBeTruthy();
      expect(round.guidance!.decisions).toEqual([roundDecision(ids.slice(0, count), round.assignment.roundNumber), finish(2)]);
      for (const id of ids.slice(0, count)) {
        const instruction = round.assignment.roundNumber === 1 ? "Describe new movement." : `Describe new movement for ${id}.`;
        expect(round.blindByParticipant[id].guidanceResponses).toEqual([{ cycle: 1, instruction, response: `Private perception of ${id}` }]);
        const events = result.transcript!.filter(e => e.roundId === round.assignment.roundId && e.kind === "instruction" && e.stage === "receiver_guidance" && e.recipientIds.includes(id));
        expect(events).toHaveLength(1);
        expect(events[0].recipientIds).toEqual([id]);
        expect(events[0].text).toBe(instruction);
      }
    }
    const calls = result.providerCalls.filter(c => c.callStage.startsWith("lead_guidance:"));
    expect(calls).toHaveLength(4);
    expect(calls.every(c => c.status === "succeeded" && c.technicalAttempt === 1 && c.requestSha256 && c.responseText)).toBe(true);
    for (const call of calls) {
      const event = structuredClone(result.transcript!.find(e => e.kind === "materials" && e.providerCallId === call.id)!);
      delete event.display;
      expect(withReadableInstruction(result, event).display?.instruction).toBe(individualLeadCommand(language));
    }
  });
}

it("S1 accepts different questions, identical separate questions, a selected finish, or a whole-round finish without coercion", () => {
  for (const value of [decision(), { ...decision(), individual: ids.map((id, i) => question(id, `Describe perception ${i}.`)) },
    { ...decision(), finishParticipantIds: [ids[0]], individual: ids.slice(1).map(id => question(id)) }, finish(1),
    { ...decision(), finishParticipantIds: ids, individual: [] }]) {
    expect(validate(value)).toEqual(value);
    expect(validate(value)).not.toBe(value);
  }
  const boundary = { ...decision([ids[0]]), individual: [question(ids[0], "x".repeat(4000))] };
  expect(validate(boundary, [ids[0]])).toEqual(boundary);
});

const invalid: Array<[string, unknown]> = [
  ["broadcast", { ...decision(), broadcast: { recipientIds: ids, instruction: "Describe movement" } }],
  ["null broadcast", { ...decision(), broadcast: null }],
  ["extra key", { ...decision(), shared: "Describe" }],
  ["missing list", { cycle: 1, finishRound: true, finishParticipantIds: [] }],
  ["null list", { ...finish(1), individual: null }],
  ["missing active Viewer", decision([ids[0]])],
  ["unknown Viewer", decision([...ids, "stranger"])],
  ["duplicate Viewer", decision([...ids, ids[0]])],
  ["finished Viewer", { ...decision(), finishParticipantIds: [ids[0]] }],
  ["duplicate finish", { ...finish(1), finishParticipantIds: [ids[0], ids[0]] }],
  ["unknown finish", { ...finish(1), finishParticipantIds: ["stranger"] }],
  ["blank instruction", { ...decision(), individual: ids.map(id => question(id, " \n\t")) }],
  ["long instruction", { ...decision(), individual: ids.map(id => question(id, "x".repeat(4001))) }],
  ["target leak", { ...decision(), individual: ids.map(id => question(id, "Describe SECRET_FROZEN_SUBJECT")) }],
  ["finish with questions", { ...decision(), finishRound: true }],
  ["nested extra key", { ...decision(), individual: ids.map(id => ({ ...question(id), broadcast: "hidden" })) }],
  ["non-object entry", { ...decision(), individual: [false] }],
  ["wrong cycle", { ...decision(), cycle: 2 }],
];
for (const [name, value] of invalid) it(`S1 rejects ${name} without filtering, converting or merging`, () => {
  const original = JSON.stringify(value);
  expect(() => validate(value)).toThrow();
  expect(JSON.stringify(value)).toBe(original);
});

it("S1 plain/fenced JSON has identical semantics; contract errors differ from JSON syntax errors in both languages", async () => {
  const f = await fixture();
  const round = f.state.rounds[0];
  for (const text of [JSON.stringify(decision()), `\n\uFEFF\x60\x60\x60JSON\n${JSON.stringify(decision())}\n\x60\x60\x60\n`]) {
    expect(parseLeadDecisionResponse(text, round, 1, LEAD_INSTRUCTION_VERSION)).toEqual(decision());
  }
  for (const [text, code] of [["not JSON", "invalid_json"], [JSON.stringify(invalid[0][1]), "unknown_field"], [JSON.stringify(decision([ids[0]])), "missing_receiver"]]) {
    let error = "";
    try { parseLeadDecisionResponse(text, round, 1, LEAD_INSTRUCTION_VERSION); } catch (cause) { error = (cause as Error).message; }
    expect(error).toContain(`[${code}]`);
    for (const pl of [true, false]) expect(leadDecisionErrorMessage(error, pl)).toContain(code === "invalid_json" ? pl ? "odczytać" : "Could not read" : pl ? "kontraktu" : "violates the contract");
  }
});

for (const mode of ["ai_ai_training", "conversation_exchange"] as const) for (const cut of ["lead_guidance:cycle:1", `receiver_guidance:cycle:1:recipient:${ids[0]}`]) {
  it(`S1 ${mode}: durable ${cut} replays after Stop/restart with unchanged evidence and no repeated paid scope`, async () => {
    const f = await fixture("en", mode, 3, 1);
    const stop = new AbortController();
    await expect(f.execute(async request => {
      const result = await f.answer(request);
      const call = (await f.store.getTelepathicSeries("individual"))!.providerCalls.at(-1)!;
      if (call.callStage === cut) stop.abort();
      return result;
    }, stop.signal)).rejects.toThrow();
    const checkpoint = (await f.store.getTelepathicSeries("individual"))!;
    const accepted = structuredClone(checkpoint.providerCalls);
    const restart = new InMemoryTelepathicExchangeStore();
    await restart.saveTelepathicSeries(JSON.parse(JSON.stringify(checkpoint)));
    const run = mode === "ai_ai_training" ? runNextTelepathicAiRound : advanceTelepathicConversationSeries;
    const paid = vi.fn<ProviderChatAttempt>(async () => ({ content: JSON.stringify(finish(2)), finishReason: "stop", usage: {} }));
    // Retain normal deterministic responses, recording exactly which persisted scopes are dispatched.
    const dispatched: string[] = [];
    const attempt: ProviderChatAttempt = async request => {
      const call = (await restart.getTelepathicSeries("individual"))!.providerCalls.at(-1)!;
      dispatched.push(call.scopeKey);
      if (call.callStage.startsWith("lead_guidance:")) return paid(request);
      return { content: call.callStage === "sharing_consent" ? "NO" : "new private response", finishReason: "stop", usage: {} };
    };
    const result = await run({ ...f.deps, store: restart, providerAttempt: attempt }, "individual");
    expect(result.finalization).toBe("completed");
    expect(result.providerCalls.slice(0, accepted.length)).toEqual(accepted);
    expect(dispatched.some(key => accepted.some(c => c.scopeKey === key))).toBe(false);
    expect(new Set(result.providerCalls.map(c => c.scopeKey)).size).toBe(result.providerCalls.length);
  });
}

it("S1 persisted v2 decision applies its finish once and restart still delivers the remaining recipient", async () => {
  const f = await fixture();
  const round = f.state.rounds[0];
  round.blindByParticipant = Object.fromEntries(ids.map(id => [id, { participantId: id, first: "own", status: "first_complete" as const, providerAttemptCount: 1 }]));
  round.guidance = { decisions: [{ ...decision(ids.slice(1)), finishParticipantIds: [ids[0]] }], finishedParticipantIds: [ids[0]], closed: false };
  const { ensureFixedLeadGuidance } = await import("./fixedLeadRuntime");
  const invoked: string[] = [];
  await ensureFixedLeadGuidance(f.state, round, { invoke: async (_, packet) => {
    invoked.push(packet.scope.callStage);
    return packet.scope.callStage.startsWith("lead_guidance:") ? JSON.stringify(finish(2)) : "own new response";
  }, save: async () => {}, now: () => "t", checkStop: () => {} });
  expect(round.guidance.finishedParticipantIds).toEqual([ids[0]]);
  expect(invoked.filter(s => s.startsWith("receiver_guidance:"))).toEqual(ids.slice(1).map(id => `receiver_guidance:cycle:1:recipient:${id}`));
  expect(round.guidance.closed).toBe(true);
});

it("S1 human Viewer receives only the addressed individual question and can finish the Conversation", async () => {
  const f = await fixture("en", "conversation_exchange", 1);
  const human = { id: "human", kind: "human" as const, displayName: "Human" };
  const state = createTelepathicSeriesState({ ...f.state.config, roundCount: 1, participants: [...f.state.config.participants, human] });
  await f.store.saveTelepathicSeries(state);
  const deps = { ...f.deps, providerAttempt: f.answer };
  let result = await f.execute(f.answer);
  expect(telepathicConversationHumanStep(result).kind).toBe("blind_first");
  await saveHumanTelepathicFirstBlind(deps, "individual", "own human blind");
  result = await f.execute(f.answer);
  expect(telepathicConversationHumanStep(result)).toMatchObject({ kind: "receiver_guidance", cycle: 1, instruction: "Describe new movement." });
  expect(JSON.stringify(buildTelepathicConversationView(result))).not.toContain("SECRET_FROZEN_SUBJECT");
  await saveHumanGuidanceResponse(deps, "individual", "own new human perception");
  result = await f.execute(f.answer);
  await saveHumanTelepathicReflection(deps, "individual", "own reflection");
  result = await f.execute(f.answer);
  await saveHumanTelepathicSharing(deps, "individual", "no");
  result = await f.execute(f.answer);
  expect(result.finalization).toBe("completed");
  expect(result.providerCalls.every(c => c.participantId !== human.id)).toBe(true);
  expect(result.rounds[0].blindByParticipant.human.guidanceResponses).toEqual([{ cycle: 1, instruction: "Describe new movement.", response: "own new human perception" }]);
});

it("S1 unknown frozen versions fail closed; new construction cannot inherit them", async () => {
  const f = await fixture();
  f.state.config.leadInstructionVersion = "future_unknown";
  expect(() => leadGuidanceVersion(f.state)).toThrow("Unsupported frozen");
  expect(() => buildLeadDecisionPacket(f.state, f.state.rounds[0], 1)).toThrow("Unsupported frozen");
  expect(createTelepathicSeriesState(f.state.config).config.leadInstructionVersion).toBe(LEAD_INSTRUCTION_VERSION);
  expect(guidanceInstructions({ ...decision(), broadcast: { recipientIds: ids, instruction: "legacy" } }, LEAD_INSTRUCTION_VERSION)).toEqual(decision().individual);
});

for (const mode of ["ai_ai_training", "conversation_exchange"] as const) for (const version of [LEGACY_LEAD_INSTRUCTION_VERSION, LEAD_INSTRUCTION_VERSION]) {
  it(`S1 ${mode}/${version}: a mixed rejected decision is retained, never converted, and cannot grant a third paid attempt`, async () => {
    const f = await fixture("en", mode, 1, 1);
    if (version === LEGACY_LEAD_INSTRUCTION_VERSION) await f.store.saveTelepathicSeries(legacyLeadState(f.input));
    const raw = "```json\n" + JSON.stringify({ ...decision([ids[0]]), broadcast: { recipientIds: [ids[0]], instruction: "Describe the geometry." } }) + "\n```";
    const rejection = version === LEGACY_LEAD_INSTRUCTION_VERSION ? "invalid_receivers" : "unknown_field";
    let decisions = 0;
    const attempt: ProviderChatAttempt = async request => {
      const call = (await f.store.getTelepathicSeries("individual"))!.providerCalls.at(-1)!;
      if (call.callStage.startsWith("lead_guidance:")) {
        decisions++;
        return { content: raw, finishReason: "stop", usage: { totalTokens: 238, costUsd: 0.01 } };
      }
      return f.answer(request);
    };
    for (let i = 0; i < 2; i++) {
      await expect(f.execute(attempt)).rejects.toThrow(rejection);
      expect(decisions).toBe(i + 1); // No automatic correction request in this run.
      await resumeBlockedTelepathicSeries({ ...f.deps, providerAttempt: attempt }, "individual");
    }
    const checkpoint = (await f.store.getTelepathicSeries("individual"))!;
    const before = structuredClone(checkpoint.providerCalls);
    await f.store.saveTelepathicSeries(JSON.parse(JSON.stringify(checkpoint)));
    await expect(f.execute(attempt)).rejects.toThrow("attempts exhausted");
    const result = (await f.store.getTelepathicSeries("individual"))!;
    expect(decisions).toBe(2);
    expect(result.config.leadInstructionVersion).toBe(version);
    expect(result.providerCalls).toEqual(before);
    expect(result.providerCalls.filter(c => c.callStage.startsWith("lead_guidance:")).map(c => [c.status, c.responseText, c.usage?.totalTokens])).toEqual([["failed", raw, 238], ["failed", raw, 238]]);
    expect(result.providerCalls.some(c => c.callStage.startsWith("receiver_guidance:"))).toBe(false);
    expect(result.rounds[0].guidance?.decisions).toEqual([]);
    expect(result.rounds[0].revealedAt).toBeUndefined();
  });
}

it("S1 rejects a corrupted persisted v2 broadcast decision before any recipient dispatch", async () => {
  const f = await fixture();
  const round = f.state.rounds[0];
  for (const id of ids) round.blindByParticipant[id].first = "own blind";
  round.guidance = { decisions: [{ ...decision(), broadcast: { recipientIds: ids, instruction: "legacy" } }], finishedParticipantIds: [], closed: false };
  const { ensureFixedLeadGuidance } = await import("./fixedLeadRuntime");
  const invoke = vi.fn();
  await expect(ensureFixedLeadGuidance(f.state, round, { invoke, save: async () => {}, now: () => "t", checkStop: () => {} })).rejects.toThrow("Unknown lead decision field");
  expect(invoke).not.toHaveBeenCalled();
});
