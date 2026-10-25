import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OPENROUTER_ENDPOINT_CACHE_FRESH_MS,
  OPENROUTER_ENDPOINT_CACHE_LKG_MS,
  clearOpenRouterEndpointCapabilityCache,
  createOpenRouterCapacityEnvelope,
  mergeOpenRouterProviderRouting,
  openRouterEndpointCacheKey,
  openRouterProviderSlugMatches,
  resolveOpenRouterRoutingDecision,
  routingSafetyMarginTokens,
  seedOpenRouterEndpointCapabilityCacheForTest,
} from "./openRouterEndpointCapability";
import type { EffectiveGenerationSettings } from "./types";

const settings = (maxOutputTokens: number, reasoning = false): EffectiveGenerationSettings => ({
  requested: { maxOutputTokens, ...(reasoning ? { reasoningEffort: "high" as const } : {}) },
  effective: { maxOutputTokens, ...(reasoning ? { reasoningEffort: "high" as const } : {}) },
  omitted: [],
  ...(reasoning ? {
    reasoningResolution: {
      selected: "high" as const,
      label: "High",
      verification: "registry" as const,
      transport: { kind: "effort" as const, value: "high" },
    },
  } : {}),
});

const endpointPayload = (endpoints: unknown[]) => ({ data: { endpoints } });

beforeEach(() => clearOpenRouterEndpointCapabilityCache());

