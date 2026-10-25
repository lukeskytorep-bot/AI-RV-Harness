// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { ResearchConfigBuilder } from "./ResearchBuilder";
import { getCopy } from "../../i18n";
import { createDefaultSettings } from "../../startupDefaults";
import type { AppRepository } from "../../storage/repository";
import type { ProviderConfig, ProviderModel } from "../../providers/types";
import type { Profile, Workspace } from "../../types";

const now = "2026-09-15T12:00:00.000Z";
const profile: Profile = { id: "profile-a", name: "Orion", credentialId: "cred-a", createdAt: now, updatedAt: now };
const workspace: Workspace = { id: "workspace-a", profileId: profile.id, name: "Workspace 1", kind: "rv", createdAt: now, updatedAt: now, lastOpenedAt: now };

function fixtures(providerKind: "custom_openai" | "openrouter") {
  const provider: ProviderConfig = {
    id: "pc-a", provider: providerKind, label: providerKind, credentialId: "cred-a",
    credentialFingerprint: "fingerprint", enabled: true, lastStatus: "ok", createdAt: now, updatedAt: now,
  };
  const model: ProviderModel = {
    providerConfigId: provider.id, provider: providerKind, modelId: "model-a", displayName: "Model A", route: `${providerKind}:model-a`,
    capabilities: {
      inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true,
      reasoning: { supported: false, efforts: [], confidence: "unknown" },
      temperature: { supported: false, confidence: "unknown" }, supportedParameters: [], contextTokens: 100000,
      maxOutputTokens: 4096, source: "provider", capturedAt: now,
    },
    pricing: {}, recommended: true, rawMetadata: {}, refreshedAt: now,
  };
  return { provider, model };
}

async function mountedTemperatureInput(providerKind: "custom_openai" | "openrouter") {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const { provider, model } = fixtures(providerKind);
  await act(async () => {
    root.render(<ResearchConfigBuilder
      copy={getCopy("en")}
      settings={createDefaultSettings()}
      repository={{} as AppRepository}
      profiles={[profile]}
      workspaces={[workspace]}
      providers={[provider]}
      models={[model]}
      targets={[]}
      usage={[]}
      template="temperature"
      onBack={() => undefined}
      onLocked={async () => undefined}
    />);
    await Promise.resolve();
  });
  const input = [...host.querySelectorAll<HTMLInputElement>("input")]
    .find((element) => element.value === "0.7, 1.1, 1.5");
  return { host, root, input };
}

describe("Research Temperature Custom capability override", () => {
  it("enables temperature values after mount for Custom OpenAI without advertised capability", async () => {
    const { host, root, input } = await mountedTemperatureInput("custom_openai");
    try {
      expect(input).toBeTruthy();
      expect(input!.disabled).toBe(false);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it("keeps temperature values disabled after mount for OpenRouter without advertised capability", async () => {
    const { host, root, input } = await mountedTemperatureInput("openrouter");
    try {
      expect(input).toBeTruthy();
      expect(input!.disabled).toBe(true);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
