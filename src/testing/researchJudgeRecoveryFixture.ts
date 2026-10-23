import { vi } from "vitest";
import { workflowTestRepository } from "./workflowRepository";
import type { AppRepository } from "../storage/repository";
import type { JudgeProviderRequest } from "../judge/engine";
import { runBlindJudging } from "../judge/engine";
import { ProviderCallError } from "../providers/providerError";
import type { ProviderChatResponse, ProviderConfig, ProviderModel } from "../providers/types";
import type { JudgeScoreRecord } from "../judge/types";
import type { ResearchProjectRecord } from "../research/types";
import { createResearchProtocolSelection } from "../research/protocolPolicy";
import { judgeResearch } from "../research/engine";
import { createResearchJudgeRequestRecovery } from "../research/judgeRequestRecovery";


export const output = JSON.stringify({ scores: { gestalt: 2, verifiableFeatures: 2, activityFunctionEvent: 1, confabulationControl: 1 }, strongestMatches: ["The target structure matches."], majorMissesContradictions: [], confabulationObservations: [], conciseRationale: "The evidence matches the target." });
export const provider: ProviderConfig = { id: "pc", provider: "custom_openai", label: "P", credentialId: "c", credentialFingerprint: "f", baseUrl: "https://example.test/v1", enabled: true, createdAt: "t", updatedAt: "t" };
export const model = { providerConfigId: "pc", provider: "custom_openai", modelId: "m", displayName: "M", recommended: true, rawMetadata: {}, refreshedAt: "t", route: "local:m", capabilities: { contextTokens: 262144, maxOutputTokens: 65536, inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: false, reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: false, confidence: "unknown" }, supportedParameters: ["max_tokens"], source: "provider", capturedAt: "t" }, pricing: {} } as ProviderModel;
export const request: JudgeProviderRequest = { config: provider, modelId: "m", messages: [{ role: "user", content: "frozen packet" }], settings: { requested: {}, effective: {}, omitted: [] } };
export const lost = () => new ProviderCallError({ code: "response_body_read", phase: "reading_body", message: "connection lost" });
export function fixture() {
  let scores: JudgeScoreRecord[] = [];
  const project: ResearchProjectRecord = {
    id: "r", workspaceId: "w", name: "Study", templateType: "model", state: "SessionsComplete", createdAt: "t", updatedAt: "t",
    config: { schemaVersion: 1, name: "Study", workspaceId: "w", templateType: "model", sessionLanguage: "en",
      protocol: createResearchProtocolSelection("full-rcp", "en"), targetIds: ["t"], repetitions: 1, requireUnusedTargets: false,
      conditions: [], judges: [{ providerConfigId: "pc", modelId: "m" }],
      randomization: { matchedTargets: true, randomizedExecution: true, randomizedJudgeOrder: true } },
  };
  const repo = workflowTestRepository({
    getResearchResults: async () => null, getResearchProject: async () => project, setResearchProjectState: vi.fn(async (_id, state) => { project.state = state; }),
    listResearchAssignments: async () => [{ id: "a", sessionId: "s", status: scores.length ? "Judged" : "SessionComplete", judgeOrder: 1, anonymousSessionId: "BlindSession_ABCDEF12" }],
    listProviderConfigs: async () => [provider], listProviderModels: async () => [model],
    listJudgeScores: async () => structuredClone(scores),
    getReveal: async () => ({ text: "A stone bridge", artifactManifest: [] }), getViewerEvidence: async () => "A horizontal stone structure over water.", getSessionSnapshot: async () => ({ sessionLanguage: "en" }),
    recordFrozenJudgeResults: vi.fn(async (items) => {
      scores = [...scores, ...items.map(({ run, score }: { run: { id: string; modelRoute: string; judgeIndex: number }; score: JudgeScoreRecord }) => ({ ...score, judgeRunId: run.id, modelRoute: run.modelRoute, judgeIndex: run.judgeIndex, total: 6, frozenAt: "t", createdAt: "t" }))]; return structuredClone(scores);
    }), updateResearchAssignment: vi.fn(),
  } as unknown as AppRepository);
  const chat = vi.fn(async (): Promise<ProviderChatResponse> => ({ content: output, finishReason: "stop", usage: { totalTokens: 20 }, providerRequestId: "paid-1" }));
  const run = (signal?: AbortSignal) => judgeResearch({ repository: repo, projectId: "r", signal, judgeRunner: input => runBlindJudging({ ...input, onAttemptStart: undefined, chat }) });
  const recover = (owner: object = repo, signal?: AbortSignal) => createResearchJudgeRequestRecovery({ repository: repo, owner, sessionId: "s", modelRoute: model.route, signal });
  return { repo, chat, run, recover, project };
}
