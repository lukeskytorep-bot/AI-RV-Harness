export const CONTINUATION_CONTRACT_VERSION = 1 as const;

export const CONTINUATION_LIMITS_V1 = Object.freeze({
  maxBlocksPerMessage: 64,
  maxBlockBytes: 512 * 1024,
  maxStateBytes: 2 * 1024 * 1024,
  maxRequestStateBytes: 8 * 1024 * 1024,
  maxIdentifierChars: 512,
  maxEndpointChars: 2048,
  maxTraversalDepth: 128,
  maxTraversalNodes: 10_000,
});

export type ProviderContinuationTransport = "openrouter" | "google-native" | "anthropic-native";

export type OpenRouterReasoningFormat =
  | "unknown"
  | "openai-responses-v1"
  | "azure-openai-responses-v1"
  | "bedrock-openai-responses-v1"
  | "bedrock-xai-responses-v1"
  | "xai-responses-v1"
  | "meta-responses-v1"
  | "anthropic-claude-v1"
  | "google-gemini-v1";

export interface ProviderReplayFingerprint {
  transport: ProviderContinuationTransport;
  normalizedEndpoint: string;
  providerConfigId: string;
  credentialId: string;
  requestedModelId: string;
  actualModelId?: string;
  stateFormat: string;
  stateFormatVersion: number;
}

interface OpenRouterReasoningCommon {
  id: string | null;
  format: OpenRouterReasoningFormat;
  index?: number;
}

export interface OpenRouterReasoningSummary extends OpenRouterReasoningCommon {
  type: "reasoning.summary";
  summary: string;
}

export interface OpenRouterReasoningEncrypted extends OpenRouterReasoningCommon {
  type: "reasoning.encrypted";
  data: string;
}

export interface OpenRouterReasoningText extends OpenRouterReasoningCommon {
  type: "reasoning.text";
  text: string;
  signature?: string | null;
}

export type OpenRouterReasoningDetail =
  | OpenRouterReasoningSummary
  | OpenRouterReasoningEncrypted
  | OpenRouterReasoningText;

/**
 * ProviderMessage v1 contracts only REST generateContent text/thought parts.
 * Function/tool parts remain outside the v1 message model; GOOGLE-CONTINUITY-1
 * activates replay only for this verified text/thought subset.
 */
export interface GoogleThoughtPart {
  text: string;
  thought?: boolean;
  thoughtSignature?: string;
}

export type AnthropicThinkingBlock =
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "redacted_thinking"; data: string };

export type ProviderContinuationState =
  | {
      schemaVersion: 1;
      transport: "openrouter";
      format: "openrouter-reasoning-details";
      replayFingerprint: ProviderReplayFingerprint;
      reasoningDetails: OpenRouterReasoningDetail[];
    }
  | {
      schemaVersion: 1;
      transport: "google-native";
      format: "google-thought-parts";
      replayFingerprint: ProviderReplayFingerprint;
      parts: GoogleThoughtPart[];
    }
  | {
      schemaVersion: 1;
      transport: "anthropic-native";
      format: "anthropic-thinking-blocks";
      replayFingerprint: ProviderReplayFingerprint;
      blocks: AnthropicThinkingBlock[];
    };

export type ContinuationValidationCode =
  | "not_object"
  | "forbidden_sensitive_field"
  | "unknown_schema_version"
  | "unknown_transport"
  | "unknown_format"
  | "invalid_fingerprint"
  | "invalid_payload"
  | "too_many_blocks"
  | "block_too_large"
  | "state_too_large"
  | "request_state_too_large";

export type ContinuationValidationResult =
  | { ok: true; value: ProviderContinuationState; sizeBytes: number }
  | { ok: false; code: ContinuationValidationCode; message: string };

export type ContinuationBudgetValidationResult =
  | { ok: true; totalSizeBytes: number }
  | { ok: false; code: ContinuationValidationCode; message: string };

const OR_FORMATS = new Set<OpenRouterReasoningFormat>([
  "unknown",
  "openai-responses-v1",
  "azure-openai-responses-v1",
  "bedrock-openai-responses-v1",
  "bedrock-xai-responses-v1",
  "xai-responses-v1",
  "meta-responses-v1",
  "anthropic-claude-v1",
  "google-gemini-v1",
]);

const FORBIDDEN_KEYS = new Set([
  "authorization",
  "headers",
  "api_key",
  "apiKey",
  "secret",
  "requestHeaders",
  "responseHeaders",
  "rawResponse",
  "fullResponse",
  "debugPayload",
  "cookie",
  "setCookie",
]);