describe("OpenRouter endpoint capability routing", () => {
  it("implements the R2 Qwen discrepancy fixture and selects only the verified fitting route", async () => {
    const envelope = createOpenRouterCapacityEnvelope({ estimatedInputTokens: 26_712, settings: settings(8_192) });
    expect(envelope).toMatchObject({
      routingSafetyMarginTokens: 6_678,
      conservativeInputTokens: 33_390,
      requestedCompletionAllowance: 8_192,
      effectiveRequiredContext: 41_582,
    });
    const decision = await resolveOpenRouterRoutingDecision({
      providerConfigId: "pc",
      modelId: "qwen/qwen3-32b",
      envelope,
      discover: async () => endpointPayload([
        { tag: "deepinfra/fp8", provider_name: "DeepInfra", context_length: 40_960, max_completion_tokens: 8_192, supported_parameters: [] },
        { tag: "siliconflow/fp8", provider_name: "SiliconFlow", context_length: 131_072, max_completion_tokens: 16_384, supported_parameters: [] },
      ]),
    });
    expect(decision.mode).toBe("verified_fit");
    expect(decision.endpoints.map((entry) => [entry.routeTag, entry.capacityState])).toEqual([
      ["deepinfra/fp8", "PROVEN_NO"],
      ["siliconflow/fp8", "PROVEN_FIT"],
    ]);
    expect(decision.providerRouting).toEqual({ only: ["siliconflow/fp8"], allowFallbacks: true });
  });


  it("matches OpenRouter base provider slugs to ordinary endpoint variants but not service tiers", () => {
    expect(openRouterProviderSlugMatches("siliconflow", "siliconflow/fp8")).toBe(true);
    expect(openRouterProviderSlugMatches("google-vertex", "google-vertex/us-east5")).toBe(true);
    expect(openRouterProviderSlugMatches("openai", "openai/fast")).toBe(false);
    expect(openRouterProviderSlugMatches("google-vertex", "google-vertex/flex")).toBe(false);
    expect(openRouterProviderSlugMatches("openai/fast", "openai/priority")).toBe(true);
    expect(openRouterProviderSlugMatches("openai/flex", "openai/priority")).toBe(false);
  });

  it("merges base/full OpenRouter provider restrictions without widening or emptying valid routes", () => {
    expect(mergeOpenRouterProviderRouting(
      { only: ["siliconflow"] },
      { only: ["siliconflow/fp8"], allowFallbacks: true },
    )).toEqual({ only: ["siliconflow/fp8"], allowFallbacks: true });

    expect(mergeOpenRouterProviderRouting(
      { ignore: ["deepinfra"] },
      { only: ["deepinfra/fp8", "siliconflow/fp8"] },
    )).toEqual({ only: ["siliconflow/fp8"], ignore: ["deepinfra"] });

    expect(mergeOpenRouterProviderRouting(
      { order: ["siliconflow"], only: ["siliconflow"] },
      { only: ["siliconflow/fp8"] },
    )).toEqual({ order: ["siliconflow"], only: ["siliconflow/fp8"] });

    expect(mergeOpenRouterProviderRouting(
      { only: ["siliconflow/fp8"] },
      { only: ["siliconflow/fp8"] },
    )).toEqual({ only: ["siliconflow/fp8"] });

    expect(mergeOpenRouterProviderRouting(
      { only: ["deepinfra"] },
      { only: ["siliconflow/fp8"] },
    )).toEqual({ only: [] });

    expect(mergeOpenRouterProviderRouting(
      { only: ["openai"] },
      { only: ["openai/fast"] },
    )).toEqual({ only: [] });

    expect(mergeOpenRouterProviderRouting(
      { only: ["openai/priority"] },
      { only: ["openai/fast"] },
    )).toEqual({ only: ["openai/fast"] });
  });

  it("keeps a small request on normal OpenRouter routing without discovery", async () => {
    const discover = vi.fn();
    const envelope = createOpenRouterCapacityEnvelope({ estimatedInputTokens: 6_000, settings: settings(4_096) });
    expect(routingSafetyMarginTokens(6_000)).toBe(2_048);
    expect(envelope.effectiveRequiredContext).toBe(12_144);
    const decision = await resolveOpenRouterRoutingDecision({ providerConfigId: "pc", modelId: "a/b", envelope, discover });
    expect(decision.mode).toBe("normal");
    expect(decision.capacitySensitive).toBe(false);
    expect(decision.providerRouting).toBeUndefined();
    expect(discover).not.toHaveBeenCalled();
  });


  it("uses fresh all-PROVEN_NO cache evidence to stop even a below-threshold request", async () => {
    const now = 550_000;
    const envelope = createOpenRouterCapacityEnvelope({ estimatedInputTokens: 1_000, settings: settings(4_096, true) });
    expect(envelope.effectiveRequiredContext).toBe(7_144);
    seedOpenRouterEndpointCapabilityCacheForTest(openRouterEndpointCacheKey("pc", "a/b"), {
      capturedAtMs: now,
      endpoints: [
        { routeTag: "provider-a/fp8", contextLength: 131_072, maxCompletionTokens: 8_192, supportedParameters: ["temperature"] },
        { routeTag: "provider-b/fp8", contextLength: 131_072, maxCompletionTokens: 8_192, supportedParameters: ["temperature"] },
      ],
    });
    const discover = vi.fn();
    const decision = await resolveOpenRouterRoutingDecision({
      providerConfigId: "pc",
      modelId: "a/b",
      envelope,
      discover,
      nowMs: now,
    });
    expect(decision.capacitySensitive).toBe(true);
    expect(decision.mode).toBe("local_stop");
    expect(decision.endpoints.every((entry) => entry.capacityState === "PROVEN_NO")).toBe(true);
    expect(discover).not.toHaveBeenCalled();
  });

  it("keeps normal routing when fresh known endpoints all comfortably fit", async () => {
    const now = 500_000;
    const envelope = createOpenRouterCapacityEnvelope({ estimatedInputTokens: 6_000, settings: settings(4_096) });
    seedOpenRouterEndpointCapabilityCacheForTest(openRouterEndpointCacheKey("pc", "a/b"), {
      capturedAtMs: now,
      endpoints: [
        { routeTag: "a", contextLength: 40_960, maxCompletionTokens: 8_192 },
        { routeTag: "b", contextLength: 65_536, maxCompletionTokens: 8_192 },
        { routeTag: "c", contextLength: 131_072, maxCompletionTokens: 16_384 },
      ],
    });
    const discover = vi.fn();
    const decision = await resolveOpenRouterRoutingDecision({ providerConfigId: "pc", modelId: "a/b", envelope, discover, nowMs: now });
    expect(decision.mode).toBe("normal");
    expect(decision.providerRouting).toBeUndefined();
    expect(decision.endpoints.every((entry) => entry.capacityState === "PROVEN_FIT")).toBe(true);
    expect(discover).not.toHaveBeenCalled();
  });

  it("treats an explicitly unavailable endpoint as PROVEN_NO without guessing from opaque status values", async () => {
    const envelope = createOpenRouterCapacityEnvelope({ estimatedInputTokens: 30_000, settings: settings(8_192) });
    const decision = await resolveOpenRouterRoutingDecision({
      providerConfigId: "pc",
      modelId: "a/b",
      envelope,
      discover: async () => endpointPayload([
        { tag: "down", available: false, status: 0, context_length: 131_072, max_completion_tokens: 16_384 },
        { tag: "up", status: 0, context_length: 131_072, max_completion_tokens: 16_384 },
      ]),
    });
    expect(decision.mode).toBe("verified_fit");
    expect(decision.providerRouting?.only).toEqual(["up"]);
    expect(decision.endpoints.find((entry) => entry.routeTag === "down")?.reasons).toContain("endpoint_explicitly_unavailable");
    expect(decision.endpoints.find((entry) => entry.routeTag === "up")?.status).toBe(0);
  });

  it("gives UNKNOWN routes one unverified-capacity path while excluding a known-too-small tag", async () => {
    const envelope = createOpenRouterCapacityEnvelope({ estimatedInputTokens: 30_000, settings: settings(8_192) });
    const decision = await resolveOpenRouterRoutingDecision({
      providerConfigId: "pc",
      modelId: "a/b",
      envelope,
      discover: async () => endpointPayload([
        { tag: "deepinfra", context_length: 40_960, max_completion_tokens: 8_192 },
        { tag: "provider-x", context_length: 131_072 },
        { tag: "provider-y" },
      ]),
    });
    expect(decision.mode).toBe("unknown_attempt");
    expect(decision.providerRouting).toEqual({ ignore: ["deepinfra"], allowFallbacks: true });
    expect(decision.endpoints.map((entry) => entry.capacityState)).toEqual(["PROVEN_NO", "UNKNOWN", "UNKNOWN"]);
  });

  it("bounds the endpoint cache and avoids rediscovery for a fresh retained entry", async () => {
    const now = 700_000;
    const envelope = createOpenRouterCapacityEnvelope({ estimatedInputTokens: 30_000, settings: settings(8_192) });
    for (let index = 0; index <= 64; index += 1) {
      seedOpenRouterEndpointCapabilityCacheForTest(openRouterEndpointCacheKey(`pc-${index}`, "a/b"), {
        capturedAtMs: now,
        endpoints: [{ routeTag: "large", contextLength: 131_072, maxCompletionTokens: 16_384 }],
      });
    }
    const evictedDiscovery = vi.fn(async () => endpointPayload([{ tag: "large", context_length: 131_072, max_completion_tokens: 16_384 }]));
    await resolveOpenRouterRoutingDecision({ providerConfigId: "pc-0", modelId: "a/b", envelope, discover: evictedDiscovery, nowMs: now });
    expect(evictedDiscovery).toHaveBeenCalledOnce();

    const retainedDiscovery = vi.fn();
    await resolveOpenRouterRoutingDecision({ providerConfigId: "pc-64", modelId: "a/b", envelope, discover: retainedDiscovery, nowMs: now });
    expect(retainedDiscovery).not.toHaveBeenCalled();
  });


  it("separates cache entries when the OpenRouter endpoint/base URL changes", async () => {
    const now = 900_000;
    const envelope = createOpenRouterCapacityEnvelope({ estimatedInputTokens: 30_000, settings: settings(8_192) });
    seedOpenRouterEndpointCapabilityCacheForTest(openRouterEndpointCacheKey("pc", "a/b", "cred", "https://openrouter.ai/api/v1"), {
      capturedAtMs: now,
      endpoints: [{ routeTag: "large", contextLength: 131_072, maxCompletionTokens: 16_384 }],
    });
    const discover = vi.fn(async () => endpointPayload([{ tag: "eu-large", context_length: 131_072, max_completion_tokens: 16_384 }]));
    await resolveOpenRouterRoutingDecision({
      providerConfigId: "pc",
      modelId: "a/b",
      credentialScope: "cred",
      endpointScope: "https://eu.openrouter.ai/api/v1",
      envelope,
      discover,
      nowMs: now,
    });
    expect(discover).toHaveBeenCalledOnce();
  });

  it("uses bounded last-known-good data on discovery failure and otherwise preserves one normal UNKNOWN attempt", async () => {
    const envelope = createOpenRouterCapacityEnvelope({ estimatedInputTokens: 30_000, settings: settings(8_192) });
    const key = openRouterEndpointCacheKey("pc", "a/b");
    const now = 1_000_000;
    seedOpenRouterEndpointCapabilityCacheForTest(key, {
      capturedAtMs: now - OPENROUTER_ENDPOINT_CACHE_FRESH_MS - 1,
      endpoints: [
        { routeTag: "small", contextLength: 40_960, maxCompletionTokens: 8_192 },
        { routeTag: "large", contextLength: 131_072, maxCompletionTokens: 16_384 },
      ],
    });
    const lkg = await resolveOpenRouterRoutingDecision({
      providerConfigId: "pc",
      modelId: "a/b",
      envelope,
      nowMs: now,
      discover: async () => { throw new Error("offline"); },
    });
    expect(lkg.metadataSource).toBe("last_known_good");
    expect(lkg.mode).toBe("verified_fit");
    expect(lkg.providerRouting?.only).toEqual(["large"]);

    clearOpenRouterEndpointCapabilityCache();
    const unavailable = await resolveOpenRouterRoutingDecision({
      providerConfigId: "pc",
      modelId: "a/b",
      envelope,
      discover: async () => { throw new Error("offline"); },
    });
    expect(unavailable.metadataSource).toBe("unavailable");
    expect(unavailable.mode).toBe("unknown_attempt");
    expect(unavailable.providerRouting).toBeUndefined();

    seedOpenRouterEndpointCapabilityCacheForTest(key, {
      capturedAtMs: now - OPENROUTER_ENDPOINT_CACHE_LKG_MS - 1,
      endpoints: [{ routeTag: "large", contextLength: 131_072, maxCompletionTokens: 16_384 }],
    });
    const expired = await resolveOpenRouterRoutingDecision({
      providerConfigId: "pc",
      modelId: "a/b",
      envelope,
      nowMs: now,
      discover: async () => { throw new Error("offline"); },
    });
    expect(expired.metadataSource).toBe("unavailable");
    expect(expired.mode).toBe("unknown_attempt");
  });

  it("preserves the high reasoning allowance and rejects a route that cannot support required parameters", async () => {
    const envelope = createOpenRouterCapacityEnvelope({ estimatedInputTokens: 30_000, settings: settings(16_384, true) });
    expect(envelope.routingSafetyMarginTokens).toBe(7_500);
    expect(envelope.requestedCompletionAllowance).toBe(16_384);
    expect(envelope.effectiveRequiredContext).toBe(53_884);
    const decision = await resolveOpenRouterRoutingDecision({
      providerConfigId: "pc",
      modelId: "a/b",
      envelope,
      discover: async () => endpointPayload([
        { tag: "small", context_length: 40_960, max_completion_tokens: 16_384, supported_parameters: ["reasoning"] },
        { tag: "no-reasoning", context_length: 131_072, max_completion_tokens: 32_768, supported_parameters: ["temperature"] },
        { tag: "large", context_length: 131_072, max_completion_tokens: 32_768, supported_parameters: ["reasoning"] },
      ]),
    });
    expect(decision.providerRouting?.only).toEqual(["large"]);
    expect(decision.endpoints.find((entry) => entry.routeTag === "no-reasoning")?.reasons).toContain("unsupported_parameter:reasoning");
  });

  it("intersects capacity routing with an existing provider allowlist instead of overriding it", async () => {
    expect(mergeOpenRouterProviderRouting(
      { order: ["large", "approved-other"], only: ["large", "approved-other"], ignore: ["blocked"], allowFallbacks: false },
      { only: ["large"], ignore: ["small"], allowFallbacks: true },
    )).toEqual({ order: ["large"], only: ["large"], ignore: ["blocked", "small"], allowFallbacks: false });

    const envelope = createOpenRouterCapacityEnvelope({ estimatedInputTokens: 30_000, settings: settings(8_192) });
    const decision = await resolveOpenRouterRoutingDecision({
      providerConfigId: "pc",
      modelId: "a/b",
      envelope,
      existingRouting: { only: ["small"], allowFallbacks: false },
      discover: async () => endpointPayload([
        { tag: "small", context_length: 40_960, max_completion_tokens: 8_192 },
        { tag: "large", context_length: 131_072, max_completion_tokens: 16_384 },
      ]),
    });
    expect(decision.mode).toBe("local_stop");
    expect(decision.humanMessage).toContain("selected OpenRouter provider restriction");
  });
});
