import { describe, expect, it, vi } from "vitest";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import type { JudgeRepository } from "./engine";
import { buildJudgeRepairPrompt, parseJudgeOutput, runBlindJudging, selectMissingJudgeSelections } from "./engine";
import type { FrozenJudgeResultInput, JudgeScoreRecord } from "./types";

const provider: ProviderConfig = {
  id: "provider_judge", provider: "openrouter", label: "Judge API", credentialId: "cred_judge", enabled: true,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
};

const model: ProviderModel = {
  providerConfigId: provider.id, provider: provider.provider, modelId: "judge-model", displayName: "Judge Model", route: "openrouter:judge-model",
  capabilities: {
    inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true,
    maxOutputTokens: 4096,
    reasoning: { supported: false, efforts: [], confidence: "unknown" },
    temperature: { supported: false, confidence: "unknown" }, supportedParameters: [], source: "provider", capturedAt: "2026-01-01T00:00:00.000Z",
  }, pricing: {}, recommended: true, rawMetadata: {}, refreshedAt: "2026-01-01T00:00:00.000Z",
};

const judgeJson = JSON.stringify({
  scores: { gestalt: 2.5, verifiableFeatures: 2.2, activityFunctionEvent: 1.4, confabulationControl: 1.6 },
  strongestMatches: ["angular structure"], majorMissesContradictions: ["color mismatch"],
  confabulationObservations: ["one unsupported label"], conciseRationale: "Substantial structural correspondence.",
});

