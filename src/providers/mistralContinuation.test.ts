import { describe, expect, it } from "vitest";
import fixture from "./continuation-fixtures/mistral-assistant-content.json";
import { captureMistralContinuationState, validateMistralReplayForRequest } from "./mistralContinuation";
import type { ProviderConfig } from "./types";

const endpoint = "https://api.mistral.ai/v1";
const config: ProviderConfig = {
  id: "mistral-pc",
  provider: "mistral",
  label: "Mistral",
  credentialId: "mistral-cred",
  enabled: true,
  createdAt: "2026-10-19T00:00:00.000Z",
  updatedAt: "2026-10-19T00:00:00.000Z",
};
const content = () => structuredClone(fixture.providerResponse.choices[0].message.content) as unknown[];

describe("DIRECT-1B Mistral native replay", () => {
  it("captures the complete assistant content chunks, including thinking and visible text", () => {
    const captured = captureMistralContinuationState({
      config,
      requestedModelId: "mistral-large-latest",
      normalizedEndpoint: endpoint,
      content: content(),
      visibleContent: "final",
    });
    expect(captured.issue).toBeUndefined();
    expect(captured.state?.transport).toBe("mistral-native");
    expect(captured.state && captured.state.transport === "mistral-native" ? captured.state.content : []).toEqual(fixture.continuationState.content);
    expect(captured.state && captured.state.transport === "mistral-native" ? captured.state.content : []).toEqual(fixture.nextRequest.messages[1].content);
  });

  it("rejects replay after credential, endpoint or requested model identity changes", () => {
    const captured = captureMistralContinuationState({ config, requestedModelId: "mistral-large-latest", normalizedEndpoint: endpoint, content: content(), visibleContent: "final" });
    if (!captured.state) throw new Error("Expected Mistral continuation fixture state.");
    expect(validateMistralReplayForRequest({ state: captured.state, config, requestedModelId: "mistral-large-latest", normalizedEndpoint: endpoint })).toMatchObject({ ok: true });
    expect(validateMistralReplayForRequest({ state: captured.state, config: { ...config, credentialId: "other" }, requestedModelId: "mistral-large-latest", normalizedEndpoint: endpoint })).toMatchObject({ ok: false });
    expect(validateMistralReplayForRequest({ state: captured.state, config, requestedModelId: "mistral-small-latest", normalizedEndpoint: endpoint })).toMatchObject({ ok: false });
    expect(validateMistralReplayForRequest({ state: captured.state, config, requestedModelId: "mistral-large-latest", normalizedEndpoint: "https://example.invalid/v1" })).toMatchObject({ ok: false });
  });

  it("fails closed if full replay chunks no longer reproduce the visible assistant text", () => {
    expect(captureMistralContinuationState({
      config,
      requestedModelId: "mistral-large-latest",
      normalizedEndpoint: endpoint,
      content: content(),
      visibleContent: "changed final",
    }).issue).toMatchObject({ code: "invalid_payload" });
  });

  it("rejects unknown Mistral chunk fields instead of passing them through", () => {
    const malformed = content() as Array<Record<string, unknown>>;
    malformed[0].futureField = "nope";
    expect(captureMistralContinuationState({ config, requestedModelId: "mistral-large-latest", normalizedEndpoint: endpoint, content: malformed, visibleContent: "final" }).issue).toMatchObject({ code: "invalid_payload" });
  });
});
