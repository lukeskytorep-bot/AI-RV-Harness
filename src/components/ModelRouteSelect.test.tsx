import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ProviderConfig, ProviderModel } from "../providers/types";
import type { Profile } from "../types";
import { ModelRouteSelect } from "./ModelRouteSelect";

const now = "2026-09-09T08:00:00.000Z";
const providerA: ProviderConfig = { id: "pc-a", provider: "openrouter", label: "OpenRouter A", credentialId: "cred-a", enabled: true, createdAt: now, updatedAt: now };
const providerB: ProviderConfig = { id: "pc-b", provider: "openrouter", label: "OpenRouter B", credentialId: "cred-b", enabled: true, createdAt: now, updatedAt: now };
const model = (provider: ProviderConfig, modelId: string): ProviderModel => ({
  providerConfigId: provider.id,
  provider: provider.provider,
  modelId,
  displayName: modelId,
  route: `${provider.provider}:${modelId}`,
  capabilities: {
    inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true,
    reasoning: { supported: false, efforts: [], confidence: "unknown" },
    temperature: { supported: false, confidence: "unknown" }, supportedParameters: [], source: "provider", capturedAt: now,
  },
  pricing: {}, recommended: false, rawMetadata: {}, refreshedAt: now,
});
const profile: Profile = { id: "p-a", name: "A", credentialId: "cred-a", createdAt: now, updatedAt: now };

describe("ModelRouteSelect", () => {
  it("renders only routes belonging to the active Profile credential", () => {
    const html = renderToStaticMarkup(<ModelRouteSelect
      role="judge"
      profile={profile}
      providers={[providerA, providerB]}
      models={[model(providerA, "judge-a"), model(providerB, "judge-b")]}
      value=""
      onChange={() => undefined}
      emptyLabel="Select model"
    />);

    expect(html).toContain("judge-a");
    expect(html).toContain("OpenRouter A");
    expect(html).not.toContain("judge-b");
    expect(html).not.toContain("OpenRouter B");
    expect(html).toContain('data-model-route-role="judge"');
  });

  it("drops a stale foreign selection instead of exposing it in the current Profile", () => {
    const html = renderToStaticMarkup(<ModelRouteSelect
      role="monitor"
      profile={profile}
      providers={[providerA, providerB]}
      models={[model(providerA, "monitor-a"), model(providerB, "monitor-b")]}
      value="pc-b::monitor-b"
      onChange={() => undefined}
      emptyLabel="Select model"
    />);

    expect(html).toContain("Select model");
    expect(html).not.toContain("pc-b::monitor-b");
    expect(html).not.toContain("monitor-b");
  });
});
