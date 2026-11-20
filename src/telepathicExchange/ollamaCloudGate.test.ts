import { expect, it, vi } from "vitest";
import { normalizeModelDiscovery } from "../providers/capabilities";
import type { ProviderConfig } from "../providers/types";
import { executeTelepathicProviderPacket, type ResolvedTelepathicAiRoute } from "./providerGateway";
import { buildSenderTargetPacket } from "./packets";
import { createTelepathicSeriesState, runNextTelepathicAiRound } from "./engine";
import { InMemoryTelepathicExchangeStore } from "./store";
import type { TelepathicParticipant, TelepathicProviderCallRecord } from "./types";
const provider: ProviderConfig = { id: "cloud", provider: "ollama_cloud", label: "Cloud", credentialId: "key", enabled: true, createdAt: "t", updatedAt: "t" };
const model = normalizeModelDiscovery(provider, { models: [{ name: "qwen3:235b" }] }, "t")[0];
function participant(id: string): TelepathicParticipant {
  return { id, kind: "ai", displayName: id, ai: { profileId: `profile-${id}`, profileName: id, workspaceId: `workspace-${id}`, aiIdentityId: `identity-${id}`, providerConfigId: provider.id, credentialId: provider.credentialId, credentialFingerprint: "fingerprint", modelId: model.modelId, route: model.route } };
}
function route(p: TelepathicParticipant): ResolvedTelepathicAiRoute {
  return { snapshot: p.ai!, providerConfig: provider, model, requestedSettings: { maxOutputTokens: 32768 }, validatedIdentity: { profileId: p.ai!.profileId, workspaceId: p.ai!.workspaceId, aiIdentityId: p.ai!.aiIdentityId, credentialFingerprint: p.ai!.credentialFingerprint } };
}
it.each([false, true])("real provider gateway dispatches Cloud, fixedLead=%s", async fixedLead => {
  const persisted: TelepathicProviderCallRecord[] = [];
  const attempt = vi.fn(async () => ({ content: "Frozen target", finishReason: "stop", usage: {} }));
  await executeTelepathicProviderPacket({ packet: buildSenderTargetPacket({ language: "en", seriesId: "gate", roundId: "round", participantId: "a", name: "A", roundNumber: 1, topicLabel: "any" }), route: route(participant("a")), fixedLead, technicalAttempt: 1, attempt, hooks: { createCallId: () => "call", now: () => "2026-11-19T12:00:00Z", persist: async call => { persisted.push(structuredClone(call)); } } });
  expect(attempt).toHaveBeenCalledTimes(1);
  expect(persisted.at(-1)).toMatchObject({status:"succeeded",physicalAttempts:1});
});
for (const mode of ["conversation_exchange", "ai_ai_training"] as const) {
  it.each([false, true])(`${mode}: engine → real gateway completes Cloud round, fixedLead=%s`, async fixed => {
    const store = new InMemoryTelepathicExchangeStore();
    const initial = createTelepathicSeriesState({ schemaVersion: 1, seriesId: "gate", seriesWorkspaceId: "w", mode, language: "en", participants: [participant("a"), participant("b")], roundCount: 1, topic: "any", discloseTopicToReceivers: false, senderPolicy: fixed ? { kind: "fixed_ai", participantId: "a" } : { kind: "rotate" }, ...(fixed ? { protocolVersion: "fixed_lead_v1" as const, maxGuidanceCycles: 3 as const } : {}) });
    await store.saveTelepathicSeries(initial);
    const providerAttempt = vi.fn(async (request: Parameters<NonNullable<Parameters<typeof runNextTelepathicAiRound>[0]["providerAttempt"]>>[0]) => {
      const prompt=request.messages.map(m=>m.content).join("\n");
      const content=prompt.includes("CONTRACT:") ? JSON.stringify({cycle:Number(prompt.match(/"cycle":(\d)/)?.[1]),finishRound:true,finishParticipantIds:[],individual:[]})
        : prompt.includes("confirm the transmission") ? "READY" : prompt.includes("YES or NO") ? "NO" : "A complete target, description or reflection.";
      return {content,finishReason:"stop",usage:{}};
    });
    await runNextTelepathicAiRound({ store, resolveRoute: async p => route(p), providerAttempt }, "gate");
    expect(providerAttempt.mock.calls.length).toBeGreaterThan(3);
    const saved = (await store.getTelepathicSeries("gate"))!;
    expect(saved.rounds[0].revealedAt).toBeTruthy();
    expect(saved.providerCalls.every(call=>call.status==="succeeded")).toBe(true);
    const before=providerAttempt.mock.calls.length;
    await runNextTelepathicAiRound({store,resolveRoute:async p=>route(p),providerAttempt},"gate");
    expect(providerAttempt).toHaveBeenCalledTimes(before);
  });
}
it("the distinct telepathic operation still dispatches another provider once", async () => {
  const p = participant("a"), r = route(p);
  r.providerConfig = { ...provider, provider: "custom_openai", baseUrl: "https://fixture.invalid/v1" };
  r.model = { ...model, provider: "custom_openai" };
  const attempt = vi.fn(async () => ({ content: "Final", finishReason: "stop", usage: {} }));
  await executeTelepathicProviderPacket({ packet: buildSenderTargetPacket({ language: "en", seriesId: "gate", roundId: "round", participantId: "a", name: "A", roundNumber: 1, topicLabel: "any" }), route: r, technicalAttempt: 1, attempt, hooks: { createCallId: () => "call", now: () => "2026-11-19T12:00:00Z", persist: async () => {} } });
  expect(attempt).toHaveBeenCalledTimes(1);
});
