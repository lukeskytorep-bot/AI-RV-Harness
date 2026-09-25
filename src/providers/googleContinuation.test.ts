import { describe, expect, it } from "vitest";
import googleFixture from "./continuation-fixtures/google-thought-signature.json";
import { captureGoogleContinuationState, validateGoogleReplayForRequest } from "./googleContinuation";
import type { ProviderConfig } from "./types";

const config: ProviderConfig = {
  id: "provider-config-fixture",
  provider: "google",
  label: "Google fixture",
  credentialId: "credential-fixture",
  enabled: true,
  createdAt: "2026-09-25T00:00:00.000Z",
  updatedAt: "2026-09-25T00:00:00.000Z",
};
const endpoint = "https://generativelanguage.googleapis.com/v1beta";

function fixtureParts(): unknown[] {
  return structuredClone(googleFixture.providerResponse.candidates[0].content.parts);
}

describe("GOOGLE-CONTINUITY-1", () => {
  it("captures the exact text part and thoughtSignature observed from Google native", () => {
    const captured = captureGoogleContinuationState({ config, requestedModelId: "gemini-3.8-flash", normalizedEndpoint: endpoint, parts: fixtureParts() });
    expect(captured.issue).toBeUndefined();
    expect(captured.state?.transport).toBe("google-native");
    if (!captured.state) return;
    expect(captured.state.parts).toEqual(googleFixture.providerResponse.candidates[0].content.parts);
    expect(captured.state.parts).toEqual(googleFixture.nextRequest.contents[1].parts);
  });

  it("rejects replay after provider, credential, endpoint or model identity changes", () => {
    const captured = captureGoogleContinuationState({ config, requestedModelId: "gemini-3.8-flash", normalizedEndpoint: endpoint, parts: fixtureParts() });
    if (!captured.state) throw new Error("Expected Google continuation fixture state.");
    expect(validateGoogleReplayForRequest({ state: captured.state, config, requestedModelId: "gemini-3.8-flash", normalizedEndpoint: endpoint })).toMatchObject({ ok: true });
    expect(validateGoogleReplayForRequest({ state: captured.state, config: { ...config, credentialId: "other" }, requestedModelId: "gemini-3.8-flash", normalizedEndpoint: endpoint })).toMatchObject({ ok: false });
    expect(validateGoogleReplayForRequest({ state: captured.state, config, requestedModelId: "gemini-3.8-pro", normalizedEndpoint: endpoint })).toMatchObject({ ok: false });
    expect(validateGoogleReplayForRequest({ state: captured.state, config, requestedModelId: "gemini-3.8-flash", normalizedEndpoint: "https://example.invalid/v1beta" })).toMatchObject({ ok: false });
  });

  it("fails closed when a returned Google signed part is malformed", () => {
    const malformed = fixtureParts() as Array<Record<string, unknown>>;
    malformed[0].thoughtSignature = "";
    expect(captureGoogleContinuationState({ config, requestedModelId: "gemini-3.8-flash", normalizedEndpoint: endpoint, parts: malformed }).issue).toMatchObject({ code: "invalid_payload" });
  });
});
