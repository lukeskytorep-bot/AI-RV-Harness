import { describe, expect, it } from "vitest";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import type { ChatMessage } from "../types";
import { sendChatTurn } from "./engine";

const provider: ProviderConfig = { id: "provider", provider: "openrouter", label: "OR", credentialId: "cred", enabled: true, createdAt: "x", updatedAt: "x" };
const model: ProviderModel = {
  providerConfigId: "provider", provider: "openrouter", modelId: "m", displayName: "M", route: "openrouter:m", recommended: false, rawMetadata: {}, refreshedAt: "x", pricing: {},
  capabilities: { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: false, confidence: "unknown" }, supportedParameters: ["max_tokens"], maxOutputTokens: 8192, source: "provider", capturedAt: "x" },
};

function repo(history: ChatMessage[]) {
  const stored = [...history];
  return {
    listChatMessages: async () => [...stored],
    appendChatMessage: async (threadId: string, role: "user" | "assistant", content: string) => {
      const message: ChatMessage = { id: `m${stored.length}`, threadId, role, content, createdAt: "x" };
      stored.push(message);
      return message;
    },
  };
}

describe("chat engine isolation", () => {
  it("Conversation sends the conversation system prompt", async () => {
    let packet = "";
    await sendChatTurn({ repository: repo([]), threadId: "c", mode: "conversation", language: "en", providerConfig: provider, model, content: "Hello", chat: async (request) => {
      packet = JSON.stringify(request.messages);
      return { content: "Hi", usage: {} };
    } });
    expect(packet).toContain("active conversation partner");
  });

  it("Manual RV sends no Conversation system prompt and only attaches RCP when explicitly requested", async () => {
    let packet = "";
    await sendChatTurn({ repository: repo([]), threadId: "r", mode: "manual_rv", language: "en", providerConfig: provider, model, content: "Start", chat: async (request) => {
      packet = JSON.stringify(request.messages);
      return { content: "Contact", usage: {} };
    } });
    expect(packet).not.toContain("active conversation partner");
    expect(packet).not.toContain("EXPLICITLY ATTACHED RV PROTOCOL");
    expect(JSON.parse(packet).some((message: { role: string }) => message.role === "system")).toBe(false);
  });

  it("Manual RV applies the Profile Viewer prompt and supported Profile generation defaults", async () => {
    const configurable: ProviderModel = {
      ...model,
      capabilities: {
        ...model.capabilities,
        reasoning: { supported: true, efforts: ["low", "high"], confidence: "provider_metadata" },
        temperature: { supported: true, min: 0, max: 2, confidence: "provider_metadata" },
        supportedParameters: ["reasoning", "temperature", "max_tokens"],
      },
    };
    let captured: Parameters<NonNullable<Parameters<typeof sendChatTurn>[0]["chat"]>>[0] | undefined;
    await sendChatTurn({
      repository: repo([]), threadId: "r", mode: "manual_rv", language: "en", providerConfig: provider, model: configurable, content: "Start",
      rvSystemPrompt: "FIXED PROFILE VIEWER PROMPT", requestedSettings: { reasoningEffort: "high", temperature: 0.9 },
      chat: async (request) => { captured = request; return { content: "Contact", usage: {} }; },
    });
    expect(captured?.messages[0]).toEqual({ role: "system", content: "FIXED PROFILE VIEWER PROMPT" });
    expect(captured?.settings.effective).toEqual({ reasoningEffort: "high", temperature: 0.9, maxOutputTokens: 4096 });
  });

  it("blocks an oversized selected Source before any provider call and never truncates it", async () => {
    const chat = async () => { throw new Error("provider must not be called"); };
    const tinyContextModel: ProviderModel = { ...model, capabilities: { ...model.capabilities, contextTokens: 100, maxOutputTokens: 50 } };
    await expect(sendChatTurn({ repository: repo([]), threadId: "c", mode: "conversation", language: "en", providerConfig: provider, model: tinyContextModel, content: "Question", sources: [{ id: "s", workspaceId: "w", sourceType: "text", displayName: "long.txt", content: "x".repeat(1000), contentHash: "h", metadata: {}, createdAt: "x" }], chat }))
      .rejects.toThrow("Selected sources exceed this model's available context.");
  });
});
