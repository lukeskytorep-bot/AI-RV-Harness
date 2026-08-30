import { buildJudgePacket } from "../domain/judgePacket";
import { aggregateJudgeScores, computeJudgeTotal, validateJudgeScores, type JudgeComponentScores } from "../domain/scoring";
import { resolveGenerationSettings } from "../providers/capabilities";
import { providerChat as nativeProviderChat } from "../providers/native";
import type { ProviderChatResponse, ProviderConfig, ProviderMessage, ProviderModel } from "../providers/types";
import type { ProviderImageInput } from "../providers/types";
import type { RevealInput } from "../sessions/types";
import type { RevealArtifactRecord } from "../sessions/types";
import { loadRevealImageForJudge } from "../artifacts/native";
import type { AppRepository } from "../storage/repository";
import { createId } from "../storage/repository";
import type { InterfaceLanguage } from "../types";
import { getJudgePrompt } from "./prompt";
import { JUDGE_RUBRIC_VERSION, type JudgeNarrative, type JudgeScoreRecord, type JudgingResult } from "./types";
import { callWithAnalyticalOutputRecovery } from "../providers/outputRecovery";

export type JudgeRepository = Pick<
  AppRepository,
  "getReveal" | "getViewerEvidence" | "getSessionSnapshot" | "recordFrozenJudgeResult" | "listJudgeScores"
> & Partial<Pick<AppRepository, "recordFrozenJudgeResults">>;

export interface JudgeSelection {
  providerConfig: ProviderConfig;
  model: ProviderModel;
}

export interface RunJudgingInput {
  repository: JudgeRepository;
  sessionId: string;
  language: InterfaceLanguage;
  judges: JudgeSelection[];
  anonymousSessionId?: string;
  loadImage?: (artifact: RevealArtifactRecord) => Promise<ProviderImageInput>;
  chat?: (request: {
    config: ProviderConfig;
    modelId: string;
    messages: ProviderMessage[];
    settings: ReturnType<typeof resolveGenerationSettings>;
  }) => Promise<ProviderChatResponse>;
  onProgress?: (completed: number, total: number) => void;
}

interface ParsedJudgeOutput {
  scores: JudgeComponentScores;
  narrative: JudgeNarrative;
}

