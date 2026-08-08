import { buildConversationPayload, buildManualRvPayload, type ScopedChatMessage } from "../domain/chatContext";
import { resolveGenerationSettings } from "../providers/capabilities";
import { providerChat as nativeProviderChat } from "../providers/native";
import type { ProviderChatResponse, ProviderConfig, ProviderImageInput, ProviderMessage, ProviderModel } from "../providers/types";
import { getConversationPrompt } from "../resources/prompts/conversation";
import type { AppRepository } from "../storage/repository";
import type { ChatMessage, ChatMode, InterfaceLanguage } from "../types";
import type { WorkspaceSource } from "../sources/types";

type ChatRepository = Pick<AppRepository, "listChatMessages" | "appendChatMessage">;

export async function sendChatTurn(input: {
  repository: ChatRepository;
  threadId: string;
  mode: ChatMode;
  language: InterfaceLanguage;
  providerConfig: ProviderConfig;
  model: ProviderModel;
  content: string;
  attachedProtocol?: string;
  sources?: WorkspaceSource[];
  images?: ProviderImageInput[];
  chat?: (request: { config: ProviderConfig; modelId: string; messages: ProviderMessage[]; settings: ReturnType<typeof resolveGenerationSettings> }) => Promise<ProviderChatResponse>;
}): Promise<{ user: ChatMessage; assistant: ChatMessage; response: ProviderChatResponse }> {
  const content = input.content.trim();
  if (!content) throw new Error("Message cannot be empty.");
  if (input.model.providerConfigId !== input.providerConfig.id) throw new Error("Model/provider route mismatch.");

  const history = await input.repository.listChatMessages(input.threadId);
  const scopedHistory: ScopedChatMessage[] = history.map((message) => ({
    id: message.id,
    scope: input.mode,
    role: message.role,
    content: message.content,
  }));
  let messages: ProviderMessage[] = input.mode === "conversation"
    ? buildConversationPayload({
        systemPrompt: getConversationPrompt(input.language).content,
        history: scopedHistory,
        currentUserMessage: content,
      })
    : buildManualRvPayload({
        history: scopedHistory,
        currentUserMessage: content,
        attachedProtocol: input.attachedProtocol,
      });

  if (input.sources?.length) {
    const sourceMessages: ProviderMessage[] = input.sources.map((source, index) => ({
      role: "user",
      content: `[EXPLICIT WORKSPACE SOURCE ${index + 1}]\n${source.content}`,
    }));
    messages = [...messages.slice(0, -1), ...sourceMessages, messages.at(-1)!];
  }
  if (input.images?.length) {
    if (!input.model.capabilities.supportsVision || !input.model.capabilities.inputModalities.includes("image")) throw new Error("Selected model route does not advertise image input support.");
    messages = messages.map((message, index) => index === messages.length - 1 ? { ...message, images: input.images } : message);
  }

  const maxOutputTokens = Math.min(input.model.capabilities.maxOutputTokens ?? 4096, 4096);
  const estimatedInputTokens = estimateChatTokens(messages);
  if (input.model.capabilities.contextTokens && estimatedInputTokens + maxOutputTokens > input.model.capabilities.contextTokens) {
    throw new Error("Selected sources exceed this model's available context.");
  }
  const settings = resolveGenerationSettings(input.model.capabilities, { maxOutputTokens });
  const user = await input.repository.appendChatMessage(input.threadId, "user", content);
  const response = await (input.chat ?? nativeProviderChat)({
    config: input.providerConfig,
    modelId: input.model.modelId,
    messages,
    settings,
  });
  const assistant = await input.repository.appendChatMessage(input.threadId, "assistant", response.content);
  return { user, assistant, response };
}

export function estimateChatTokens(messages: ProviderMessage[]): number {
  return Math.ceil(messages.reduce((total, message) => total + message.content.length, 0) / 3.5) + messages.length * 4;
}