const safeUtf8Bytes = (value: unknown): number | null => {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) return null;
    return new TextEncoder().encode(encoded).byteLength;
  } catch {
    return null;
  }
};
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean => {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
};
const nonEmptyString = (value: unknown, max: number = CONTINUATION_LIMITS_V1.maxIdentifierChars): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;
const optionalString = (value: unknown, max: number = CONTINUATION_LIMITS_V1.maxIdentifierChars): value is string | undefined =>
  value === undefined || nonEmptyString(value, max);
const nullableId = (value: unknown): value is string | null => value === null || nonEmptyString(value);
const optionalIndex = (value: unknown): value is number | undefined => value === undefined || (Number.isInteger(value) && (value as number) >= 0);
const canonicalBase64 = (value: string): boolean => {
  if (value.length === 0 || value.length % 4 !== 0) return false;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return false;
  const paddingIndex = value.indexOf("=");
  return paddingIndex === -1 || paddingIndex >= value.length - 2;
};

function scanSensitiveStructure(value: unknown): "ok" | "forbidden" | "invalid" {
  type Frame =
    | { kind: "enter"; value: unknown; depth: number }
    | { kind: "leave"; value: object };

  const stack: Frame[] = [{ kind: "enter", value, depth: 0 }];
  const activePath = new WeakSet<object>();
  let visited = 0;

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.kind === "leave") {
      activePath.delete(current.value);
      continue;
    }

    visited += 1;
    if (visited > CONTINUATION_LIMITS_V1.maxTraversalNodes || current.depth > CONTINUATION_LIMITS_V1.maxTraversalDepth) {
      return "invalid";
    }

    const candidate = current.value;
    if (typeof candidate !== "object" || candidate === null) continue;
    if (activePath.has(candidate)) return "invalid";
    activePath.add(candidate);
    stack.push({ kind: "leave", value: candidate });

    if (Array.isArray(candidate)) {
      for (let index = candidate.length - 1; index >= 0; index -= 1) {
        stack.push({ kind: "enter", value: candidate[index], depth: current.depth + 1 });
      }
      continue;
    }

    let entries: Array<[string, unknown]>;
    try {
      entries = Object.entries(candidate as Record<string, unknown>);
    } catch {
      return "invalid";
    }
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, child] = entries[index];
      if (FORBIDDEN_KEYS.has(key)) return "forbidden";
      stack.push({ kind: "enter", value: child, depth: current.depth + 1 });
    }
  }
  return "ok";
}


function validateFingerprint(
  value: unknown,
  expectedTransport: ProviderContinuationTransport,
  expectedFormat: string,
): ProviderReplayFingerprint | null {
  if (!isObject(value)) return null;
  if (!exactKeys(value, [
    "transport",
    "normalizedEndpoint",
    "providerConfigId",
    "credentialId",
    "requestedModelId",
    "actualModelId",
    "stateFormat",
    "stateFormatVersion",
  ])) return null;
  if (value.transport !== expectedTransport || value.stateFormat !== expectedFormat || value.stateFormatVersion !== 1) return null;
  if (!nonEmptyString(value.normalizedEndpoint, CONTINUATION_LIMITS_V1.maxEndpointChars)) return null;
  if (value.normalizedEndpoint.endsWith("/")) return null;
  let parsed: URL;
  try {
    parsed = new URL(value.normalizedEndpoint);
  } catch {
    return null;
  }
  const isLocalHttp = parsed.protocol === "http:" && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !isLocalHttp) return null;
  if (parsed.username || parsed.password) return null;
  if (!nonEmptyString(value.providerConfigId) || !nonEmptyString(value.credentialId) || !nonEmptyString(value.requestedModelId)) return null;
  if (!optionalString(value.actualModelId)) return null;
  return {
    transport: expectedTransport,
    normalizedEndpoint: value.normalizedEndpoint,
    providerConfigId: value.providerConfigId,
    credentialId: value.credentialId,
    requestedModelId: value.requestedModelId,
    ...(value.actualModelId ? { actualModelId: value.actualModelId } : {}),
    stateFormat: expectedFormat,
    stateFormatVersion: 1,
  };
}

function validateBlockCountAndSize(blocks: unknown[]): ContinuationValidationResult | null {
  if (blocks.length > CONTINUATION_LIMITS_V1.maxBlocksPerMessage) {
    return { ok: false, code: "too_many_blocks", message: "continuation state exceeds the v1 block count limit" };
  }
  for (const block of blocks) {
    const blockBytes = safeUtf8Bytes(block);
    if (blockBytes === null) {
      return { ok: false, code: "invalid_payload", message: "continuation state contains a non-serializable block" };
    }
    if (blockBytes > CONTINUATION_LIMITS_V1.maxBlockBytes) {
      return { ok: false, code: "block_too_large", message: "continuation state contains an oversized block" };
    }
  }
  return null;
}

