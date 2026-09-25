import { describe, expect, it } from "vitest";
import openRouterFixture from "./continuation-fixtures/openrouter-reasoning-details.json";
import googleFixture from "./continuation-fixtures/google-thought-signature.json";
import anthropicFixture from "./continuation-fixtures/anthropic-thinking-blocks.json";
import {
  CONTINUATION_LIMITS_V1,
  replayFingerprintsCompatible,
  validateContinuationRequestBudget,
  validateProviderContinuationState,
  type ProviderContinuationState,
} from "./continuationContract";

function validState(fixture: { continuationState: unknown }): ProviderContinuationState {
  const result = validateProviderContinuationState(fixture.continuationState);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

describe("CONTINUATION-CONTRACT-0-R1", () => {
  it("accepts the three source-faithful v1 fixture formats", () => {
    for (const fixture of [openRouterFixture, googleFixture, anthropicFixture]) {
      const result = validateProviderContinuationState(fixture.continuationState);
      expect(result.ok).toBe(true);
    }
  });

  it("preserves OpenRouter reasoning_details exactly and in order for replay", () => {
    const responseDetails = openRouterFixture.providerResponse.choices[0].message.reasoning_details;
    const state = validState(openRouterFixture);
    expect(state.transport).toBe("openrouter");
    if (state.transport !== "openrouter") return;
    expect(state.reasoningDetails).toEqual(responseDetails);
    expect(openRouterFixture.nextRequest.messages[1].reasoning_details).toEqual(responseDetails);
    expect(state.reasoningDetails.map((detail) => detail.type)).toEqual([
      "reasoning.summary",
      "reasoning.encrypted",
      "reasoning.text",
    ]);
  });

  it("preserves Google thoughtSignature on the exact part", () => {
    const responseParts = googleFixture.providerResponse.candidates[0].content.parts;
    const state = validState(googleFixture);
    expect(state.transport).toBe("google-native");
    if (state.transport !== "google-native") return;
    expect(state.parts).toEqual(responseParts);
    expect(googleFixture.nextRequest.contents[1].parts).toEqual(responseParts);
  });

  it("preserves Anthropic thinking and redacted_thinking blocks unchanged and ordered", () => {
    const responseBlocks = anthropicFixture.providerResponse.content.slice(0, 2);
    const state = validState(anthropicFixture);
    expect(state.transport).toBe("anthropic-native");
    if (state.transport !== "anthropic-native") return;
    expect(state.blocks).toEqual(responseBlocks);
    expect(anthropicFixture.nextRequest.messages[1].content.slice(0, 2)).toEqual(responseBlocks);
  });

  it("returns a deep copy rather than an alias of untrusted input", () => {
    const original = structuredClone(openRouterFixture.continuationState) as any;
    const result = validateProviderContinuationState(original);
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.transport !== "openrouter") return;
    original.reasoningDetails[0].summary = "mutated after validation";
    original.replayFingerprint.providerConfigId = "mutated";
    expect(result.value.reasoningDetails[0]).toMatchObject({ summary: "Anonymized summary." });
    expect(result.value.replayFingerprint.providerConfigId).toBe("provider-config-fixture");
  });

  it("fails closed on unknown schema, transport, format and extra fields", () => {
    const base: any = structuredClone(openRouterFixture.continuationState);
    expect(validateProviderContinuationState({ ...base, schemaVersion: 2 })).toMatchObject({ ok: false, code: "unknown_schema_version" });
    expect(validateProviderContinuationState({ ...base, transport: "mystery" })).toMatchObject({ ok: false, code: "unknown_transport" });
    expect(validateProviderContinuationState({ ...base, format: "opaque" })).toMatchObject({ ok: false, code: "unknown_format" });
    expect(validateProviderContinuationState({ ...base, arbitrary: "field" })).toMatchObject({ ok: false, code: "invalid_payload" });
  });

  it("rejects secrets, auth/header containers and full raw response fields", () => {
    const base: any = structuredClone(openRouterFixture.continuationState);
    for (const [key, value] of [
      ["authorization", "Bearer fixture"],
      ["headers", { authorization: "fixture" }],
      ["apiKey", "fixture"],
      ["secret", "fixture"],
      ["rawResponse", { status: 200 }],
      ["debugPayload", { response: {} }],
    ] as const) {
      expect(validateProviderContinuationState({ ...base, [key]: value })).toMatchObject({ ok: false, code: "forbidden_sensitive_field" });
    }
  });

  it("rejects unknown provider-native block variants instead of guessing", () => {
    const openRouter: any = structuredClone(openRouterFixture.continuationState);
    openRouter.reasoningDetails[0].type = "reasoning.future";
    expect(validateProviderContinuationState(openRouter)).toMatchObject({ ok: false, code: "invalid_payload" });

    const google: any = structuredClone(googleFixture.continuationState);
    google.parts[0].futureField = "unsupported";
    expect(validateProviderContinuationState(google)).toMatchObject({ ok: false, code: "invalid_payload" });

    const anthropic: any = structuredClone(anthropicFixture.continuationState);
    anthropic.blocks[0].type = "future_thinking";
    expect(validateProviderContinuationState(anthropic)).toMatchObject({ ok: false, code: "invalid_payload" });
  });

  it("rejects malformed fingerprints and endpoint identity changes", () => {
    const base: any = structuredClone(openRouterFixture.continuationState);
    const fingerprint = base.replayFingerprint;
    expect(validateProviderContinuationState({ ...base, replayFingerprint: { ...fingerprint, credentialId: "" } })).toMatchObject({ ok: false, code: "invalid_fingerprint" });
    expect(validateProviderContinuationState({ ...base, replayFingerprint: { ...fingerprint, normalizedEndpoint: "https://user:pass@example.com/v1" } })).toMatchObject({ ok: false, code: "invalid_fingerprint" });
    expect(validateProviderContinuationState({ ...base, replayFingerprint: { ...fingerprint, normalizedEndpoint: "http://example.com/v1" } })).toMatchObject({ ok: false, code: "invalid_fingerprint" });
  });

  it("requires generic v1 replay identity compatibility without coupling replay to reasoning effort or actual model diagnostics", () => {
    const state = validState(openRouterFixture);
    const fingerprint = state.replayFingerprint;
    expect(replayFingerprintsCompatible(fingerprint, { ...fingerprint })).toBe(true);
    for (const variant of [
      { ...fingerprint, transport: "google-native" as const },
      { ...fingerprint, normalizedEndpoint: "https://openrouter.ai/api/v2" },
      { ...fingerprint, providerConfigId: "another-config" },
      { ...fingerprint, credentialId: "another-credential" },
      { ...fingerprint, requestedModelId: "another-model" },
      { ...fingerprint, stateFormat: "another-format" },
      { ...fingerprint, stateFormatVersion: 2 },
    ]) expect(replayFingerprintsCompatible(fingerprint, variant)).toBe(false);

    expect(replayFingerprintsCompatible(fingerprint, { ...fingerprint, actualModelId: "provider-specific-model" })).toBe(true);
    expect(validateProviderContinuationState({
      ...openRouterFixture.continuationState,
      replayFingerprint: { ...openRouterFixture.continuationState.replayFingerprint, reasoningMode: "high" },
    })).toMatchObject({ ok: false, code: "invalid_fingerprint" });
  });

  it("rejects too many blocks and oversized blocks instead of truncating them", () => {
    const tooMany: any = structuredClone(openRouterFixture.continuationState);
    tooMany.reasoningDetails = Array.from({ length: CONTINUATION_LIMITS_V1.maxBlocksPerMessage + 1 }, () => tooMany.reasoningDetails[0]);
    expect(validateProviderContinuationState(tooMany)).toMatchObject({ ok: false, code: "too_many_blocks" });

    const oversized: any = structuredClone(openRouterFixture.continuationState);
    oversized.reasoningDetails = [{
      type: "reasoning.encrypted",
      data: "x".repeat(CONTINUATION_LIMITS_V1.maxBlockBytes + 1),
      id: "oversized",
      format: "anthropic-claude-v1",
    }];
    expect(validateProviderContinuationState(oversized)).toMatchObject({ ok: false, code: "block_too_large" });
  });

  it("enforces a bounded aggregate continuation budget per request", () => {
    const state = validState(openRouterFixture);
    expect(validateContinuationRequestBudget([state, state])).toMatchObject({ ok: true });
    const large: any = structuredClone(openRouterFixture.continuationState);
    large.reasoningDetails = [{ type: "reasoning.encrypted", data: "x".repeat(400_000), id: "large", format: "anthropic-claude-v1" }];
    const checked = validateProviderContinuationState(large);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    const count = Math.ceil(CONTINUATION_LIMITS_V1.maxRequestStateBytes / checked.sizeBytes) + 1;
    expect(validateContinuationRequestBudget(Array.from({ length: count }, () => checked.value))).toMatchObject({ ok: false, code: "request_state_too_large" });
  });


  it("fails closed for cyclic and excessively deep hostile unknown values", () => {
    const cyclic: any = { schemaVersion: 1 };
    cyclic.self = cyclic;
    expect(() => validateProviderContinuationState(cyclic)).not.toThrow();
    expect(validateProviderContinuationState(cyclic)).toMatchObject({ ok: false, code: "invalid_payload" });

    let deep: any = { leaf: true };
    for (let i = 0; i < CONTINUATION_LIMITS_V1.maxTraversalDepth + 2; i += 1) deep = { child: deep };
    expect(() => validateProviderContinuationState(deep)).not.toThrow();
    expect(validateProviderContinuationState(deep)).toMatchObject({ ok: false, code: "invalid_payload" });

    const throwingGetter: Record<string, unknown> = {};
    Object.defineProperty(throwingGetter, "schemaVersion", {
      enumerable: true,
      get: () => { throw new Error("hostile getter"); },
    });
    expect(() => validateProviderContinuationState(throwingGetter)).not.toThrow();
    expect(validateProviderContinuationState(throwingGetter)).toMatchObject({ ok: false, code: "invalid_payload" });
  });

  it("rejects a state that exceeds 2 MiB even when every individual block remains below 512 KiB", () => {
    const state: any = structuredClone(openRouterFixture.continuationState);
    state.reasoningDetails = Array.from({ length: 5 }, (_, index) => ({
      type: "reasoning.encrypted",
      data: "x".repeat(450_000),
      id: `aggregate-${index}`,
      format: "anthropic-claude-v1",
      index,
    }));
    expect(validateProviderContinuationState(state)).toMatchObject({ ok: false, code: "state_too_large" });
  });

  it("rejects malformed Google thoughtSignature base64 without rewriting it", () => {
    const google: any = structuredClone(googleFixture.continuationState);
    google.parts[0].thoughtSignature = "not base64!";
    expect(validateProviderContinuationState(google)).toMatchObject({ ok: false, code: "invalid_payload" });
  });

  it("does not contract tool/function parts inside ProviderMessage v1", () => {
    const google: any = structuredClone(googleFixture.continuationState);
    google.parts = [{ functionCall: { name: "tool", args: {} }, thoughtSignature: "fixture" }];
    expect(validateProviderContinuationState(google)).toMatchObject({ ok: false, code: "invalid_payload" });
  });
});