describe("blind Judge engine", () => {
  it("parses components and leaves total computation to the Harness", () => {
    const parsed = parseJudgeOutput(judgeJson);
    expect(parsed.scores.gestalt).toBe(2.5);
    expect(parsed).not.toHaveProperty("total");
  });

  it("uses a fresh allowlisted context and freezes each Judge result", async () => {
    const stored: JudgeScoreRecord[] = [];
    const repository: JudgeRepository = {
      getSessionSnapshot: vi.fn().mockResolvedValue({ sessionLanguage: "en" }),
      getReveal: vi.fn().mockResolvedValue({ source: "external_text", text: "A tall angular steel tower", hash: "hash" }),
      getViewerEvidence: vi.fn().mockResolvedValue("Tall angular form. Cool hard surface."),
      listJudgeScores: vi.fn().mockResolvedValue([]),
      recordFrozenJudgeResult: vi.fn(async (run, score) => {
        const record: JudgeScoreRecord = {
          ...score, judgeIndex: run.judgeIndex, modelRoute: run.modelRoute,
          total: score.gestalt + score.verifiableFeatures + score.activityFunctionEvent + score.confabulationControl,
          frozenAt: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z",
        };
        stored.push(record);
        return record;
      }),
    };
    const chat = vi.fn().mockResolvedValue({ content: judgeJson, usage: {} });
    const result = await runBlindJudging({
      repository, sessionId: "session_secret", language: "en",
      judges: [{ providerConfig: provider, model }, { providerConfig: provider, model }], chat,
    });

    expect(chat).toHaveBeenCalledTimes(2);
    for (const call of chat.mock.calls) {
      const messages = call[0].messages;
      expect(messages).toHaveLength(2);
      expect(messages[1].content).toContain("Tall angular form");
      expect(messages[1].content).not.toContain("session_secret");
      expect(messages[1].content).not.toContain("judge-model");
      expect(messages[1].content).not.toContain("Monitor");
    }
    expect(stored).toHaveLength(2);
    expect(result.scores.every((score) => Boolean(score.frozenAt))).toBe(true);
    expect(result.aggregate.mean.total).toBe(7.7);
  });

  it("freezes a requested multi-Judge group through one batch repository call", async () => {
    const recordFrozenJudgeResults = vi.fn(async (items: FrozenJudgeResultInput[]) => items.map(({ run, score }) => ({
      ...score,
      judgeIndex: run.judgeIndex,
      modelRoute: run.modelRoute,
      total: score.gestalt + score.verifiableFeatures + score.activityFunctionEvent + score.confabulationControl,
      frozenAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    })));
    const recordFrozenJudgeResult = vi.fn(() => { throw new Error("single-write path must not be used"); });
    const repository: JudgeRepository = {
      getSessionSnapshot: vi.fn().mockResolvedValue({ sessionLanguage: "en" }),
      getReveal: vi.fn().mockResolvedValue({ source: "external_text", text: "A tower", hash: "hash" }),
      getViewerEvidence: vi.fn().mockResolvedValue("Tall angular form."),
      listJudgeScores: vi.fn().mockResolvedValue([]),
      recordFrozenJudgeResult,
      recordFrozenJudgeResults,
    };
    const result = await runBlindJudging({
      repository,
      sessionId: "session",
      language: "en",
      judges: [{ providerConfig: provider, model }, { providerConfig: provider, model }],
      chat: vi.fn().mockResolvedValue({ content: judgeJson, usage: {} }),
    });
    expect(recordFrozenJudgeResults).toHaveBeenCalledTimes(1);
    expect(recordFrozenJudgeResults.mock.calls[0][0]).toHaveLength(2);
    expect(recordFrozenJudgeResult).not.toHaveBeenCalled();
    expect(result.scores).toHaveLength(2);
  });

  it("resumes only missing Judges and rejects a changed frozen route", () => {
    const secondModel = { ...model, modelId: "judge-model-2", route: "openrouter:judge-model-2" };
    const selected = [{ providerConfig: provider, model }, { providerConfig: provider, model: secondModel }];
    expect(selectMissingJudgeSelections([{ ...scoreRecord(), modelRoute: model.route }], selected)).toEqual([selected[1]]);
    expect(() => selectMissingJudgeSelections([{ ...scoreRecord(), modelRoute: "openrouter:different" }], selected)).toThrow(/does not match/);
  });

  it("refuses an artifact reveal instead of silently dropping it", async () => {
    const repository: JudgeRepository = {
      getSessionSnapshot: vi.fn().mockResolvedValue({ sessionLanguage: "en" }),
      getReveal: vi.fn().mockResolvedValue({ source: "external_mixed", text: "Target", artifactManifest: [{ artifactId: "a", path: "secret.png", originalFileName: "secret.png", mimeType: "image/png", size: 10, sha256: "h" }], hash: "hash" }),
      getViewerEvidence: vi.fn().mockResolvedValue("Evidence"),
      listJudgeScores: vi.fn().mockResolvedValue([]),
      recordFrozenJudgeResult: vi.fn(),
    };
    await expect(runBlindJudging({ repository, sessionId: "s", language: "en", judges: [{ providerConfig: provider, model }], chat: vi.fn() }))
      .rejects.toThrow(/Vision Judge preflight/);
  });

  it("passes permitted images out-of-band with opaque Judge refs and no source filename", async () => {
    const visionModel: ProviderModel = { ...model, capabilities: { ...model.capabilities, supportsVision: true, inputModalities: ["text", "image"] } };
    const repository: JudgeRepository = {
      getSessionSnapshot: vi.fn().mockResolvedValue({ sessionLanguage: "en" }),
      getReveal: vi.fn().mockResolvedValue({ source: "external_artifact", artifactManifest: [{ artifactId: "a", path: "/private/condition_HIGH.png", originalFileName: "condition_HIGH.png", mimeType: "image/png", size: 10, sha256: "h" }], hash: "hash" }),
      getViewerEvidence: vi.fn().mockResolvedValue("Tall angular form."),
      listJudgeScores: vi.fn().mockResolvedValue([]),
      recordFrozenJudgeResult: vi.fn(async (run, score) => ({ ...score, judgeIndex: run.judgeIndex, modelRoute: run.modelRoute, total: 7.7, frozenAt: "now", createdAt: "now" })),
    };
    const chat = vi.fn().mockResolvedValue({ content: judgeJson, usage: {} });
    await runBlindJudging({ repository, sessionId: "s", language: "en", judges: [{ providerConfig: provider, model: visionModel }], chat, loadImage: vi.fn().mockResolvedValue({ mimeType: "image/png", dataBase64: "AA==" }) });
    const userMessage = chat.mock.calls[0][0].messages[1];
    expect(userMessage.content).toContain("reveal_image_1");
    expect(userMessage.content).not.toContain("condition_HIGH.png");
    expect(userMessage.images).toEqual([{ mimeType: "image/png", dataBase64: "AA==" }]);
  });

  it("uses the stored session language and performs at most one language-only correction", async () => {
    const english = judgeJson;
    const polish = JSON.stringify({
      scores: { gestalt: 2.5, verifiableFeatures: 2.2, activityFunctionEvent: 1.4, confabulationControl: 1.6 },
      strongestMatches: ["silna zgodność struktury"], majorMissesContradictions: ["brak zgodności koloru"],
      confabulationObservations: ["jeden niepoparty szczegół"], conciseRationale: "Materiał jest częściowo trafny i zgodny z celem.",
    });
    const repository: JudgeRepository = {
      getSessionSnapshot: vi.fn().mockResolvedValue({ sessionLanguage: "pl" }),
      getReveal: vi.fn().mockResolvedValue({ source: "external_text", text: "Wieża", hash: "hash" }),
      getViewerEvidence: vi.fn().mockResolvedValue("Wysoka twarda struktura"),
      listJudgeScores: vi.fn().mockResolvedValue([]),
      recordFrozenJudgeResult: vi.fn(async (run, score) => ({ ...score, judgeIndex: run.judgeIndex, modelRoute: run.modelRoute, total: 7.7, frozenAt: "now", createdAt: "now" })),
    };
    const chat = vi.fn().mockResolvedValueOnce({ content: english, usage: {} }).mockResolvedValueOnce({ content: polish, usage: {} });
    const result = await runBlindJudging({ repository, sessionId: "s", language: "en", judges: [{ providerConfig: provider, model }], chat });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[0][0].messages[0].content).toContain("MUSZĄ być zapisane po polsku");
    expect(result.scores[0].narrative.conciseRationale).toContain("trafny");
  });

  it("retries one reasoning-only length failure with a larger budget", async () => {
    const highCapacityModel: ProviderModel = { ...model, capabilities: { ...model.capabilities, contextTokens: 100_000, maxOutputTokens: 16_384 } };
    const repository: JudgeRepository = {
      getSessionSnapshot: vi.fn().mockResolvedValue({ sessionLanguage: "en" }),
      getReveal: vi.fn().mockResolvedValue({ source: "external_text", text: "Tower", hash: "hash" }),
      getViewerEvidence: vi.fn().mockResolvedValue("Tall angular structure"),
      listJudgeScores: vi.fn().mockResolvedValue([]),
      recordFrozenJudgeResult: vi.fn(async (run, score) => ({ ...score, judgeIndex: run.judgeIndex, modelRoute: run.modelRoute, total: 7.7, frozenAt: "now", createdAt: "now" })),
    };
    const chat = vi.fn()
      .mockRejectedValueOnce(new Error("provider returned reasoning without a final assistant response [finish-reason=length]"))
      .mockResolvedValueOnce({ content: judgeJson, usage: {} });
    await runBlindJudging({ repository, sessionId: "s", language: "en", judges: [{ providerConfig: provider, model: highCapacityModel }], chat });
    expect(chat.mock.calls.map((call) => call[0].settings.effective.maxOutputTokens)).toEqual([8192, 16384]);
  });

  it("repairs one complete malformed JSON response without changing the Judge route", async () => {
    const repository: JudgeRepository = {
      getSessionSnapshot: vi.fn().mockResolvedValue({ sessionLanguage: "en" }),
      getReveal: vi.fn().mockResolvedValue({ source: "external_text", text: "Tower", hash: "hash" }),
      getViewerEvidence: vi.fn().mockResolvedValue("Tall angular structure"),
      listJudgeScores: vi.fn().mockResolvedValue([]),
      recordFrozenJudgeResult: vi.fn(async (run, score) => ({ ...score, judgeIndex: run.judgeIndex, modelRoute: run.modelRoute, total: 7.7, frozenAt: "now", createdAt: "now" })),
    };
    const chat = vi.fn()
      .mockResolvedValueOnce({ content: "scores: not valid JSON", finishReason: "stop", usage: {} })
      .mockResolvedValueOnce({ content: judgeJson, finishReason: "stop", usage: {} });
    await runBlindJudging({ repository, sessionId: "s", language: "en", judges: [{ providerConfig: provider, model }], chat });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[1][0].config.id).toBe(provider.id);
    expect(chat.mock.calls[1][0].messages[1].content).toContain("scores: not valid JSON");
    expect(buildJudgeRepairPrompt("raw", "en")).toContain("do not recalculate");
  });
});

function scoreRecord(): JudgeScoreRecord {
  return {
    id: "stored",
    judgeRunId: "run",
    judgeIndex: 1,
    modelRoute: model.route,
    gestalt: 2.5,
    verifiableFeatures: 2.2,
    activityFunctionEvent: 1.4,
    confabulationControl: 1.6,
    total: 7.7,
    narrative: {
      strongestMatches: ["match"],
      majorMissesContradictions: [],
      confabulationObservations: [],
      conciseRationale: "Rationale",
    },
    frozenAt: "now",
    createdAt: "now",
  };
}
