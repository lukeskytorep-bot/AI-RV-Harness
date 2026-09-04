import { describe, expect, it } from "vitest";

const sources = import.meta.glob<string>([
  "../chat/engine.ts",
  "../monitor/engine.ts",
  "../judge/engine.ts",
  "../aiCenter/viewerNotes.ts",
  "../sessions/{controller,rvLiteController,customController,telepathicController,postReveal}.ts",
  "../research/engine.ts",
  "../features/training/trainingExecution.ts",
], { eager: true, import: "default", query: "?raw" });

const bySuffix = (suffix: string) => {
  const entry = Object.entries(sources).find(([path]) => path.endsWith(suffix));
  if (!entry) throw new Error(`Missing inference-family source: ${suffix}`);
  return entry[1];
};

describe("central provider inference contract", () => {
  it.each([
    ["Conversation and Manual RV", "/chat/engine.ts", "executeProviderChat", "signal: input.signal", "configuredRetries: input.maxRetries"],
    ["AI Monitor", "/monitor/engine.ts", "executeProviderChat", "signal: input.signal", "configuredRetries: input.maxRetries"],
    ["AI Judge", "/judge/engine.ts", "executeProviderChat", "signal: input.signal", "configuredRetries: input.maxRetries"],
    ["Viewer Notes", "/aiCenter/viewerNotes.ts", "executeProviderChat", "signal: input.signal", "configuredRetries: input.maxRetries"],
    ["Full RCP", "/sessions/controller.ts", "createProviderChatExecutor", "signal: input.signal", "configuredRetries: maxRetries"],
    ["RV Lite", "/sessions/rvLiteController.ts", "createProviderChatExecutor", "signal: input.signal", "configuredRetries: maxRetries"],
    ["Custom Protocol", "/sessions/customController.ts", "createProviderChatExecutor", "signal: input.signal", "configuredRetries: maxRetries"],
    ["Telepathic and Resume", "/sessions/telepathicController.ts", "createProviderChatExecutor", "signal: input.signal", "configuredRetries: maxRetries"],
    ["post-Reveal", "/sessions/postReveal.ts", "executeProviderChat", "signal: input.signal", "configuredRetries: input.maxRetries"],
    ["Research", "/research/engine.ts", "runAutomaticRcpSession", "signal: input.signal", "runBlindJudging"],
    ["Training", "/features/training/trainingExecution.ts", "runAutomaticRvLiteSession", "signal: input.signal", "runBlindJudging"],
  ])("routes %s through the shared retry/cancellation contract", (_family, suffix, ...requirements) => {
    const source = bySuffix(suffix);
    for (const requirement of requirements) expect(source).toContain(requirement);
  });

  it("contains no legacy controller-owned transport retry helpers", () => {
    const production = Object.values(sources).join("\n");
    expect(production).not.toContain("shouldRetryProviderError");
    expect(production).not.toContain("waitBeforeProviderRetry");
  });
});
