import { CONTINUATION_LIMITS_V1, validateContinuationRequestBudget, validateProviderContinuationState, type ContinuationValidationCode, type ProviderContinuationState } from "../providers/continuationContract";
import { validateGoogleReplayForRequest } from "../providers/googleContinuation";
import { validateOpenRouterReplayForRequest } from "../providers/openRouterContinuation";
import type { ProviderConfig, ProviderMessage } from "../providers/types";

export interface ConversationContinuationIssue {
  code: ContinuationValidationCode | "incompatible_replay";
  message: string;
}

export type ConversationContinuationMemoryEntry =
  | { kind: "state"; state: ProviderContinuationState }
  | { kind: "issue"; issue: ConversationContinuationIssue };

const memory = new Map<string, Map<string, ConversationContinuationMemoryEntry>>();
const persistenceHydrationSuppressed = new Set<string>();

function threadMemory(threadId: string): Map<string, ConversationContinuationMemoryEntry> {
  let entries = memory.get(threadId);
  if (!entries) {
    entries = new Map();
    memory.set(threadId, entries);
  }
  return entries;
}

export function rememberConversationContinuationState(threadId: string, messageId: string, state: ProviderContinuationState): void {
  threadMemory(threadId).set(messageId, { kind: "state", state: structuredClone(state) });
}

export function rememberConversationContinuationIssue(threadId: string, messageId: string, issue: ConversationContinuationIssue): void {
  threadMemory(threadId).set(messageId, { kind: "issue", issue: { ...issue } });
}

export function hasConversationContinuationMemory(threadId: string): boolean {
  return Boolean(memory.get(threadId)?.size);
}

export function clearConversationContinuationMemory(threadId: string): void {
  memory.delete(threadId);
}

export function shouldHydrateConversationContinuationPersistence(threadId: string): boolean {
  return !persistenceHydrationSuppressed.has(threadId);
}

export function suppressConversationContinuationPersistenceHydration(threadId: string): void {
  persistenceHydrationSuppressed.add(threadId);
}

export function estimateConversationContinuationMemoryBytes(threadId: string): number {
  const entries = memory.get(threadId);
  if (!entries?.size) return 0;
  let total = 0;
  for (const entry of entries.values()) {
    if (entry.kind !== "state") continue;
    const checked = validateProviderContinuationState(entry.state);
    total += checked.ok ? checked.sizeBytes : CONTINUATION_LIMITS_V1.maxStateBytes;
  }
  return total;
}

export function clearAllConversationContinuationMemoryForTests(): void {
  memory.clear();
  persistenceHydrationSuppressed.clear();
}

export class ConversationContinuationBreakError extends Error {
  readonly issue: ConversationContinuationIssue;
  readonly messageId: string;

  constructor(messageId: string, issue: ConversationContinuationIssue) {
    super(issue.message);
    this.name = "ConversationContinuationBreakError";
    this.issue = issue;
    this.messageId = messageId;
  }
}

export function applyConversationContinuationMemory(input: {
  threadId: string;
  messages: ProviderMessage[];
  config: ProviderConfig;
  requestedModelId: string;
  normalizedEndpoint: string;
  allowTextOnlyContinuation?: boolean;
}): { messages: ProviderMessage[]; textOnlyFallbackUsed: boolean } {
  const entries = memory.get(input.threadId);
  if (!entries?.size) return { messages: input.messages, textOnlyFallbackUsed: false };

  const states: ProviderContinuationState[] = [];
  let firstBreak: { messageId: string; issue: ConversationContinuationIssue } | undefined;
  const messages = input.messages.map((message) => {
    if (message.role !== "assistant" || !message.id) return message;
    const entry = entries.get(message.id);
    if (!entry) return message;
    if (entry.kind === "issue") {
      firstBreak ??= { messageId: message.id, issue: entry.issue };
      return message;
    }
    const compatible = entry.state.transport === "openrouter"
      ? validateOpenRouterReplayForRequest({
          state: entry.state,
          config: input.config,
          requestedModelId: input.requestedModelId,
          normalizedEndpoint: input.normalizedEndpoint,
        })
      : entry.state.transport === "google-native"
        ? validateGoogleReplayForRequest({
            state: entry.state,
            config: input.config,
            requestedModelId: input.requestedModelId,
            normalizedEndpoint: input.normalizedEndpoint,
          })
        : { ok: false as const, issue: { code: "incompatible_replay" as const, message: "continuation state belongs to a provider transport that is not active yet" } };
    if (compatible.ok === false) {
      firstBreak ??= { messageId: message.id, issue: compatible.issue };
      return message;
    }
    states.push(compatible.state);
    return { ...message, continuationState: structuredClone(compatible.state) };
  });

  if (!firstBreak) {
    const budget = validateContinuationRequestBudget(states);
    if (budget.ok === false) firstBreak = { messageId: "request", issue: { code: budget.code, message: budget.message } };
  }

  if (firstBreak) {
    if (!input.allowTextOnlyContinuation) throw new ConversationContinuationBreakError(firstBreak.messageId, firstBreak.issue);
    clearConversationContinuationMemory(input.threadId);
    return {
      messages: input.messages.map(({ continuationState: _state, ...message }) => message),
      textOnlyFallbackUsed: true,
    };
  }

  return { messages, textOnlyFallbackUsed: false };
}
