import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getCopy } from "../../i18n";
import { createDefaultSettings } from "../../startupDefaults";
import type { Profile, Workspace } from "../../types";
import type { ProviderModel } from "../../providers/types";
import { RvSessionPanel } from "./index";
import { buildRvSessionRequestedSettings } from "./RvSessionPanel";

const now = "2026-09-06T10:00:00.000Z";
const profile: Profile = { id: "profile-1", name: "Orion", createdAt: now, updatedAt: now };
const workspace: Workspace = { id: "workspace-1", profileId: profile.id, name: "RV Lab", kind: "rv", createdAt: now, updatedAt: now, lastOpenedAt: now };

describe("RV Sessions feature", () => {
  it("renders the protected session choices through the public entry point without repository access", () => {
    const copy = getCopy("en");
    const html = renderToStaticMarkup(
      <RvSessionPanel
        copy={copy}
        settings={createDefaultSettings()}
        profile={profile}
        workspace={workspace}
        repository={null}
      />,
    );

    expect(html).toContain(copy.newAutomaticSession);
    expect(html).toContain(copy.singleSession);
    expect(html).toContain(copy.ordinaryBatch);
    expect(html).toContain(copy.automatic);
    expect(html).toContain(copy.automaticMonitor);
    expect(html).toContain(copy.fullRcp);
    expect(html).toContain(copy.rvLite);
    expect(html).toContain("Telepathic Protocol");
    expect(html).toContain(copy.automaticTarget);
    expect(html).toContain(copy.externalBlind);
  });
});


const openRouterModel: ProviderModel = {
  providerConfigId: "provider-openrouter",
  provider: "openrouter",
  modelId: "model-openrouter",
  displayName: "OpenRouter model",
  route: "openrouter:model-openrouter",
  pricing: {},
  recommended: false,
  rawMetadata: {},
  refreshedAt: now,
  capabilities: {
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportsVision: false,
    supportsStreaming: true,
    reasoning: { supported: true, efforts: ["low", "high"], confidence: "provider_metadata" },
    temperature: { supported: true, min: 0, max: 2, default: 1, confidence: "provider_metadata" },
    supportedParameters: ["reasoning", "temperature", "top_p", "top_k", "seed"],
    maxOutputTokens: 65_536,
    contextTokens: 131_072,
    source: "provider",
    capturedAt: now,
  },
};

describe("RV Sessions sampling handoff", () => {
  it("adds manual OpenRouter sampling while preserving the panel reasoning and temperature selections", () => {
    const sampledProfile: Profile = {
      ...profile,
      defaultViewerModelId: openRouterModel.modelId,
      defaultViewerReasoningEffort: "high",
      defaultViewerTemperature: 0.9,
      defaultViewerOpenRouterSampling: { enabled: true, topP: 0.04, topK: 0, seed: 42 },
    };

    const requested = buildRvSessionRequestedSettings({
      profile: sampledProfile,
      model: openRouterModel,
      reasoning: "low",
      temperature: "0.7",
      rvSessionMaxOutputTokens: 32_768,
    });

    expect(requested).toEqual({
      reasoningEffort: "low",
      temperature: 0.7,
      topP: 0.04,
      topK: 0,
      seed: 42,
      maxOutputTokens: 32_768,
    });
  });

  it("keeps disabled and Auto sampling omitted and never applies stored OpenRouter sampling to another provider", () => {
    const disabledProfile: Profile = {
      ...profile,
      defaultViewerOpenRouterSampling: { enabled: false, topP: 0.04, topK: 64, seed: 42 },
    };
    const autoProfile: Profile = {
      ...profile,
      defaultViewerOpenRouterSampling: { enabled: true },
    };
    const googleModel: ProviderModel = {
      ...openRouterModel,
      providerConfigId: "provider-google",
      provider: "google",
      route: "google:model-openrouter",
    };
    const enabledProfile: Profile = {
      ...profile,
      defaultViewerOpenRouterSampling: { enabled: true, topP: 0.04, topK: 64, seed: 42 },
    };

    for (const [candidateProfile, candidateModel] of [
      [disabledProfile, openRouterModel],
      [autoProfile, openRouterModel],
      [enabledProfile, googleModel],
    ] as const) {
      const requested = buildRvSessionRequestedSettings({
        profile: candidateProfile,
        model: candidateModel,
        reasoning: "",
        temperature: "",
        rvSessionMaxOutputTokens: 16_384,
      });
      expect(requested.topP).toBeUndefined();
      expect(requested.topK).toBeUndefined();
      expect(requested.seed).toBeUndefined();
    }
  });

  it("keeps Resume pinned to the saved requested settings rather than rebuilding them from the edited profile", () => {
    const source = readFileSync(new URL("./RvSessionPanel.tsx", import.meta.url), "utf8");
    expect(source).toContain("requestedSettings: snapshot.generationSettings.requested");
    expect(source.match(/requestedSettings: snapshot\.generationSettings\.requested/g)?.length).toBeGreaterThanOrEqual(4);
  });
});