export async function runBlindJudging(input: RunJudgingInput): Promise<JudgingResult> {
  if (input.judges.length < 1 || input.judges.length > 3) throw new RangeError("Select between 1 and 3 Judges.");
  for (const judge of input.judges) validateJudgeRoute(judge);

  const [reveal, evidence, existing, snapshot] = await Promise.all([
    input.repository.getReveal(input.sessionId),
    input.repository.getViewerEvidence(input.sessionId),
    input.repository.listJudgeScores(input.sessionId),
    input.repository.getSessionSnapshot(input.sessionId),
  ]);
  if (!snapshot) throw new Error("Session Snapshot is required before Judge evaluation.");
  const language = snapshot.sessionLanguage;
  if (!reveal) throw new Error("Reveal is required before Judge evaluation.");
  if (!evidence.trim()) throw new Error("No pre-reveal Viewer evidence is available for judging.");
  if (existing.length + input.judges.length > 3) throw new RangeError("A session may have at most 3 frozen Judge scores.");
  const imageArtifacts = (reveal.artifactManifest ?? []).filter((artifact) => artifact.mimeType.startsWith("image/"));
  if (!reveal.text?.trim() && !imageArtifacts.length) throw new Error("Judge needs reveal text or at least one supported reveal image.");
  if (imageArtifacts.length && input.judges.some((judge) => !judge.model.capabilities.supportsVision || !judge.model.capabilities.inputModalities.includes("image"))) {
    throw new Error("Vision Judge preflight failed: every selected Judge route must advertise image input support.");
  }
  const loadImage = input.loadImage ?? loadRevealImageForJudge;
  const judgeImages = imageArtifacts.length ? await Promise.all(imageArtifacts.map(loadImage)) : [];

  const anonymousSessionId = input.anonymousSessionId?.trim() || makeAnonymousSessionId();
  if (!/^BlindSession_[A-Z0-9]{8,24}$/.test(anonymousSessionId)) throw new Error("Research Judge requires a neutral randomized anonymous session ID.");
  const packet = buildJudgePacket({
    anonymousSessionId,
    preRevealEvidence: evidence,
    reveal: {
      ...(reveal.text !== undefined ? { text: reveal.text } : {}),
      ...(judgeImages.length ? { imageRefs: judgeImages.map((_, index) => `reveal_image_${index + 1}`) } : {}),
    },
    rubricVersion: JUDGE_RUBRIC_VERSION,
  });
  const packetWire = JSON.stringify(packet);
  const packetHash = await sha256Text(packetWire);
  const chat = input.chat ?? nativeProviderChat;
  const scores: JudgeScoreRecord[] = [...existing];
  const pending: Array<{ judge: JudgeSelection; parsed: ParsedJudgeOutput; judgeIndex: number }> = [];

  for (let index = 0; index < input.judges.length; index += 1) {
    const judge = input.judges[index];

    // Each Judge gets a fresh two-message context. No Viewer/Monitor/model/research metadata is added here.
    const languageDirective = language === "pl"
      ? "[JĘZYK ODPOWIEDZI] Wszystkie wartości tekstowe i elementy list w JSON-ie zapisz wyłącznie po polsku; angielskie nazwy kluczy pozostaw bez zmian."
      : "[RESPONSE LANGUAGE] Write every textual value and list item in the JSON exclusively in English; keep the English property names unchanged.";
    const messages: ProviderMessage[] = [
      { role: "system", content: getJudgePrompt(language) },
      { role: "user", content: `${languageDirective}\n\n${packetWire}`, ...(judgeImages.length ? { images: judgeImages } : {}) },
    ];
    const initial = await callWithAnalyticalOutputRecovery({
      model: judge.model,
      messages,
      call: (settings) => chat({
        config: judge.providerConfig,
        modelId: judge.model.modelId,
        messages,
        settings,
      }),
    });
    let response = initial.response;
    let parsed: ParsedJudgeOutput;
    try {
      parsed = parseJudgeOutput(response.content);
    } catch (cause) {
      if (!(cause instanceof Error) || cause.message !== "Judge returned invalid JSON.") throw cause;
      const repairMessages: ProviderMessage[] = [
        { role: "system", content: "You are a deterministic JSON formatter. Preserve all substantive text and every numeric score. Return one valid JSON object only and do not expose reasoning." },
        { role: "user", content: buildJudgeRepairPrompt(response.content, language) },
      ];
      const repaired = await callWithAnalyticalOutputRecovery({
        model: judge.model,
        messages: repairMessages,
        call: (settings) => chat({ config: judge.providerConfig, modelId: judge.model.modelId, messages: repairMessages, settings }),
      });
      response = repaired.response;
      parsed = parseJudgeOutput(response.content);
    }
    if (!narrativeMatchesLanguage(parsed.narrative, language)) {
      const originalScores = parsed.scores;
      const correction = language === "pl"
        ? "Popraw wyłącznie język wartości tekstowych na polski. Zachowaj dokładnie te same wyniki liczbowe, nie dodawaj danych i zwróć wyłącznie JSON o tym samym schemacie."
        : "Correct only the language of all textual values to English. Keep exactly the same numeric scores, add no data, and return only JSON with the same schema.";
      const correctionMessages: ProviderMessage[] = [...messages, { role: "assistant", content: response.content }, { role: "user", content: correction }];
      response = (await callWithAnalyticalOutputRecovery({
        model: judge.model,
        messages: correctionMessages,
        call: (settings) => chat({ config: judge.providerConfig, modelId: judge.model.modelId, messages: correctionMessages, settings }),
      })).response;
      parsed = parseJudgeOutput(response.content);
      if (JSON.stringify(parsed.scores) !== JSON.stringify(originalScores)) throw new Error("Judge language correction changed frozen score candidates.");
      if (!narrativeMatchesLanguage(parsed.narrative, language)) throw new Error("Judge returned narrative text in the wrong session language.");
    }
    pending.push({ judge, parsed, judgeIndex: existing.length + index + 1 });
    input.onProgress?.(index + 1, input.judges.length);
  }

  // Freeze only after every requested Judge returned a valid response. The desktop repository
  // persists the complete group in one SQLite transaction, so neither provider/JSON nor database
  // failures can leave this requested group half-frozen.
  const frozenInputs = pending.map((item) => {
    const judgeRunId = createId("judge");
    return {
      run: {
        id: judgeRunId,
        sessionId: input.sessionId,
        judgeIndex: item.judgeIndex,
        modelRoute: item.judge.model.route,
        rubricVersion: JUDGE_RUBRIC_VERSION,
        anonymousSessionId,
        packetHash,
      },
      score: {
        id: createId("judge_score"),
        judgeRunId,
        ...item.parsed.scores,
        narrative: item.parsed.narrative,
      },
    };
  });
  const frozen = input.repository.recordFrozenJudgeResults
    ? await input.repository.recordFrozenJudgeResults(frozenInputs)
    : await Promise.all(frozenInputs.map(({ run, score }) => input.repository.recordFrozenJudgeResult(run, score)));
  scores.push(...frozen);

  return {
    anonymousSessionId,
    scores,
    aggregate: aggregateJudgeScores(scores),
  };
}

