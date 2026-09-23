import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const read = (relative: string) => fs.readFileSync(path.resolve(process.cwd(), relative), "utf8");

describe("OPENROUTER-CONTINUITY-IN-MEMORY-1 activation boundary", () => {
  it("keeps schema frozen and continuation persistence absent", () => {
    const migrationsPath = "src-tauri/src/migrations.rs";
    const migrationsHash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.resolve(process.cwd(), migrationsPath)))
      .digest("hex");
    expect(migrationsHash, migrationsPath).toBe(
      "e984345044a4a11f03a9c6655113592f97adb87b057cac2f647a6e84bf553731",
    );

    const repository = read("src/storage/repository.ts");
    expect(repository).not.toContain("ProviderContinuationState");
    expect(repository).not.toContain("chat_message_provider_state");
    expect(repository).not.toContain("session_event_provider_state");
    expect(repository).not.toContain("continuationState");
  });

  it("activates continuationState only for in-memory OpenRouter replay", () => {
    const types = read("src/providers/types.ts");
    const memory = read("src/chat/continuationMemory.ts");
    const rustProviders = read("src-tauri/src/providers.rs");
    const builders = read("src-tauri/src/providers/request_builders.rs");
    expect(types).toContain("continuationState?: ProviderContinuationState");
    expect(memory).toContain("ConversationContinuationBreakError");
    expect(rustProviders).toContain("OpenRouterContinuationState");
    expect(builders).toContain('"reasoning_details"');
    expect(builders).not.toContain("google-thought-parts");
    expect(builders).not.toContain("anthropic-thinking-blocks");
  });

  it("does not add persistence, session workflow replay, or schema 025", () => {
    const migrations = read("src-tauri/src/migrations.rs");
    const contract = read("src/providers/continuationContract.ts");
    const sessions = read("src/sessions/controller.ts");
    expect(migrations).not.toContain("version: 25");
    expect(contract).not.toContain("chat_message_provider_state");
    expect(contract).not.toContain("session_event_provider_state");
    expect(sessions).not.toContain("continuationState");
  });

  it("forbids a generic opaque or unknown-payload escape hatch", () => {
    const contract = read("src/providers/continuationContract.ts");
    expect(contract).not.toContain("payload: unknown");
    expect(contract).not.toContain('format: "opaque"');
  });

  it("keeps generic replay identity free of ambiguous reasoning mode semantics", () => {
    const contract = read("src/providers/continuationContract.ts");
    expect(contract).not.toContain("reasoningMode");
  });
  it("keeps Conversation fallback explicit and provider debug payloads free of continuation state", () => {
    const panel = read("src/features/conversations/ChatPanel.tsx");
    const rustProviders = read("src-tauri/src/providers.rs");
    expect(panel).toContain("Kontynuuj tylko tekstowo");
    expect(panel).toContain("Continue text-only");
    expect(panel).toContain("allowTextOnlyContinuation");
    expect(rustProviders).toContain("[CONTINUATION STATE REDACTED]");
  });

  it("keeps continuation state inside Conversation context preflight before provider dispatch", () => {
    const budget = read("src/chat/contextBudget.ts");
    const estimator = read("src/providers/inputTokenEstimate.ts");
    const engine = read("src/chat/engine.ts");
    const panel = read("src/features/conversations/ChatPanel.tsx");
    expect(budget).toContain("estimateProviderInputTokens");
    expect(estimator).toContain("message.continuationState");
    expect(estimator).toContain("estimatedContinuationTokens");
    const applyContinuationAt = engine.indexOf("messages = applyConversationContinuationMemory({");
    const contextBudgetAt = engine.indexOf("const budget = estimateContextBudget(");
    const providerDispatchAt = engine.indexOf("const response = await executeProviderChat({");
    expect(applyContinuationAt).toBeGreaterThan(-1);
    expect(contextBudgetAt).toBeGreaterThan(applyContinuationAt);
    expect(providerDispatchAt).toBeGreaterThan(contextBudgetAt);
    expect(panel).toContain("estimateConversationContinuationMemoryBytes");
    expect(panel).toContain("additionalContinuationStateBytes");
  });

});