function parseOpenRouterDetail(value: unknown): OpenRouterReasoningDetail | null {
  if (!isObject(value) || typeof value.type !== "string") return null;
  const commonOk = nullableId(value.id)
    && typeof value.format === "string"
    && OR_FORMATS.has(value.format as OpenRouterReasoningFormat)
    && optionalIndex(value.index);
  if (!commonOk) return null;
  const common = {
    id: value.id as string | null,
    format: value.format as OpenRouterReasoningFormat,
    ...(value.index === undefined ? {} : { index: value.index as number }),
  };
  if (value.type === "reasoning.summary") {
    if (!exactKeys(value, ["type", "summary", "id", "format", "index"]) || typeof value.summary !== "string") return null;
    return { type: "reasoning.summary", summary: value.summary, ...common };
  }
  if (value.type === "reasoning.encrypted") {
    if (!exactKeys(value, ["type", "data", "id", "format", "index"]) || !nonEmptyString(value.data, CONTINUATION_LIMITS_V1.maxBlockBytes)) return null;
    return { type: "reasoning.encrypted", data: value.data, ...common };
  }
  if (value.type === "reasoning.text") {
    if (!exactKeys(value, ["type", "text", "signature", "id", "format", "index"]) || typeof value.text !== "string") return null;
    if (value.signature !== undefined && value.signature !== null && !nonEmptyString(value.signature, CONTINUATION_LIMITS_V1.maxBlockBytes)) return null;
    return { type: "reasoning.text", text: value.text, ...(value.signature === undefined ? {} : { signature: value.signature as string | null }), ...common };
  }
  return null;
}

function parseGooglePart(value: unknown): GoogleThoughtPart | null {
  if (!isObject(value) || !exactKeys(value, ["text", "thought", "thoughtSignature"])) return null;
  if (typeof value.text !== "string") return null;
  if (value.thought !== undefined && typeof value.thought !== "boolean") return null;
  if (value.thoughtSignature !== undefined) {
    if (!nonEmptyString(value.thoughtSignature, CONTINUATION_LIMITS_V1.maxBlockBytes) || !canonicalBase64(value.thoughtSignature)) return null;
  }
  return {
    text: value.text,
    ...(value.thought === undefined ? {} : { thought: value.thought }),
    ...(value.thoughtSignature === undefined ? {} : { thoughtSignature: value.thoughtSignature }),
  };
}

function parseAnthropicBlock(value: unknown): AnthropicThinkingBlock | null {
  if (!isObject(value) || typeof value.type !== "string") return null;
  if (value.type === "thinking") {
    if (!exactKeys(value, ["type", "thinking", "signature"]) || typeof value.thinking !== "string" || !nonEmptyString(value.signature, CONTINUATION_LIMITS_V1.maxBlockBytes)) return null;
    return { type: "thinking", thinking: value.thinking, signature: value.signature };
  }
  if (value.type === "redacted_thinking") {
    if (!exactKeys(value, ["type", "data"]) || !nonEmptyString(value.data, CONTINUATION_LIMITS_V1.maxBlockBytes)) return null;
    return { type: "redacted_thinking", data: value.data };
  }
  return null;
}