export function selectMissingJudgeSelections(existing: JudgeScoreRecord[], selected: JudgeSelection[]): JudgeSelection[] {
  if (existing.length > selected.length) {
    throw new Error("The session already contains more frozen Judge scores than the selected evaluation design.");
  }
  for (let index = 0; index < existing.length; index += 1) {
    if (existing[index].modelRoute !== selected[index].model.route) {
      throw new Error(`Frozen Judge ${index + 1} does not match the selected Judge route.`);
    }
  }
  return selected.slice(existing.length);
}

export function parseJudgeOutput(content: string): ParsedJudgeOutput {
  const clean = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let value: unknown;
  try {
    value = JSON.parse(clean);
  } catch {
    throw new Error("Judge returned invalid JSON.");
  }
  if (!isRecord(value) || !isRecord(value.scores)) throw new Error("Judge response is missing scores.");
  const scores: JudgeComponentScores = {
    gestalt: requireNumber(value.scores.gestalt, "gestalt"),
    verifiableFeatures: requireNumber(value.scores.verifiableFeatures, "verifiableFeatures"),
    activityFunctionEvent: requireNumber(value.scores.activityFunctionEvent, "activityFunctionEvent"),
    confabulationControl: requireNumber(value.scores.confabulationControl, "confabulationControl"),
  };
  validateJudgeScores(scores);
  const narrative: JudgeNarrative = {
    strongestMatches: requireStringArray(value.strongestMatches, "strongestMatches"),
    majorMissesContradictions: requireStringArray(value.majorMissesContradictions, "majorMissesContradictions"),
    confabulationObservations: requireStringArray(value.confabulationObservations, "confabulationObservations"),
    conciseRationale: requireString(value.conciseRationale, "conciseRationale"),
  };
  return { scores, narrative };
}

export function buildJudgeRepairPrompt(content: string, language: InterfaceLanguage): string {
  const languageInstruction = language === "pl"
    ? "Wszystkie wartości tekstowe zachowaj po polsku."
    : "Keep every textual value in English.";
  return `Reformat the complete response below into exactly one valid JSON object. Preserve every substantive statement and numeric score; do not recalculate, reinterpret, add, or remove evidence. ${languageInstruction}\nUse exactly this schema:\n{"scores":{"gestalt":0,"verifiableFeatures":0,"activityFunctionEvent":0,"confabulationControl":0},"strongestMatches":[],"majorMissesContradictions":[],"confabulationObservations":[],"conciseRationale":"text"}\nReturn JSON only.\n\nRESPONSE TO REFORMAT:\n${content}`;
}

function validateJudgeRoute(judge: JudgeSelection): void {
  if (judge.model.providerConfigId !== judge.providerConfig.id) throw new Error("Judge model/provider route mismatch.");
  if (judge.model.provider !== judge.providerConfig.provider) throw new Error("Judge provider mismatch.");
}

function makeAnonymousSessionId(): string {
  return `BlindSession_${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
}

async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Judge field ${field} must be a number.`);
  return value;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Judge field ${field} must be non-empty text.`);
  return value.trim();
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`Judge field ${field} must be a text array.`);
  return value.map((item) => item.trim()).filter(Boolean);
}

function narrativeMatchesLanguage(narrative: JudgeNarrative, language: InterfaceLanguage): boolean {
  const text = [...narrative.strongestMatches, ...narrative.majorMissesContradictions, ...narrative.confabulationObservations, narrative.conciseRationale].join(" ").toLowerCase();
  if (!text.trim()) return true;
  const polishSignals = /[ąćęłńóśźż]/.test(text) || /\b(ale|oraz|jest|są|brak|cel|sesj|zgodn|trafn|opis|widoczn|najsiln)\w*\b/.test(text);
  const englishSignals = /\b(the|and|this|that|with|from|target|session|evidence|match|miss|strongest|structure|structural|color|unsupported|substantial|correspondence)\b/.test(text);
  return language === "pl" ? polishSignals || !englishSignals : englishSignals || !polishSignals;
}

export { computeJudgeTotal };
