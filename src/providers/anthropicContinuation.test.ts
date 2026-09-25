import { describe, expect, it } from "vitest";
import fixture from "./continuation-fixtures/anthropic-thinking-blocks.json";
import { captureAnthropicContinuationState, validateAnthropicReplayForRequest } from "./anthropicContinuation";
import type { ProviderConfig } from "./types";

const endpoint = "https://api.anthropic.com/v1";
const config: ProviderConfig = {
  id: "anthropic-pc",
  provider: "anthropic",
  label: "Anthropic",
  credentialId: "anthropic-cred",
  enabled: true,
  createdAt: "2026-09-25T00:00:00.000Z",
  updatedAt: "2026-09-25T00:00:00.000Z",
};

const fixtureBlocks = () => structuredClone(fixture.continuationState.blocks) as unknown[];

describe("Anthropic native continuation", () => {
  it("captures thinking and redacted_thinking blocks unchanged and ordered", () => {
    const captured = captureAnthropicContinuationState({ config, requestedModelId: "claude-sonnet-5", normalizedEndpoint: endpoint, blocks: fixtureBlocks() });
    expect(captured.issue).toBeUndefined();
    expect(captured.state?.transport).toBe("anthropic-native");
    expect(captured.state && captured.state.transport === "anthropic-native" ? captured.state.blocks : []).toEqual(fixture.continuationState.blocks);
  });

  it("replays only on the exact frozen Anthropic route", () => {
    const captured = captureAnthropicContinuationState({ config, requestedModelId: "claude-sonnet-5", normalizedEndpoint: endpoint, blocks: fixtureBlocks() });
    expect(captured.state).toBeTruthy();
    if (!captured.state) return;
    expect(validateAnthropicReplayForRequest({ state: captured.state, config, requestedModelId: "claude-sonnet-5", normalizedEndpoint: endpoint }).ok).toBe(true);
    expect(validateAnthropicReplayForRequest({ state: captured.state, config: { ...config, credentialId: "other" }, requestedModelId: "claude-sonnet-5", normalizedEndpoint: endpoint })).toMatchObject({ ok: false, issue: { code: "incompatible_replay" } });
  });

  it("rejects unknown thinking block shapes instead of passing them through", () => {
    const malformed = fixtureBlocks();
    (malformed[0] as Record<string, unknown>).futureField = "nope";
    expect(captureAnthropicContinuationState({ config, requestedModelId: "claude-sonnet-5", normalizedEndpoint: endpoint, blocks: malformed }).issue).toMatchObject({ code: "invalid_payload" });
  });
});
