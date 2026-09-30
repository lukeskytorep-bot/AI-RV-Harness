import { describe, expect, it, vi } from "vitest";

import type { AppRepository } from "../../storage/repository";
import { archiveProfileAndRefresh, saveProfileAndRefresh } from "./profileOperations";

describe("profile operations", () => {
  it("archives before refreshing the application-owned profile list", async () => {
    const order: string[] = [];
    const repository = { archiveProfile: vi.fn(async () => { order.push("archive"); }) } as unknown as AppRepository;
    const refresh = vi.fn(async () => { order.push("refresh"); });

    await archiveProfileAndRefresh(repository, "profile-1", refresh);

    expect(repository.archiveProfile).toHaveBeenCalledWith("profile-1");
    expect(order).toEqual(["archive", "refresh"]);
  });

  it("persists identity and optional AI defaults before closing and refreshing", async () => {
    const order: string[] = [];
    const repository = {
      updateProfile: vi.fn(async () => { order.push("profile"); }),
      setProfileAiConfiguration: vi.fn(async () => { order.push("ai"); }),
      listProviderConfigs: vi.fn(async () => [{ id: "provider-1", provider: "openrouter", label: "OpenRouter", credentialId: "credential-1", credentialFingerprint: "fp-1", enabled: true, createdAt: "now", updatedAt: "now" }]),
      listProviderModels: vi.fn(async () => [{ providerConfigId: "provider-1", provider: "openrouter", modelId: "model-1", displayName: "Model 1", route: "openrouter:model-1", capabilities: { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: false, efforts: [], confidence: "provider_metadata" }, temperature: { supported: true, confidence: "provider_metadata" }, supportedParameters: [], source: "provider", capturedAt: "now" }, pricing: {}, recommended: false, rawMetadata: {}, refreshedAt: "now" }]),
      ensureAiIdentity: vi.fn(async () => { order.push("identity"); return {} as never; }),
    } as unknown as AppRepository;
    const close = vi.fn(() => { order.push("close"); });
    const refresh = vi.fn(async () => { order.push("refresh"); });
    const aiConfiguration = { credentialId: "credential-1", defaultViewerModelId: "model-1" };

    await saveProfileAndRefresh(repository, "profile-1", { name: "Orion", humanName: "Luke", note: "note", aiConfiguration }, refresh, close);

    expect(repository.updateProfile).toHaveBeenCalledWith("profile-1", { name: "Orion", humanName: "Luke", note: "note" });
    expect(repository.setProfileAiConfiguration).toHaveBeenCalledWith("profile-1", aiConfiguration);
    expect(order).toEqual(["profile", "ai", "identity", "close", "refresh"]);
  });
});
