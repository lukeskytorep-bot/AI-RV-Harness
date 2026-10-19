import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppRepository } from "../storage/repository";
import type { ProviderConfig, ProviderModel } from "./types";
import {
  blackboxRouteNeedsManualModel,
  registerManualBlackboxModel,
} from "./service";
import {
  hasCredentialSecret,
  providerBindingEndpoint,
} from "./native";

vi.mock("./native", () => ({
  deleteCredentialSecret: vi.fn(),
  discoverModels: vi.fn(),
  hasCredentialSecret: vi.fn(),
  providerBindingEndpoint: vi.fn(),
  rebindCredentialSecret: vi.fn(),
  storeCredentialSecret: vi.fn(),
}));

const blackbox: ProviderConfig = {
  id: "pc-blackbox",
  provider: "blackbox",
  label: "Blackbox Enterprise",
  credentialId: "cred-blackbox",
  baseUrl: "https://enterprise.blackbox.ai",
  enabled: true,
  createdAt: "t",
  updatedAt: "t",
};

function repositoryWith(existing: ProviderModel[] = []) {
  const replaceProviderModels = vi.fn<AppRepository["replaceProviderModels"]>(async (_providerConfigId, _models) => undefined);
  const repository = {
    listProviderModels: vi.fn(async () => existing),
    replaceProviderModels,
  } as unknown as AppRepository;
  return { repository, replaceProviderModels };
}

describe("DIRECT-2C Blackbox manual model path", () => {
  beforeEach(() => {
    vi.mocked(providerBindingEndpoint).mockReset();
    vi.mocked(hasCredentialSecret).mockReset();
    vi.mocked(providerBindingEndpoint).mockResolvedValue("https://enterprise.blackbox.ai");
    vi.mocked(hasCredentialSecret).mockResolvedValue(true);
  });

  it("classifies only non-legacy explicit Blackbox routes as manual-model routes", () => {
    expect(blackboxRouteNeedsManualModel(undefined)).toBe(false);
    expect(blackboxRouteNeedsManualModel("   ")).toBe(false);
    expect(blackboxRouteNeedsManualModel("https://api.blackbox.ai")).toBe(false);
    expect(blackboxRouteNeedsManualModel("https://api.blackbox.ai/")).toBe(false);
    expect(blackboxRouteNeedsManualModel("https://enterprise.blackbox.ai")).toBe(true);
    expect(blackboxRouteNeedsManualModel("https://tenant.blackbox.ai/")).toBe(true);
  });

  it("stores the exact manual model id with conservative unverified capabilities", async () => {
    const { repository, replaceProviderModels } = repositoryWith();
    const model = await registerManualBlackboxModel(repository, blackbox, "  vendor/model-v1  ");

    expect(model.modelId).toBe("vendor/model-v1");
    expect(model.route).toBe("blackbox:vendor/model-v1");
    expect(model.capabilities.supportsStreaming).toBe(false);
    expect(model.capabilities.reasoning).toEqual({ supported: false, efforts: [], confidence: "unknown" });
    expect(model.capabilities.temperature).toEqual({ supported: false, confidence: "unknown" });
    expect(model.capabilities.supportedParameters).toEqual([]);
    expect(model.rawMetadata).toMatchObject({ source: "manual_model_id", discoveryVerified: false, capabilitiesVerified: false });
    expect(replaceProviderModels).toHaveBeenCalledTimes(1);
    expect(vi.mocked(hasCredentialSecret)).toHaveBeenCalledWith("cred-blackbox");
  });

  it("preserves other cached manual models and replaces only the same id", async () => {
    const existing: ProviderModel = {
      providerConfigId: blackbox.id,
      provider: "blackbox",
      modelId: "other/model",
      displayName: "Other",
      route: "blackbox:other/model",
      capabilities: {
        inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: false,
        reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: false, confidence: "unknown" },
        supportedParameters: [], source: "compatibility", capturedAt: "old",
      },
      pricing: {}, recommended: false, rawMetadata: {}, refreshedAt: "old",
    };
    const { repository, replaceProviderModels } = repositoryWith([existing]);
    await registerManualBlackboxModel(repository, blackbox, "vendor/model-v1");
    const stored = vi.mocked(replaceProviderModels).mock.calls[0][1];
    expect(stored.map((item) => item.modelId).sort()).toEqual(["other/model", "vendor/model-v1"]);
  });

  it("refuses manual registration on the legacy discovery route", async () => {
    vi.mocked(providerBindingEndpoint).mockResolvedValue("https://api.blackbox.ai");
    const { repository } = repositoryWith();
    await expect(registerManualBlackboxModel(repository, { ...blackbox, baseUrl: "https://api.blackbox.ai" }, "vendor/model-v1"))
      .rejects.toThrow(/reserved for routes without confirmed model discovery/i);
  });

  it("rejects empty or whitespace-containing model ids", async () => {
    const { repository } = repositoryWith();
    await expect(registerManualBlackboxModel(repository, blackbox, "   ")).rejects.toThrow(/model ID is required/i);
    await expect(registerManualBlackboxModel(repository, blackbox, "bad model")).rejects.toThrow(/single non-whitespace identifier/i);
  });
});