function validateProviderContinuationStateInternal(input: unknown): ContinuationValidationResult {
  if (!isObject(input)) return { ok: false, code: "not_object", message: "continuation state must be an object" };
  const structureScan = scanSensitiveStructure(input);
  if (structureScan === "forbidden") return { ok: false, code: "forbidden_sensitive_field", message: "continuation state contains a forbidden sensitive field" };
  if (structureScan === "invalid") return { ok: false, code: "invalid_payload", message: "continuation state contains a cyclic, excessively deep, or otherwise unsupported structure" };
  if (input.schemaVersion !== 1) return { ok: false, code: "unknown_schema_version", message: "unsupported continuation state schema version" };
  if (input.transport !== "openrouter" && input.transport !== "google-native" && input.transport !== "anthropic-native") {
    return { ok: false, code: "unknown_transport", message: "unsupported continuation transport" };
  }

  let value: ProviderContinuationState | null = null;
  if (input.transport === "openrouter") {
    if (input.format !== "openrouter-reasoning-details") return { ok: false, code: "unknown_format", message: "unsupported OpenRouter continuation format" };
    if (!exactKeys(input, ["schemaVersion", "transport", "format", "replayFingerprint", "reasoningDetails"])) return { ok: false, code: "invalid_payload", message: "OpenRouter continuation state contains unapproved fields" };
    const fingerprint = validateFingerprint(input.replayFingerprint, "openrouter", input.format);
    if (!fingerprint) return { ok: false, code: "invalid_fingerprint", message: "invalid replay fingerprint" };
    if (!Array.isArray(input.reasoningDetails)) return { ok: false, code: "invalid_payload", message: "reasoningDetails must be an array" };
    const limitError = validateBlockCountAndSize(input.reasoningDetails); if (limitError) return limitError;
    const reasoningDetails = input.reasoningDetails.map(parseOpenRouterDetail);
    if (reasoningDetails.some((item) => item === null)) return { ok: false, code: "invalid_payload", message: "invalid OpenRouter reasoning detail" };
    value = { schemaVersion: 1, transport: "openrouter", format: "openrouter-reasoning-details", replayFingerprint: fingerprint, reasoningDetails: reasoningDetails as OpenRouterReasoningDetail[] };
  } else if (input.transport === "google-native") {
    if (input.format !== "google-thought-parts") return { ok: false, code: "unknown_format", message: "unsupported Google continuation format" };
    if (!exactKeys(input, ["schemaVersion", "transport", "format", "replayFingerprint", "parts"])) return { ok: false, code: "invalid_payload", message: "Google continuation state contains unapproved fields" };
    const fingerprint = validateFingerprint(input.replayFingerprint, "google-native", input.format);
    if (!fingerprint) return { ok: false, code: "invalid_fingerprint", message: "invalid replay fingerprint" };
    if (!Array.isArray(input.parts)) return { ok: false, code: "invalid_payload", message: "parts must be an array" };
    const limitError = validateBlockCountAndSize(input.parts); if (limitError) return limitError;
    const parts = input.parts.map(parseGooglePart);
    if (parts.some((item) => item === null)) return { ok: false, code: "invalid_payload", message: "invalid Google thought part" };
    const googleParts = parts as GoogleThoughtPart[];
    if (!googleParts.length || !googleParts.some((part) => part.thought === true || part.thoughtSignature !== undefined)) {
      return { ok: false, code: "invalid_payload", message: "Google continuation state contains no thought or thoughtSignature data" };
    }
    value = { schemaVersion: 1, transport: "google-native", format: "google-thought-parts", replayFingerprint: fingerprint, parts: googleParts };
  } else {
    if (input.format !== "anthropic-thinking-blocks") return { ok: false, code: "unknown_format", message: "unsupported Anthropic continuation format" };
    if (!exactKeys(input, ["schemaVersion", "transport", "format", "replayFingerprint", "blocks"])) return { ok: false, code: "invalid_payload", message: "Anthropic continuation state contains unapproved fields" };
    const fingerprint = validateFingerprint(input.replayFingerprint, "anthropic-native", input.format);
    if (!fingerprint) return { ok: false, code: "invalid_fingerprint", message: "invalid replay fingerprint" };
    if (!Array.isArray(input.blocks)) return { ok: false, code: "invalid_payload", message: "blocks must be an array" };
    const limitError = validateBlockCountAndSize(input.blocks); if (limitError) return limitError;
    const blocks = input.blocks.map(parseAnthropicBlock);
    if (!blocks.length || blocks.some((item) => item === null)) return { ok: false, code: "invalid_payload", message: "invalid Anthropic thinking block" };
    value = { schemaVersion: 1, transport: "anthropic-native", format: "anthropic-thinking-blocks", replayFingerprint: fingerprint, blocks: blocks as AnthropicThinkingBlock[] };
  }

  const sizeBytes = safeUtf8Bytes(value);
  if (sizeBytes === null) return { ok: false, code: "invalid_payload", message: "continuation state cannot be serialized safely" };
  if (sizeBytes > CONTINUATION_LIMITS_V1.maxStateBytes) return { ok: false, code: "state_too_large", message: "continuation state exceeds the per-message byte limit" };
  return { ok: true, value, sizeBytes };
}

export function validateProviderContinuationState(input: unknown): ContinuationValidationResult {
  try {
    return validateProviderContinuationStateInternal(input);
  } catch {
    return { ok: false, code: "invalid_payload", message: "continuation state validation failed closed" };
  }
}

export function validateContinuationRequestBudget(states: readonly ProviderContinuationState[]): ContinuationBudgetValidationResult {
  let total = 0;
  for (const state of states) {
    const checked = validateProviderContinuationState(state);
    if (!checked.ok) return checked;
    total += checked.sizeBytes;
    if (total > CONTINUATION_LIMITS_V1.maxRequestStateBytes) {
      return { ok: false, code: "request_state_too_large", message: "continuation states exceed the per-request byte limit" };
    }
  }
  return { ok: true, totalSizeBytes: total };
}

export function replayFingerprintsCompatible(a: ProviderReplayFingerprint, b: ProviderReplayFingerprint): boolean {
  return a.transport === b.transport
    && a.normalizedEndpoint === b.normalizedEndpoint
    && a.providerConfigId === b.providerConfigId
    && a.credentialId === b.credentialId
    && a.requestedModelId === b.requestedModelId
    && a.stateFormat === b.stateFormat
    && a.stateFormatVersion === b.stateFormatVersion;
}
