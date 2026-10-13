import { sha256Text } from "../application/sha256";
import { beforeEach, expect, it, vi } from "vitest";
import type { ProviderConfig, ProviderModel, ProviderChatResponse } from "./types";
import { evaluateMonitor } from "../monitor/engine";
import { runBlindJudging, type JudgeRepository } from "../judge/engine";
import { sendPostRevealTurn, sendMonitorPostRevealReview } from "../sessions/postReveal";
import { callWithAnalyticalOutputRecovery } from "./outputRecovery";
import type { AppRepository } from "../storage/repository";
import { freezeResearchViewerOutputPolicy, judgeResearch, createAndLockResearch } from "../research/engine";
import { BrowserResearchRepository } from "../storage/browser/researchRepository";
import { viewerOutputAttemptSettings } from "../sessions/viewerOutputRecovery";
import { buildResearchLockPlan, stableStringify } from "../research/planner";
import type { ResearchConfig, ResearchProjectRecord } from "../research/types";
import { createDefaultSettings } from "../startupDefaults";
const transport = vi.hoisted(() => ({ chat: vi.fn() }));
vi.mock("./native", async original => ({ ...await original<typeof import("./native")>(), providerChatAttempt: transport.chat, discoverOpenRouterModelEndpoints: vi.fn(async () => ({ data: { endpoints: [{ tag: "large", context_length: 262144, max_completion_tokens: 65536 }] } })) }));
const provider: ProviderConfig = { id: "pc", provider: "openrouter", label: "P", credentialId: "c", enabled: true, createdAt: "t", updatedAt: "t" };
const model: ProviderModel = { providerConfigId: "pc", provider: "openrouter", modelId: "m", displayName: "M", route: "openrouter:m", capabilities: { contextTokens: 262144, maxOutputTokens: 65536, inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: false, confidence: "unknown" }, supportedParameters: [], source: "provider", capturedAt: "t" }, pricing: {}, recommended: false, rawMetadata: {}, refreshedAt: "t" };
const judgeJson = JSON.stringify({ scores: { gestalt: 2, verifiableFeatures: 2, activityFunctionEvent: 1, confabulationControl: 1 }, strongestMatches: ["structure"], majorMissesContradictions: [], confabulationObservations: [], conciseRationale: "Good structural match." });
function repo() {
  let transcript = "";
  const scores: unknown[] = [];
  return {
    getSessionSnapshot: vi.fn(async () => ({ sessionLanguage: "en", workspaceId: "w", providerConfigId: "pc", modelId: "m", generationSettings: { requested: {}, effective: {}, omitted: [] }, monitor: { providerConfigId: "pc", modelId: "m", effectivePrompt: "Monitor" } })),
    getReveal: vi.fn(async () => ({ source: "external_text", text: "Tower", hash: "h" })), getViewerEvidence: vi.fn(async () => "Tall structure"),
    listTargetClarifications: vi.fn(async () => []), listMonitorRuns: vi.fn(async () => []), listMonitorInterventions: vi.fn(async () => []),
    appendPostRevealTurn: vi.fn(async (_id, role, content) => transcript += JSON.stringify({ role, content }) + "\n"),
    listJudgeScores: vi.fn(async () => scores), recordFrozenJudgeResult: vi.fn(async (run, score) => {
      const result = { ...score, judgeIndex: run.judgeIndex, modelRoute: run.modelRoute, total: 6, frozenAt: "t", createdAt: "t" }; scores.push(result); return result;
    }),
  };
}
beforeEach(() => { transport.chat.mockReset(); });
for (const role of ["judge", "live_monitor", "post_reveal_viewer", "post_reveal_monitor"] as const) for (const length of [false, true]) {
  it(`${role}: dispatches 16K${length ? '/32K after length' : ' once after complete'} through the real operation`, async () => {
    const repository = repo(); const budgets: number[] = [];
    const chat = vi.fn(async (request): Promise<ProviderChatResponse> => {
      budgets.push(request.settings.effective.maxOutputTokens);
      if (length && budgets.length === 1) return { content: "partial", finishReason: "length", usage: {} };
      return { content: role === "judge" ? judgeJson : role === "live_monitor" ? "CONTINUE_PROTOCOL" : "Complete analysis", finishReason: "stop", usage: {} };
    });
    if (role === "judge") await runBlindJudging({ repository: repository as unknown as JudgeRepository, sessionId: "s", language: "en", judges: [{ providerConfig: provider, model }], chat });
    if (role === "live_monitor") await evaluateMonitor({ providerConfig: provider, model, language: "en", phase: 1, blindTranscript: "blind", chat });
    if (role === "post_reveal_viewer") await sendPostRevealTurn({ repository: repository as never, sessionId: "s", existingTranscript: "", providerConfig: provider, model, content: "Review", chat });
    if (role === "post_reveal_monitor") await sendMonitorPostRevealReview({ repository: repository as never, sessionId: "s", existingTranscript: "", providerConfig: provider, model, chat });
    expect(budgets).toEqual(role === "live_monitor" ? (length ? [16384,32768] : [16384]) : (length ? [32768,49152] : [32768]));
  });
}
for (const role of ["judge", "live_monitor", "post_reveal_viewer", "post_reveal_monitor"] as const) it(`${role}: low ceiling blocks an ineffective second paid attempt`, async () => {
  const limited = { ...model, capabilities: { ...model.capabilities, maxOutputTokens: 8192 } }; const repository = repo();
  const chat = vi.fn(async (request) => { expect(request.settings.effective.maxOutputTokens).toBe(8192); return { content: "partial", finishReason: "length", usage: {} }; });
  const run = role === "judge" ? () => runBlindJudging({ repository: repository as unknown as JudgeRepository, sessionId: "s", language: "en", judges: [{ providerConfig: provider, model: limited }], chat })
    : role === "live_monitor" ? () => evaluateMonitor({ providerConfig: provider, model: limited, language: "en", phase: 1, blindTranscript: "blind", chat })
    : role === "post_reveal_viewer" ? () => sendPostRevealTurn({ repository: repository as never, sessionId: "s", existingTranscript: "", providerConfig: provider, model: limited, content: "Review", chat })
    : () => sendMonitorPostRevealReview({ repository: repository as never, sessionId: "s", existingTranscript: "", providerConfig: provider, model: limited, chat });
  await expect(run()).rejects.toThrow(); expect(chat).toHaveBeenCalledTimes(1);
});
for (const kind of ["field_guide_update", "viewer_notes_reflection"] as const) for (const training of [false, true]) it(`${kind}: keeps C + ${training ? '32/48K' : '8/16K'} unchanged`, async () => {
  const seen: number[] = [];
  await callWithAnalyticalOutputRecovery({ model, messages: [{ role: "user", content: "Update" }], operationKind: kind, learningObjectCapacityTokens: 4096, budgetPolicy: training ? "training_reveal" : "default", call: async settings => {
    seen.push(settings.effective.maxOutputTokens!); return { content: "complete", finishReason: seen.length === 1 ? "length" : "stop", usage: {} };
  } });
  expect(seen).toEqual(training ? [4096 + 32768, 4096 + 49152] : [4096 + 8192, 4096 + 16384]);
});
function draft(output = 8192): ResearchConfig {
  return { schemaVersion: 1, name: "Budget", workspaceId: "w", templateType: "custom", sessionLanguage: "en", protocol: { id: "full-rcp", version: "1.5a" }, targetIds: ["t"], repetitions: 1, requireUnusedTargets: false,
    viewerControl: { model: { mode: "fixed", modelId: "m" }, systemPrompt: { mode: "fixed", contentSha256: "h" }, reasoning: { mode: "provider_default" }, temperature: { mode: "provider_default" }, maxOutputTokens: output },
    conditions: ["a", "b"].map(key => ({ key, label: key, profileId: "p", providerConfigId: "pc", modelId: "m", requestedSettings: { maxOutputTokens: output }, capabilitySnapshot: model.capabilities, effectiveSettings: { requested: { maxOutputTokens: output }, effective: { maxOutputTokens: output }, omitted: [] } })),
    judges: [{ providerConfigId: "pc", modelId: "m" }], randomization: { matchedTargets: true, randomizedExecution: true, randomizedJudgeOrder: true } };
}
for (const output of [8192, 40000]) it(`new Research: control/requested/effective/policy agree before lock (${output})`, async () => {
  const original = draft(output); const frozen = freezeResearchViewerOutputPolicy(original); const initial = Math.max(16384, output);
  expect(original.conditions[0].requestedSettings.maxOutputTokens).toBe(output);
  expect(frozen.viewerControl?.maxOutputTokens).toBe(initial);
  for (const c of frozen.conditions) {
    expect(c.requestedSettings.maxOutputTokens).toBe(initial); expect(c.effectiveSettings?.requested.maxOutputTokens).toBe(initial); expect(c.effectiveSettings?.effective.maxOutputTokens).toBe(initial);
    expect(c.viewerOutputPolicy).toMatchObject({ initialTokens: initial, recoveryTokens: Math.max(initial, 32768) });
    expect(viewerOutputAttemptSettings({ model, baseSettings: c.effectiveSettings!, operationKind: "research_viewer", recoveryLevel: 0, lockedPolicy: c.viewerOutputPolicy }).effective.maxOutputTokens).toBe(initial);
  }
  const storage = new Map<string, string>(); const repository = new BrowserResearchRepository({ storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); } } });
  const project = await repository.createResearchProject(frozen); await repository.lockResearchProject(project.id, await buildResearchLockPlan(project.id, frozen));
  const restored = new BrowserResearchRepository({ storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); } } });
  expect((await restored.getResearchProject(project.id))?.config).toEqual(frozen);
  expect(freezeResearchViewerOutputPolicy(frozen)).toEqual(frozen);
  expect(createDefaultSettings().defaultMaxOutputTokens).toBe(8192);
});
it("new Research shares the smallest model ceiling across control and conditions", () => {
  const config = draft(); config.conditions[1].capabilitySnapshot = { ...model.capabilities, maxOutputTokens: 4096 };
  const frozen = freezeResearchViewerOutputPolicy(config);
  expect(frozen.viewerControl?.maxOutputTokens).toBe(4096);
  expect(frozen.conditions.map(c => [c.requestedSettings.maxOutputTokens, c.effectiveSettings?.effective.maxOutputTokens, c.viewerOutputPolicy?.initialTokens])).toEqual([[4096, 4096, 4096], [4096, 4096, 4096]]);
});
it("existing frozen 8K Research is byte-preserved, including the absent Judge marker", () => {
  const config = draft(); config.conditions = config.conditions.map(c => ({ ...c, viewerOutputPolicy: { version: 1, initialTokens: 8192, recoveryTokens: 16384, preserveConfiguredBudget: false } }));
  const wire = stableStringify(config); expect(stableStringify(freezeResearchViewerOutputPolicy(config))).toBe(wire);
});
for (const generation of ["legacy","v1","v2"] as const) it(`Research Judge uses frozen ${generation} for missing scores without re-freezing accepted results`, async () => {
  const fresh=generation!=="legacy";
  const base = repo(); const config = fresh ? freezeResearchViewerOutputPolicy(draft()) : draft();
  if(generation==="v1")config.judgeOutputPolicy={version:1,initialTokens:16384,recoveryTokens:32768};
  const project: ResearchProjectRecord = { id: "r", workspaceId: "w", name: "R", templateType: "custom", state: "SessionsComplete", config, createdAt: "t", updatedAt: "t" };
  let status = "SessionComplete"; let budgets: number[] = [];
  transport.chat.mockImplementation(async request => { budgets.push(request.settings.effective.maxOutputTokens); return { content: judgeJson, finishReason: budgets.length === 1 ? "length" : "stop", usage: {} }; });
  const repository = { ...base, getResearchProject: vi.fn(async () => project), listResearchAssignments: vi.fn(async () => [{ id: "a", sessionId: "s", anonymousSessionId: "BlindSession_ABCDEF12", judgeOrder: 1, status }]),
    listProviderConfigs: vi.fn(async () => [provider]), listProviderModels: vi.fn(async () => [model]), setResearchProjectState: vi.fn(), updateResearchAssignment: vi.fn(async (_id, _session, next) => { status = next; }), markResearchScoresFrozen: vi.fn() } as unknown as AppRepository;
  await judgeResearch({ repository, projectId: "r" }); expect(budgets).toEqual(generation==="v1"?[16384,32768]:fresh ? [32768, 49152] : [8192, 16384]);
  expect(stableStringify(project.config)).toBe(stableStringify(config));
  budgets = []; await judgeResearch({ repository, projectId: "r" }); expect(budgets).toEqual([]);
});

