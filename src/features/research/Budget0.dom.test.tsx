// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { ResearchConfigBuilder } from "./ResearchBuilder";
import { getCopy } from "../../i18n";
import { createDefaultSettings } from "../../startupDefaults";
import type { AppRepository } from "../../storage/repository";
import type { ProviderConfig, ProviderModel } from "../../providers/types";
import type { Profile, Workspace } from "../../types";
for (const ceiling of [4096, 65536]) it(`new Research UI starts with common 16K bounded by ${ceiling}`, async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const profile = { id: "p", name: "P", credentialId: "c", createdAt: "t", updatedAt: "t" } as Profile;
  const provider = { id: "pc", provider: "openrouter", label: "P", credentialId: "c", enabled: true } as ProviderConfig;
  const model = { providerConfigId: "pc", provider: "openrouter", modelId: "m", displayName: "M", route: "openrouter:m", capabilities: { contextTokens: 262144, maxOutputTokens: ceiling, inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: false, confidence: "unknown" }, supportedParameters: [], source: "provider", capturedAt: "t" }, pricing: {}, recommended: false, rawMetadata: {}, refreshedAt: "t" } as ProviderModel;
  const settings = createDefaultSettings();
  try {
    await act(async () => root.render(<ResearchConfigBuilder copy={getCopy("en")} settings={settings} repository={{} as AppRepository} profiles={[profile]} workspaces={[{ id: "w", profileId: "p", kind: "rv", name: "W", createdAt: "t" } as Workspace]} providers={[provider]} models={[model]} targets={[]} usage={[]} template="temperature" onBack={() => undefined} onLocked={async () => undefined} />));
    const field = [...host.querySelectorAll("label")].find(l => l.querySelector("span")?.textContent === getCopy("en").researchMaxOutputTokens)!.querySelector<HTMLInputElement>("input")!;
    expect(field.value).toBe(String(Math.min(16384, ceiling))); expect(settings.defaultMaxOutputTokens).toBe(8192);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
