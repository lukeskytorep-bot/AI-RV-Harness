import { sha256Text } from "../application/sha256";
import {
  CONTINUATION_LIMITS_V1,
  validateProviderContinuationState,
  type ContinuationValidationCode,
  type ProviderContinuationState,
  type ProviderReplayFingerprint,
} from "../providers/continuationContract";


export const BROWSER_CHAT_MESSAGE_PROVIDER_STATE_KEY = "rvh.dev.chat_message_provider_state";
const BROWSER_CHAT_MESSAGE_PROVIDER_STATE_RESET_PREFIX = "rvh.dev.chat_message_provider_state_reset.";
const BROWSER_CHAT_MESSAGE_PROVIDER_STATE_FRESH_PREFIX = "rvh.dev.chat_message_provider_state_fresh.";

export function browserChatMessageProviderStateResetKey(threadId: string): string {
  return `${BROWSER_CHAT_MESSAGE_PROVIDER_STATE_RESET_PREFIX}${threadId}`;
}

export function browserChatMessageProviderStateFreshKey(threadId: string): string {
  return `${BROWSER_CHAT_MESSAGE_PROVIDER_STATE_FRESH_PREFIX}${threadId}`;
}

export interface ProviderContinuationStateBinding {
  ownerId: string;
  format: ProviderContinuationState["format"];
  formatVersion: number;
  transport: ProviderContinuationState["transport"];
  replayFingerprint: ProviderReplayFingerprint;
  state: ProviderContinuationState;
  payloadSha256: string;
  payloadSizeBytes: number;
  createdAt: string;
}

export interface PreparedProviderContinuationState {
  format: ProviderContinuationState["format"];
  formatVersion: number;
  transport: ProviderContinuationState["transport"];
  replayFingerprintJson: string;
  payloadJson: string;
  payloadSha256: string;
  payloadSizeBytes: number;
}

export interface PersistedProviderContinuationStateRow {
  ownerId: string;
  format: string;
  formatVersion: number;
  transport: string;
  replayFingerprintJson: string;
  payloadJson: string;
  payloadSha256: string;
  payloadSizeBytes: number;
  createdAt: string;
}

export class ProviderContinuationPersistenceError extends Error {
  constructor(
    public readonly ownerId: string,
    public readonly code: ContinuationValidationCode | "persistence_integrity",
    message: string,
  ) {
    super(message);
    this.name = "ProviderContinuationPersistenceError";
  }
}

function utf8Size(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export async function prepareProviderContinuationState(state: ProviderContinuationState): Promise<PreparedProviderContinuationState> {
  const checked = validateProviderContinuationState(state);
  if (checked.ok === false) throw new ProviderContinuationPersistenceError("request", checked.code, checked.message);
  const payloadJson = JSON.stringify(checked.value);
  return {
    format: checked.value.format,
    formatVersion: checked.value.schemaVersion,
    transport: checked.value.transport,
    replayFingerprintJson: JSON.stringify(checked.value.replayFingerprint),
    payloadJson,
    payloadSha256: await sha256Text(payloadJson),
    payloadSizeBytes: checked.sizeBytes,
  };
}

export async function restoreProviderContinuationState(row: PersistedProviderContinuationStateRow): Promise<ProviderContinuationStateBinding> {
  if (
    typeof row.ownerId !== "string" || !row.ownerId
    || typeof row.format !== "string" || !row.format
    || !Number.isInteger(row.formatVersion) || row.formatVersion < 1
    || typeof row.transport !== "string" || !row.transport
    || typeof row.replayFingerprintJson !== "string"
    || typeof row.payloadJson !== "string"
    || typeof row.payloadSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(row.payloadSha256)
    || !Number.isInteger(row.payloadSizeBytes) || row.payloadSizeBytes < 0
    || typeof row.createdAt !== "string" || !row.createdAt
  ) {
    throw new ProviderContinuationPersistenceError(String(row.ownerId || "storage"), "persistence_integrity", "Persisted continuation state row is malformed.");
  }

  const rawSize = utf8Size(row.payloadJson);
  if (rawSize !== row.payloadSizeBytes) {
    throw new ProviderContinuationPersistenceError(row.ownerId, "persistence_integrity", "Persisted continuation state size check failed.");
  }
  if (rawSize > CONTINUATION_LIMITS_V1.maxStateBytes) {
    throw new ProviderContinuationPersistenceError(row.ownerId, "state_too_large", "Persisted continuation state exceeds the v1 per-message size limit.");
  }
  if (row.payloadSha256.toLowerCase() !== (await sha256Text(row.payloadJson)).toLowerCase()) {
    throw new ProviderContinuationPersistenceError(row.ownerId, "persistence_integrity", "Persisted continuation state hash check failed.");
  }

  let payload: unknown;
  let replayFingerprint: unknown;
  try {
    payload = JSON.parse(row.payloadJson);
    replayFingerprint = JSON.parse(row.replayFingerprintJson);
  } catch {
    throw new ProviderContinuationPersistenceError(row.ownerId, "persistence_integrity", "Persisted continuation state contains invalid JSON.");
  }

  const checked = validateProviderContinuationState(payload);
  if (checked.ok === false) throw new ProviderContinuationPersistenceError(row.ownerId, checked.code, checked.message);
  if (
    row.format !== checked.value.format
    || row.formatVersion !== checked.value.schemaVersion
    || row.transport !== checked.value.transport
  ) {
    throw new ProviderContinuationPersistenceError(row.ownerId, "persistence_integrity", "Persisted continuation state metadata does not match its payload.");
  }
  if (JSON.stringify(replayFingerprint) !== JSON.stringify(checked.value.replayFingerprint)) {
    throw new ProviderContinuationPersistenceError(row.ownerId, "persistence_integrity", "Persisted continuation fingerprint does not match its payload.");
  }
  if (row.payloadSizeBytes !== checked.sizeBytes) {
    throw new ProviderContinuationPersistenceError(row.ownerId, "persistence_integrity", "Persisted continuation state canonical size check failed.");
  }

  return {
    ownerId: row.ownerId,
    format: checked.value.format,
    formatVersion: checked.value.schemaVersion,
    transport: checked.value.transport,
    replayFingerprint: structuredClone(checked.value.replayFingerprint),
    state: structuredClone(checked.value),
    payloadSha256: row.payloadSha256.toLowerCase(),
    payloadSizeBytes: row.payloadSizeBytes,
    createdAt: row.createdAt,
  };
}
