import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { getCopy } from "../../i18n";
import type { ProviderConfig, ProviderModel } from "../../providers/types";
import type { AppRepository } from "../../storage/repository";
import { CreateProfileDialog } from "./ProfileDialogs";
import type { ProfileSetupController } from "./useProfileSetupController";
import { useProfileSetupController } from "./useProfileSetupController";

vi.mock("./useProfileSetupController", async () => {
  const actual = await vi.importActual<typeof import("./useProfileSetupController")>("./useProfileSetupController");
  return {
    ...actual,
    useProfileSetupController: vi.fn(),
  };
});

const now = "2026-09-23T20:00:00.000Z";
const provider: ProviderConfig = {
  id: "provider-large",
  provider: "openrouter",
  label: "OpenRouter Large Inventory",
  credentialId: "credential-large",
  enabled: true,
  createdAt: now,
  updatedAt: now,
};

function model(index: number): ProviderModel {
  return {
    providerConfigId: provider.id,
    provider: provider.provider,
    modelId: `model-${String(index).padStart(3, "0")}`,
    displayName: `Model ${String(index).padStart(3, "0")}`,
    route: `model-${String(index).padStart(3, "0")}`,
    capabilities: {
      inputModalities: ["text"],
      outputModalities: ["text"],
      supportsVision: false,
      supportsStreaming: true,
      reasoning: { supported: false, efforts: [], confidence: "provider_metadata", registryStatus: "unknown" },
      temperature: { supported: true, min: 0, max: 2, default: 0.7, confidence: "provider_metadata" },
      supportedParameters: ["temperature"],
      source: "provider",
      capturedAt: now,
    },
    pricing: {},
    recommended: false,
    rawMetadata: {},
    refreshedAt: now,
  };
}

function setupWithModels(providerModels: ProviderModel[], viewerModelId: string): ProfileSetupController {
  const viewerModel = providerModels.find((item) => item.modelId === viewerModelId) ?? null;
  return {
    providers: [provider],
    models: providerModels,
    connectionChoice: provider.id,
    providerKind: provider.provider,
    providerLabel: provider.label,
    apiKey: "",
    baseUrl: "",
    viewerModelId,
    viewerReasoning: "",
    viewerTemperature: "0.7",
    viewerSystemPrompt: "",
    modelSearch: "",
    judgeModelKey: "",
    monitorModelKey: "",
    busy: false,
    error: null,
    desktop: true,
    selectedProvider: provider,
    providerModels,
    visibleViewerModels: providerModels.slice(0, 250),
    viewerModel,
    cachedModelCount: providerModels.length,
    providerKinds: ["openrouter"],
    setProviderLabel: vi.fn(),
    setApiKey: vi.fn(),
    setBaseUrl: vi.fn(),
    setViewerReasoning: vi.fn(),
    setViewerTemperature: vi.fn(),
    setModelSearch: vi.fn(),
    setJudgeModelKey: vi.fn(),
    setMonitorModelKey: vi.fn(),
    setError: vi.fn(),
    changeProviderKind: vi.fn(),
    changeConnection: vi.fn(),
    selectViewerModel: vi.fn(),
    reloadInventory: vi.fn(async () => undefined),
    connectProvider: vi.fn(async () => provider),
    prepareCachedModels: vi.fn(),
    resetAdvancedOptions: vi.fn(),
    buildAiConfiguration: vi.fn(() => ({
      credentialId: provider.credentialId,
      credentialProvider: provider.provider,
      defaultViewerModelId: viewerModelId,
    })),
  };
}

describe("PROFILE-CREATE-PROVIDER-MODEL-UI-1", () => {
  it("keeps a model beyond the old 250-item visible-list cap selectable in the canonical Create Profile selector", () => {
    const providerModels = Array.from({ length: 300 }, (_, index) => model(index));
    const lateModel = providerModels[299];
    vi.mocked(useProfileSetupController).mockReturnValue(setupWithModels(providerModels, lateModel.modelId));

    const copy = getCopy("en");
    const html = renderToStaticMarkup(
      <CreateProfileDialog
        copy={copy}
        repository={{} as AppRepository}
        onCancel={vi.fn()}
        onCreate={vi.fn(async () => undefined)}
      />,
    );

    expect(html).toContain(`value="${lateModel.modelId}"`);
    expect(html).toContain(lateModel.displayName);
    expect(html.match(new RegExp(copy.defaultViewerModel, "g"))).toHaveLength(1);
    expect(html).not.toContain(copy.modelSearchPlaceholder);
  });
});
