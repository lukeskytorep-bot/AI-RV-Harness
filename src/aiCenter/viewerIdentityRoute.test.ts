import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import type { AppRepository } from "../storage/repository";
import { ensureProfileViewerIdentity } from "./viewerIdentitySelection";
import { prepareFieldGuideForSession } from "./fieldGuide";
import { prepareViewerNotesForSession } from "./viewerNotes";
const runtime = vi.hoisted(() => ({ desktop: true }));
const fingerprint = vi.hoisted(() => vi.fn(async () => "native-hmac"));
vi.mock("../storage", () => ({ isTauriRuntime: () => runtime.desktop }));
vi.mock("../providers/native", () => ({ credentialIdentityFingerprint: fingerprint }));
const config = { id: "pc", credentialId: "key", credentialFingerprint: "metadata-sha", provider: "custom_openai", baseUrl: "https://integrate.api.nvidia.com/v1", enabled: true } as ProviderConfig;
const model = { providerConfigId: "pc", provider: "custom_openai", modelId: "gemma", route: "custom:gemma", displayName: "Gemma" } as ProviderModel;
function repository(configs = [config], models = [model]) {
  return { listProviderConfigs: vi.fn(async () => configs), listProviderModels: vi.fn(async () => models), ensureAiIdentity: vi.fn(async (input) => ({ ...input, id: "identity" })) } as unknown as AppRepository;
}
beforeEach(() => { runtime.desktop = true; fingerprint.mockReset().mockResolvedValue("native-hmac"); });
describe("Viewer identity route preparation", () => {
  it("rejects unreadable native credentials before creating any identity; retry uses native proof", async () => {
    const repo = repository(); fingerprint.mockRejectedValueOnce(new Error("keychain unavailable"));
    await expect(ensureProfileViewerIdentity({ repository: repo, profileId: "p", credentialId: "key", modelId: "gemma" })).rejects.toMatchObject({ code: "fingerprint_unavailable" });
    expect(repo.ensureAiIdentity).not.toHaveBeenCalled();
    await expect(ensureProfileViewerIdentity({ repository: repo, profileId: "p", credentialId: "key", modelId: "gemma" })).resolves.toMatchObject({ credentialFingerprint: "native-hmac" });
  });
  it.each(["field-guide", "viewer-notes"])("%s preparation never writes metadata fallback after native failure", async (kind) => {
    const repo = repository(); fingerprint.mockRejectedValue(new Error("native unavailable"));
    const pending = kind === "field-guide"
      ? prepareFieldGuideForSession({ repository: repo, profile: { id: "p", name: "Viewer", createdAt: "now", updatedAt: "now" }, providerConfig: config, model, language: "en" })
      : prepareViewerNotesForSession({ repository: repo, profileId: "p", providerConfig: config, model, enabled: true });
    await expect(pending).rejects.toMatchObject({ code: "fingerprint_unavailable" });
    expect(repo.ensureAiIdentity).not.toHaveBeenCalled();
  });
  it("rejects empty native results without falling back", async () => {
    fingerprint.mockResolvedValue(" "); const repo = repository();
    await expect(ensureProfileViewerIdentity({ repository: repo, profileId: "p", credentialId: "key", modelId: "gemma" })).rejects.toMatchObject({ code: "fingerprint_unavailable" });
    expect(repo.ensureAiIdentity).not.toHaveBeenCalled();
  });
  it("Browser prepares the same metadata identity without invoking desktop IPC", async () => {
    runtime.desktop = false; const repo = repository();
    await expect(ensureProfileViewerIdentity({ repository: repo, profileId: "p", credentialId: "key", modelId: "gemma" })).resolves.toMatchObject({ credentialFingerprint: "metadata-sha" });
    expect(fingerprint).not.toHaveBeenCalled();
  });
  it("reports duplicate configured routes instead of selecting the first", async () => {
    const repo = repository([config, { ...config, id: "other" }]);
    await expect(ensureProfileViewerIdentity({ repository: repo, profileId: "p", credentialId: "key", modelId: "gemma" })).rejects.toMatchObject({ code: "ambiguous_route" });
    expect(repo.ensureAiIdentity).not.toHaveBeenCalled();
  });
  it("reports missing configuration and missing model separately", async () => {
    await expect(ensureProfileViewerIdentity({ repository: repository([]), profileId: "p", credentialId: "key", modelId: "gemma" })).rejects.toMatchObject({ code: "configuration_missing" });
    await expect(ensureProfileViewerIdentity({ repository: repository([config], []), profileId: "p", credentialId: "key", modelId: "gemma" })).rejects.toMatchObject({ code: "model_missing" });
  });
  it("rejects cached models bound to a different provider", async () => {
    const repo = repository([config], [{ ...model, provider: "openrouter" }]);
    await expect(ensureProfileViewerIdentity({ repository: repo, profileId: "p", credentialId: "key", modelId: "gemma" })).rejects.toMatchObject({ code: "binding_mismatch" });
    expect(repo.ensureAiIdentity).not.toHaveBeenCalled();
  });
});
