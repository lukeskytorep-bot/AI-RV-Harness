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

export type JudgeRepository = Pick<
  AppRepository,
  "getReveal" | "getViewerEvidence" | "recordFrozenJudgeResult" | "listJudgeScores"
>;

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

  const [reveal, evidence, existing] = await Promise.all([
    input.repository.getReveal(input.sessionId),
    input.repository.getViewerEvidence(input.sessionId),
    input.repository.listJudgeScores(input.sessionId),
  ]);
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
    const maxOutputTokens = Math.min(judge.model.capabilities.maxOutputTokens ?? 2048, 2048);
    const settings = resolveGenerationSettings(judge.model.capabilities, { maxOutputTokens });
    if (settings.omitted.length) throw new Error(`Judge model does not support required generation settings: ${settings.omitted.join(", ")}`);

    // Each Judge gets a fresh two-message context. No Viewer/Monitor/model/research metadata is added here.
    const response = await chat({
      config: judge.providerConfig,
      modelId: judge.model.modelId,
      messages: [
        { role: "system", content: getJudgePrompt(input.language) },
        { role: "user", content: packetWire, ...(judgeImages.length ? { images: judgeImages } : {}) },
      ],
      settings,
    });
    const parsed = parseJudgeOutput(response.content);
    pending.push({ judge, parsed, judgeIndex: existing.length + index + 1 });
    input.onProgress?.(index + 1, input.judges.length);
  }

  // Freeze only after every requested Judge returned a valid response. Provider/JSON failures
  // therefore cannot leave an ordinary evaluation half-complete.
  for (const item of pending) {
    const judgeRunId = createId("judge");
    const record = await input.repository.recordFrozenJudgeResult(
      {
        id: judgeRunId,
        sessionId: input.sessionId,
        judgeIndex: item.judgeIndex,
        modelRoute: item.judge.model.route,
        rubricVersion: JUDGE_RUBRIC_VERSION,
        anonymousSessionId,
        packetHash,
      },
      {
        id: createId("judge_score"),
        judgeRunId,
        ...item.parsed.scores,
        narrative: item.parsed.narrative,
      },
    );
    scores.push(record);
  }

  return {
    anonymousSessionId,
    scores,
    aggregate: aggregateJudgeScores(scores),
  };
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

export { computeJudgeTotal };
