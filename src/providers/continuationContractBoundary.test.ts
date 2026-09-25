import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (relative: string) => fs.readFileSync(path.resolve(process.cwd(), relative), "utf8");

describe("provider continuation staged-delivery boundary", () => {
  it("keeps the strict continuation contract while allowing C2/C3 persistence", () => {
    const types = read("src/providers/types.ts");
    const contract = read("src/providers/continuationContract.ts");
    const persistence = read("src/storage/providerContinuationState.ts");
    const migrations = read("src-tauri/src/migrations.rs");
    expect(types).toContain("continuationState?: ProviderContinuationState");
    expect(contract).not.toContain("payload: unknown");
    expect(contract).not.toContain('format: "opaque"');
    expect(contract).not.toContain("reasoningMode");
    expect(persistence).toContain("validateProviderContinuationState");
    expect(migrations).toContain("version: 25");
    expect(migrations).toContain('025_provider_continuation_state.sql');
  });

  it("keeps C1 OpenRouter capture/replay active and provider debug payloads redacted", () => {
    const memory = read("src/chat/continuationMemory.ts");
    const rustProviders = read("src-tauri/src/providers.rs");
    const builders = read("src-tauri/src/providers/request_builders.rs");
    expect(memory).toContain("ConversationContinuationBreakError");
    expect(rustProviders).toContain("OpenRouterContinuationState");
    expect(builders).toContain('"reasoning_details"');
    expect(builders).not.toContain("google-thought-parts");
    expect(builders).not.toContain("anthropic-thinking-blocks");
    expect(rustProviders).toContain("[CONTINUATION STATE REDACTED]");
  });

  it("activates C3 through shared session controllers without duplicating persistence inside Training or Research", () => {
    const sessionController = read("src/sessions/controller.ts");
    const rvLite = read("src/sessions/rvLiteController.ts");
    const resume = read("src/sessions/resumeReplay.ts");
    const bridge = read("src/sessions/providerContinuation.ts");
    const training = read("src/features/training/trainingExecution.ts");
    const research = read("src/research/engine.ts");
    expect(sessionController).toContain("persistSessionAssistantResponse");
    expect(rvLite).toContain("persistSessionAssistantResponse");
    expect(resume).toContain("hydrateSessionMessageContinuationForRequest");
    expect(bridge).toContain("getSessionEventProviderState");
    for (const [name, source] of [["training", training], ["research", research]] as const) {
      expect(source, name).not.toContain("appendSessionEventWithProviderState");
      expect(source, name).not.toContain("getSessionEventProviderState");
    }
  });

  it("keeps Conversation fallback explicit", () => {
    const panel = read("src/features/conversations/ChatPanel.tsx");
    expect(panel).toContain("Kontynuuj tylko tekstowo");
    expect(panel).toContain("Continue text-only");
    expect(panel).toContain("allowTextOnlyContinuation");
  });

  it("keeps continuation state inside Conversation context preflight before provider dispatch", () => {
    const budget = read("src/chat/contextBudget.ts");
    const estimator = read("src/providers/inputTokenEstimate.ts");
    const engine = read("src/chat/engine.ts");
    const panel = read("src/features/conversations/ChatPanel.tsx");
    expect(budget).toContain("estimateProviderInputTokens");
    expect(estimator).toContain("message.continuationState");
    expect(estimator).toContain("estimatedContinuationTokens");
    const hydrateAt = engine.indexOf("await hydrateConversationContinuationPersistence({");
    const applyContinuationAt = engine.indexOf("messages = replay.messages");
    const contextBudgetAt = engine.indexOf("const budget = estimateContextBudget(");
    const providerDispatchAt = engine.indexOf("const response = await executeProviderChat({");
    expect(hydrateAt).toBeGreaterThan(-1);
    expect(applyContinuationAt).toBeGreaterThan(hydrateAt);
    expect(contextBudgetAt).toBeGreaterThan(applyContinuationAt);
    expect(providerDispatchAt).toBeGreaterThan(contextBudgetAt);
    expect(panel).toContain("estimateConversationContinuationMemoryBytes");
    expect(panel).toContain("additionalContinuationStateBytes");
  });
});
