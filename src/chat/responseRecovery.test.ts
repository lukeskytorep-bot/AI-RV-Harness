// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserRepository } from "../storage/browserRepository";
import { retryChatTurn, sendChatTurn } from "./engine";
import { approveChatResponseRetry, chatResponseOperationState, endChatResponse, withChatResponseOperation } from "./responseRecovery";
import { loadPendingChatTurn, savePendingChatTurn } from "./pendingTurn";
import type { ProviderConfig, ProviderModel } from "../providers/types";

const provider: ProviderConfig = { id: "p", provider: "custom_openai", label: "Fixture", credentialId: "c", enabled: true, createdAt: "t", updatedAt: "t" };
const model: ProviderModel = { providerConfigId: "p", provider: "custom_openai", modelId: "m", route: "m", displayName: "M", pricing: {}, recommended: false, rawMetadata: {}, refreshedAt: "t", capabilities: { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: false, reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: false, confidence: "unknown" }, supportedParameters: ["max_tokens"], maxOutputTokens: 65536, contextTokens: 131072, source: "provider", capturedAt: "t" } };
beforeEach(() => localStorage.clear());
async function fixture(mode: "conversation" | "manual_rv" = "conversation") {
  const repository = new BrowserRepository();
  const thread = await repository.createChatThread("w", mode, "Fixture");
  const input = { repository, threadId: thread.id, providerConfig: provider, model, mode, language: "en" as const, content: "Target", requestedSettings: { maxOutputTokens: 16384 } };
  return { repository, input };
}
describe("S1 durable response recovery", () => {
  it.each(["conversation", "manual_rv"] as const)("%s rejects late response, preserves evidence, and only resumes after approval", async mode => {
    const { repository, input } = await fixture(mode);
    const controller = new AbortController();
    const chat = vi.fn(async () => { controller.abort(); return { content: "Late answer", usage: { totalTokens: 42 }, providerRequestId: "paid-request", finishReason: "stop" }; });
    await expect(sendChatTurn({ ...input, signal: controller.signal, chat })).rejects.toMatchObject({ name: "AbortError" });
    const stored = await new BrowserRepository().listChatMessages(input.threadId);
    expect(stored.map(message => message.role)).toEqual(["user"]);
    expect(stored[0].metadata?.responseRecovery).toMatchObject({ state: "uncertain", attempts: [{ dispatched: true, outcome: "uncertain", lateResponse: { content: "Late answer", usage: { totalTokens: 42 }, providerRequestId: "paid-request" } }] });
    const recoveryChat = vi.fn(async () => ({ content: "Accepted", usage: {} }));
    await expect(retryChatTurn({ ...input, chat: recoveryChat })).rejects.toThrow(/approval/);
    expect(recoveryChat).not.toHaveBeenCalled();
    await approveChatResponseRetry(repository, input.threadId);
    await retryChatTurn({ ...input, chat: recoveryChat });
    const resumed = await repository.listChatMessages(input.threadId);
    expect(resumed.map(message => message.role)).toEqual(["user", "assistant"]);
    expect(resumed[0].metadata?.responseRecovery?.attempts).toHaveLength(2);
    expect(resumed[0].metadata?.responseRecovery?.attempts[0]).toEqual(stored[0].metadata?.responseRecovery?.attempts[0]);
  });
  it("pre-aborted signal stores no turn and buys no attempt", async () => {
    const { repository, input } = await fixture(); const controller = new AbortController(); controller.abort(); const chat = vi.fn();
    await expect(sendChatTurn({ ...input, signal: controller.signal, chat })).rejects.toMatchObject({ name: "AbortError" });
    expect(await repository.listChatMessages(input.threadId)).toEqual([]); expect(chat).not.toHaveBeenCalled();
  });
  it("End survives restart, blocks direct retry/approval, and permits a new message", async () => {
    const { repository, input } = await fixture();
    await repository.appendChatMessage(input.threadId, "user", input.content);
    savePendingChatTurn({ ...input, providerConfigId: "p", modelId: "m", sourceIds: [], images: [], imageNames: [], createdAt: "old" });
    await endChatResponse(repository, input.threadId);
    const restarted = new BrowserRepository(); const old = await restarted.listChatMessages(input.threadId);
    expect(loadPendingChatTurn(input.threadId, old)).toBeNull();
    const chat = vi.fn(async () => ({ content: "New answer", usage: {} }));
    await expect(retryChatTurn({ ...input, repository: restarted, chat })).rejects.toThrow(/ended/);
    await expect(approveChatResponseRetry(restarted, input.threadId)).rejects.toThrow(/ended/);
    expect(chat).not.toHaveBeenCalled();
    await endChatResponse(restarted, input.threadId);
    await sendChatTurn({ ...input, repository: restarted, content: "New question", chat });
    const messages = await restarted.listChatMessages(input.threadId);
    expect(messages.map(message => message.content)).toEqual(["Target", "New question", "New answer"]);
    expect(messages[0]).toEqual(old[0]);
  });
  it("End never converts uncertain to failed or buys another call", async () => {
    const { repository, input } = await fixture(); const controller = new AbortController();
    const chat = vi.fn(async () => { controller.abort(); throw new DOMException("cancelled", "AbortError"); });
    await expect(sendChatTurn({ ...input, signal: controller.signal, chat })).rejects.toThrow();
    const before = (await repository.listChatMessages(input.threadId))[0];
    await endChatResponse(repository, input.threadId);
    const after = (await repository.listChatMessages(input.threadId))[0];
    expect(after.metadata?.responseRecovery?.attempts).toEqual(before.metadata?.responseRecovery?.attempts);
    expect(after.metadata?.responseRecovery?.state).toBe("ended"); expect(chat).toHaveBeenCalledTimes(1);
  });
  it("excludes double execution and End until the active task settles", async () => {
    const { repository, input } = await fixture(); let finish!: () => void;
    const hold = withChatResponseOperation(input.threadId, () => new Promise<void>(resolve => { finish = resolve; }));
    await expect(sendChatTurn({ ...input, chat: vi.fn() })).rejects.toThrow(/another window/);
    await expect(endChatResponse(repository, input.threadId)).rejects.toThrow(/another window/);
    finish(); await hold;
    await repository.appendChatMessage(input.threadId, "user", "Target"); await endChatResponse(repository, input.threadId);
  });
  it("does not silently retry image-free after restart", async () => {
    const { repository, input } = await fixture(); await repository.appendChatMessage(input.threadId, "user", "Target"); const chat = vi.fn(async () => ({ content: "Answer", usage: {} }));
    await expect(retryChatTurn({ ...input, imageNames: ["image.png"], images: [], chat })).rejects.toThrow(/image-free/);
    expect(chat).not.toHaveBeenCalled();
    await retryChatTurn({ ...input, imageNames: ["image.png"], images: [], allowRetryWithoutImages: true, chat });
    expect(chat).toHaveBeenCalledTimes(1);
  });
  it("persists Manual RV incomplete evidence and stops before semantic recovery", async () => {
    const { repository, input } = await fixture("manual_rv"); const controller = new AbortController();
    const original = repository.updateChatMessageMetadata.bind(repository);
    vi.spyOn(repository, "updateChatMessageMetadata").mockImplementation(async (id, metadata) => { await original(id, metadata); if (metadata?.viewerOutputAttempts?.length) controller.abort(); });
    const chat = vi.fn(async () => ({ content: "partial", finishReason: "length", usage: { totalTokens: 8 } }));
    await expect(sendChatTurn({ ...input, signal: controller.signal, chat })).rejects.toThrow();
    expect(chat).toHaveBeenCalledTimes(1);
    const stored = (await repository.listChatMessages(input.threadId))[0];
    expect(stored.metadata?.viewerOutputAttempts).toHaveLength(1);
    expect((await repository.listChatMessages(input.threadId)).filter(message => message.role === "assistant")).toHaveLength(0);
  });
});

it("S1 another Web Lock owner blocks execution and End", async () => {
  const { repository, input } = await fixture(); await repository.appendChatMessage(input.threadId, "user", "Target");
  const before = await repository.listChatMessages(input.threadId); const chat = vi.fn();
  vi.stubGlobal("navigator", { locks: { request: async (_name: string, _options: unknown, callback: (lock: null) => Promise<unknown>) => callback(null) } });
  try {
    await expect(sendChatTurn({ ...input, chat })).rejects.toThrow(/another window/);
    await expect(endChatResponse(repository, input.threadId)).rejects.toThrow(/another window/);
    expect(await repository.listChatMessages(input.threadId)).toEqual(before); expect(chat).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});

it("S1 ownership query reports another window and fails closed on query error", async () => {
  vi.stubGlobal("navigator", { locks: { query: async () => ({ held: [{ name: "rvh-chat-response:thread" }] }) } });
  try {
    expect(await chatResponseOperationState("thread")).toBe("other");
    expect(await chatResponseOperationState("another")).toBe("idle");
    vi.stubGlobal("navigator", { locks: { query: async () => { throw new Error("unavailable"); } } });
    expect(await chatResponseOperationState("thread")).toBe("unknown");
  } finally { vi.unstubAllGlobals(); }
});
