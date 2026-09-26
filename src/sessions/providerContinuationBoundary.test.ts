import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (relative: string) => fs.readFileSync(path.resolve(process.cwd(), relative), "utf8");

describe("provider continuation workflow boundary", () => {
  it("keeps C5 continuation persistence on schema 025 and activates Anthropic only through frozen append-only Session routes", () => {
    const migrations = read("src-tauri/src/migrations.rs");
    const sessionBridge = read("src/sessions/providerContinuation.ts");
    expect(migrations).toContain("version: 25");
    expect(migrations).toContain("version: 26");
    expect(sessionBridge).toContain("captureOpenRouterContinuationState");
    expect(sessionBridge).toContain("captureGoogleContinuationState");
    expect(sessionBridge).toContain("google-thought-parts");
    expect(sessionBridge).toContain("captureAnthropicContinuationState");
    expect(sessionBridge).toContain("anthropic-thinking-blocks");
    expect(sessionBridge).toContain('prefixPolicy: "append-only"');
  });

  it("freezes provider continuation identity in SessionSnapshot and reuses only that route on Resume", () => {
    const types = read("src/sessions/types.ts");
    const panel = read("src/features/rvSessions/RvSessionPanel.tsx");
    const replay = read("src/sessions/resumeReplay.ts");
    expect(types).toContain("continuationRoute?: SessionContinuationRouteSnapshot");
    expect(types).toContain("schemaVersion: 1 | 2 | 3 | 4");
    expect(panel).toContain("resumeContinuationRoute: snapshot.continuationRoute");
    expect(replay).toContain("validateFrozenSessionContinuationRequest");
    expect(replay).toContain("hydrateSessionMessageContinuationForRequest");
    expect(read("src/sessions/providerContinuation.ts")).toContain("getSessionEventProviderState");
    expect(replay).toContain("isViewerRequest");
  });

  it("persists continuation state on exact assistant Session events across supported Viewer controllers", () => {
    for (const relative of [
      "src/sessions/controller.ts",
      "src/sessions/rvLiteController.ts",
      "src/sessions/customController.ts",
      "src/sessions/telepathicController.ts",
    ]) {
      const source = read(relative);
      expect(source, relative).toContain("persistSessionAssistantResponse");
      expect(source, relative).toContain("validateSessionContinuationBudget(messages)");
    }
    const bridge = read("src/sessions/providerContinuation.ts");
    expect(bridge).toContain("appendSessionEventWithProviderState");
    expect(bridge).toContain("Required provider continuation state is missing");
    expect(bridge).toContain("Persisted provider continuation state is incompatible with the frozen session route");
  });

  it("suppresses Anthropic signed state and stops before replay if output sanitization changes visible content", () => {
    const bridge = read("src/sessions/providerContinuation.ts");
    expect(bridge).toContain("requiresAnthropicContinuationStopAfterContentMutation");
    expect(bridge).toContain('route?.transport === "anthropic-native" && originalContent !== persistedContent');
    expect(bridge).toContain("ANTHROPIC_SANITIZED_TURN_AUTO_STOP_REASON");
    for (const relative of [
      "src/sessions/controller.ts",
      "src/sessions/rvLiteController.ts",
      "src/sessions/customController.ts",
      "src/sessions/telepathicController.ts",
    ]) {
      const source = read(relative);
      expect(source, relative).toContain("requiresAnthropicContinuationStopAfterContentMutation");
      expect(source, relative).toContain('code: "signed_turn_content_modified"');
      expect(source, relative).toContain("ANTHROPIC_SANITIZED_TURN_AUTO_STOP_REASON");
    }
  });

  it("keeps Training and Research on shared controllers rather than duplicating provider-state storage", () => {
    for (const relative of ["src/features/training/trainingExecution.ts", "src/research/engine.ts"]) {
      const source = read(relative);
      expect(source, relative).not.toContain("appendSessionEventWithProviderState");
      expect(source, relative).not.toContain("getSessionEventProviderState");
      expect(source, relative).not.toContain("captureOpenRouterContinuationState");
      expect(source, relative).not.toContain("captureGoogleContinuationState");
      expect(source, relative).not.toContain("captureAnthropicContinuationState");
    }
  });

  it("keeps post-Reveal state event-bound and ordinary exports free of continuation payloads", () => {
    const postReveal = read("src/sessions/postReveal.ts");
    const researchExport = read("src/exports/research.ts");
    const sessionExport = read("src/exports/session.ts");
    const trainingExport = read("src/training/export.ts");
    expect(postReveal).toContain("POST_REVEAL_ASSISTANT");
    expect(postReveal).toContain("getSessionEventProviderState");
    expect(postReveal).toContain("appendPostRevealTurnWithProviderState");
    expect(postReveal).toContain('status: "invalid"');
    expect(researchExport).toContain("continuationRoute: _continuationRoute");
    for (const source of [researchExport, sessionExport, trainingExport]) {
      expect(source).not.toContain("reasoningDetails");
      expect(source).not.toContain("session_event_provider_state");
    }
  });
});
