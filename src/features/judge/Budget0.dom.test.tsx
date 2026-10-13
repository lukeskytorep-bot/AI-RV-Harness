// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { getCopy } from "../../i18n";
import { JudgeEvaluation } from "./JudgeEvaluation";
import type { AppRepository } from "../../storage/repository";
import type { ProviderConfig, ProviderModel } from "../../providers/types";
const transport = vi.hoisted(() => ({ chat: vi.fn() }));
vi.mock("../../storage", async original => ({ ...await original<typeof import("../../storage")>(), isTauriRuntime: () => true }));
vi.mock("../../providers/native", async original => ({ ...await original<typeof import("../../providers/native")>(), providerChatAttempt: transport.chat, discoverOpenRouterModelEndpoints: vi.fn(async () => ({ data: { endpoints: [{ tag: "large", context_length: 262144, max_completion_tokens: 65536 }] } })) }));
for (const length of [false, true]) it(`ordinary Judge screen dispatches ${length ? '16/32K' : '16K once'} and freezes scores`, async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const config = { id: "pc", provider: "openrouter", label: "P", credentialId: "c", enabled: true } as ProviderConfig;
  const model = { providerConfigId: "pc", provider: "openrouter", modelId: "m", displayName: "M", route: "openrouter:m", capabilities: { contextTokens: 262144, maxOutputTokens: 65536, inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: false, confidence: "unknown" }, supportedParameters: [], source: "provider", capturedAt: "t" }, pricing: {}, recommended: false, rawMetadata: {}, refreshedAt: "t" } as ProviderModel;
  const budgets: number[] = [];
  let done!: () => void; const completed = new Promise<void>(resolve => { done = resolve; });
  transport.chat.mockImplementation(async request => { budgets.push(request.settings.effective.maxOutputTokens); return { content: JSON.stringify({ scores: { gestalt: 2, verifiableFeatures: 2, activityFunctionEvent: 1, confabulationControl: 1 }, strongestMatches: ["structure"], majorMissesContradictions: [], confabulationObservations: [], conciseRationale: "Good structural match." }), finishReason: length && budgets.length === 1 ? "length" : "stop", usage: {} }; });
  const freeze = vi.fn(async (run, score) => ({ ...score, judgeIndex: run.judgeIndex, modelRoute: run.modelRoute, total: 6, frozenAt: "t", createdAt: "t" }));
  const repository = { getSessionSnapshot: vi.fn(async () => ({ sessionLanguage: "en" })), getReveal: vi.fn(async () => ({ text: "Tower", hash: "h" })), getViewerEvidence: vi.fn(async () => "Tall structure"), listJudgeScores: vi.fn(async () => []), recordFrozenJudgeResult: freeze, updateRvSessionState: vi.fn() } as unknown as AppRepository;
  try {
    await act(async () => root.render(<JudgeEvaluation copy={getCopy("en")} repository={repository} sessionId="s" language="en" models={[model]} providerConfigs={[config]} profile={{ id: "p", name: "P", credentialId: "c", createdAt: "t", updatedAt: "t" }} defaultModelKey="pc::m" onCompleted={done} />));
    const start = [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === getCopy("en").runJudges)!;
    expect(start.disabled).toBe(false); await act(async () => { start.click(); await completed; });
    expect(host.querySelector(".provider-error")?.textContent).toBeUndefined();
    expect(budgets).toEqual(length ? [32768, 49152] : [32768]); expect(freeze).toHaveBeenCalledTimes(1);
    expect(repository.updateRvSessionState).toHaveBeenCalledWith("s", "Completed");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
