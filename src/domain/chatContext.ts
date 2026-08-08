import type { ChatMode } from "../types";

export type ModelMessageRole = "system" | "user" | "assistant";

export interface ScopedChatMessage {
  id: string;
  scope: ChatMode;
  role: Exclude<ModelMessageRole, "system">;
  content: string;
}

export interface ModelMessage {
  role: ModelMessageRole;
  content: string;
}

interface ConversationPayloadInput {
  systemPrompt: string;
  history: ScopedChatMessage[];
  currentUserMessage: string;
}

interface ManualRvPayloadInput {
  history: ScopedChatMessage[];
  currentUserMessage: string;
  explicitSystemInstruction?: string;
  attachedProtocol?: string;
}

export function buildConversationPayload({
  systemPrompt,
  history,
  currentUserMessage,
}: ConversationPayloadInput): ModelMessage[] {
  const conversationHistory = history
    .filter((message) => message.scope === "conversation")
    .map(({ role, content }) => ({ role, content }));

  return [
    { role: "system", content: systemPrompt },
    ...conversationHistory,
    { role: "user", content: currentUserMessage },
  ];
}

export function buildManualRvPayload({
  history,
  currentUserMessage,
  explicitSystemInstruction,
  attachedProtocol,
}: ManualRvPayloadInput): ModelMessage[] {
  const payload: ModelMessage[] = [];

  if (explicitSystemInstruction?.trim()) {
    payload.push({ role: "system", content: explicitSystemInstruction.trim() });
  }

  if (attachedProtocol?.trim()) {
    payload.push({
      role: "user",
      content: `[EXPLICITLY ATTACHED RV PROTOCOL]\n${attachedProtocol.trim()}`,
    });
  }

  payload.push(
    ...history
      .filter((message) => message.scope === "manual_rv")
      .map(({ role, content }) => ({ role, content })),
  );
  payload.push({ role: "user", content: currentUserMessage });
  return payload;
}