for (const frozenViewer of [false, true]) it(`createAndLockResearch persists policy before hashing (existing Viewer snapshot: ${frozenViewer})`, async () => {
  const config = draft(); config.conditions = config.conditions.map(c => ({ ...c, systemPrompt: { id: "p", version: "1", content: "Fixed Viewer instructions", contentSha256: "h" }, conditionInstruction: { id: c.key, version: "1", content: `Variable ${c.key}`, contentSha256: c.key.repeat(64) } }));
  if (frozenViewer) config.conditions = config.conditions.map(c => ({ ...c, viewerOutputPolicy: { version: 1, initialTokens: 8192, recoveryTokens: 16384, preserveConfiguredBudget: false } }));
  const storage = new Map<string, string>();
  const repository = new BrowserResearchRepository({ storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); } } });
  const { project, preflight } = await createAndLockResearch(repository as unknown as AppRepository, config, {
    profiles: [{ id: "p", name: "P", credentialId: "c", createdAt: "t", updatedAt: "t" }], providerConfigs: [{ ...provider, lastStatus: "ok" }], models: [model],
    targets: [{ id: "t", collection: "user", title: "Target", revealText: "Tower", tags: [], sourceMetadata: {}, createdAt: "t", updatedAt: "t" }], targetUsage: [],
  });
  expect(preflight.ok).toBe(true); expect(project.state).toBe("Locked");
  const initial = frozenViewer ? 8192 : 16384;
  expect(project.config.viewerControl?.maxOutputTokens).toBe(initial);
  expect(project.config.conditions.every(c => c.requestedSettings.maxOutputTokens === initial && c.effectiveSettings?.effective.maxOutputTokens === initial && c.viewerOutputPolicy?.initialTokens === initial)).toBe(true);
  expect(project.configHash).toBe(await sha256Text(stableStringify(project.config)));
  expect(project.config.judgeOutputPolicy).toEqual({ version: 2, initialTokens: 32768, recoveryTokens: 49152 });
  expect(project.config.postRevealOutputPolicy).toEqual({ version: 2, initialTokens: 32768, recoveryTokens: 49152 });
  expect(transport.chat).not.toHaveBeenCalled();
});
for (const repair of ["json", "language"] as const) it(`Judge ${repair} repair keeps score candidates and uses its own bounded 32/48K recovery`, async () => {
  const repository = repo(); const budgets: number[] = [];
  const wrongLanguage = JSON.stringify({ ...JSON.parse(judgeJson), strongestMatches: ["zgodność struktury"], conciseRationale: "Opis jest trafny." });
  const chat = vi.fn(async request => {
    budgets.push(request.settings.effective.maxOutputTokens);
    return { content: budgets.length === 1 ? (repair === "json" ? "malformed JSON" : wrongLanguage) : judgeJson,
      finishReason: budgets.length === 2 ? "length" : "stop", usage: {} };
  });
  const result = await runBlindJudging({ repository: repository as unknown as JudgeRepository, sessionId: "s", language: "en", judges: [{ providerConfig: provider, model }], chat });
  expect(budgets).toEqual([32768, 32768, 49152]);
  expect(result.scores[0]).toMatchObject({ gestalt: 2, verifiableFeatures: 2, activityFunctionEvent: 1, confabulationControl: 1, total: 6 });
  expect(repository.recordFrozenJudgeResult).toHaveBeenCalledTimes(1);
});
