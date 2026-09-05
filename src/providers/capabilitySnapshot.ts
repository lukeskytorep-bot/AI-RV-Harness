import type { ModelCapabilities, ReasoningEffort } from "./types";

const REASONING_EFFORTS = new Set<ReasoningEffort>(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
const CONFIDENCE = new Set(["provider_metadata", "verified", "unknown"]);

export function parseModelCapabilitiesSnapshot(value: unknown): ModelCapabilities {
  if (!isRecord(value)
    || !stringArray(value.inputModalities)
    || !stringArray(value.outputModalities)
    || typeof value.supportsVision !== "boolean"
    || typeof value.supportsStreaming !== "boolean"
    || !stringArray(value.supportedParameters)
    || (value.source !== "provider" && value.source !== "compatibility")
    || typeof value.capturedAt !== "string"
    || !isRecord(value.reasoning)
    || typeof value.reasoning.supported !== "boolean"
    || !Array.isArray(value.reasoning.efforts)
    || !value.reasoning.efforts.every((effort) => typeof effort === "string" && REASONING_EFFORTS.has(effort as ReasoningEffort))
    || typeof value.reasoning.confidence !== "string"
    || !CONFIDENCE.has(value.reasoning.confidence)
    || !isRecord(value.temperature)
    || typeof value.temperature.supported !== "boolean"
    || typeof value.temperature.confidence !== "string"
    || !CONFIDENCE.has(value.temperature.confidence)) {
    throw new Error("The stored session capability snapshot is invalid or unsupported.");
  }
  return value as unknown as ModelCapabilities;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
