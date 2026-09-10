import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppRepository } from "../storage/repository";
import type { ProviderConfig } from "./types";

const native = vi.hoisted(() => ({
  deleteCredentialSecret: vi.fn(),
  discoverModels: vi.fn(),
  hasCredentialSecret: vi.fn(),
  rebindCredentialSecret: vi.fn(),
  storeCredentialSecret: vi.fn(),
}));

vi.mock("./native", () => native);

import { rebindProviderCredential } from "./service";

describe("provider credential rebinding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.hasCredentialSecret.mockResolvedValue(true);
    native.discoverModels.mockResolvedValue([]);
    native.rebindCredentialSecret.mockResolvedValue(undefined);
  });

  it("requires the user-supplied secret and rebinds it to the exact stored provider route", async () => {
    const config: ProviderConfig = {
      id: "provider-1",
      provider: "custom_openai",
      label: "Private endpoint",
      credentialId: "credential-1",
      baseUrl: "https://example.test/v1",
      enabled: true,
      createdAt: "2026-09-10T00:00:00.000Z",
      updatedAt: "2026-09-10T00:00:00.000Z",
    };
    const repository = {
      updateProviderCredentialMetadata: vi.fn().mockResolvedValue(undefined),
      replaceProviderModels: vi.fn().mockResolvedValue(undefined),
      updateProviderConnectionStatus: vi.fn().mockResolvedValue(undefined),
    } as unknown as AppRepository;

    await rebindProviderCredential(repository, config, "  sk-reentered-secret  ");

    expect(native.rebindCredentialSecret).toHaveBeenCalledWith(
      "credential-1",
      "sk-reentered-secret",
      "custom_openai",
      "https://example.test/v1",
    );
    expect(repository.updateProviderCredentialMetadata).toHaveBeenCalledOnce();
    expect(native.discoverModels).toHaveBeenCalledWith(config);
  });

  it("does not rebind an empty secret", async () => {
    const config = {
      id: "provider-1",
      provider: "openrouter",
      label: "OpenRouter",
      credentialId: "credential-1",
      enabled: true,
      createdAt: "2026-09-10T00:00:00.000Z",
      updatedAt: "2026-09-10T00:00:00.000Z",
    } satisfies ProviderConfig;
    const repository = {} as AppRepository;

    await expect(rebindProviderCredential(repository, config, "   ")).rejects.toThrow("API key is required");
    expect(native.rebindCredentialSecret).not.toHaveBeenCalled();
  });
});
