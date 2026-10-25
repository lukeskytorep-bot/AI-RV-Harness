import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserRepository } from "../storage/browserRepository";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import { listEligibleViewerIdentities, requireWorkspaceViewerRoute } from "../aiCenter/viewerIdentitySelection";
import { prepareFieldGuideForSession } from "../aiCenter/fieldGuide";
import { prepareViewerNotesForSession } from "../aiCenter/viewerNotes";
import { saveViewerProfile, profileSaveErrorMessage, type ViewerProfileSaveSession } from "./viewerProfileSave";
const runtime = vi.hoisted(() => ({ desktop: true }));
const fingerprint = vi.hoisted(() => vi.fn(async () => "native-one"));
vi.mock("../storage", () => ({ isTauriRuntime: () => runtime.desktop }));
vi.mock("../providers/native", () => ({ credentialIdentityFingerprint: fingerprint }));
class MemoryStorage {
  values = new Map<string,string>();
  getItem(k: string) { return this.values.get(k) ?? null; }
  setItem(k: string,v: string) { this.values.set(k,v); }
  removeItem(k: string) { this.values.delete(k); }
}
const config = { id: "pc", credentialId: "key", credentialFingerprint: "metadata-sha", provider: "custom_openai", baseUrl: "https://integrate.api.nvidia.com/v1", enabled: true } as ProviderConfig;
const model = { providerConfigId: "pc", provider: "custom_openai", modelId: "gemma", route: "custom:gemma", displayName: "Gemma" } as ProviderModel;
const values = { name: "Viewer", aiConfiguration: { credentialId: "key", defaultViewerModelId: "gemma" } };
function repository() {
  const repo = new BrowserRepository();
  vi.spyOn(repo, "listProviderConfigs").mockResolvedValue([config]);
  vi.spyOn(repo, "listProviderModels").mockResolvedValue([model]);
  return repo;
}
beforeEach(() => { vi.stubGlobal("localStorage", new MemoryStorage()); runtime.desktop = true; fingerprint.mockReset().mockResolvedValue("native-one"); });
describe("Viewer profile save integration with repository persistence", () => {
  it("does not report a new unconfigured profile as fully saved", async () => {
    const repo = repository();
    await expect(saveViewerProfile({ repository: repo, values: { name: "Missing route" } })).rejects.toMatchObject({ failure: { code: "configuration_missing" } });
    expect(await repo.listProfiles()).toHaveLength(0);
  });
  it("native preparation failure creates no profile, workspaces or identity; retry creates exactly one", async () => {
    const repo = repository(); const session: ViewerProfileSaveSession = {};
    fingerprint.mockRejectedValueOnce(new Error("secret must not reach UI"));
    const error = await saveViewerProfile({ repository: repo, values, session }).catch(e => e);
    expect(profileSaveErrorMessage(error, "pl")).toContain("Nie można odczytać");
    expect(profileSaveErrorMessage(error, "en")).not.toContain("secret");
    expect(await repo.listProfiles()).toHaveLength(0); expect(await repo.listWorkspaces()).toHaveLength(0);
    const saved = await saveViewerProfile({ repository: repo, values, session });
    expect(await repo.listProfiles()).toHaveLength(1); expect(await repo.listWorkspaces()).toHaveLength(2);
    expect(await repo.listAiIdentities(saved.profile.id)).toHaveLength(1);
  });
  it("fresh custom profile exposes the exact identity to Training and all three workspace flows", async () => {
    const repo = repository(); const saved = await saveViewerProfile({ repository: repo, values, session: {} });
    const profile = saved.profile;
    const eligible = await listEligibleViewerIdentities({ repository: repo, profileId: profile.id, language: "en", providerConfigs: [config], models: [model] });
    expect(eligible).toHaveLength(1);
    const identity = eligible[0].identity;
    for (const workspace of [saved.created!.conversationWorkspace, saved.created!.rvWorkspace]) {
      await expect(requireWorkspaceViewerRoute({ repository: repo, workspace, profile, identityId: identity.id, providerConfig: config, model })).resolves.toMatchObject({ id: identity.id });
    }
    const guide = await prepareFieldGuideForSession({ repository: repo, profile, providerConfig: config, model, language: "en" });
    const notes = await prepareViewerNotesForSession({ repository: repo, profileId: profile.id, providerConfig: config, model, enabled: true });
    expect(guide.aiIdentityId).toBe(identity.id); expect(notes.aiIdentityId).toBe(identity.id);
    expect(await repo.listAiIdentities(profile.id)).toHaveLength(1);
  });
  it("failed identity write reports partial save and retries the same durable profile", async () => {
    const repo = repository(); const session: ViewerProfileSaveSession = {};
    vi.spyOn(repo, "ensureAiIdentity").mockRejectedValueOnce(new Error("disk failure"));
    const error = await saveViewerProfile({ repository: repo, values, session }).catch(e => e);
    expect(profileSaveErrorMessage(error,"pl")).toContain("częściowo");
    expect(session.created).toBeDefined(); const id = session.created!.profile.id;
    const retried = await saveViewerProfile({ repository: repo, values, session });
    expect(retried.profile.id).toBe(id); expect(await repo.listProfiles()).toHaveLength(1);
    expect(await repo.listWorkspaces()).toHaveLength(2); expect(await repo.listAiIdentities(id)).toHaveLength(1);
  });
  it("edit preflight failure leaves existing profile and learning untouched", async () => {
    const repo = repository(); const saved = await saveViewerProfile({ repository: repo, values });
    const before = [...(localStorage as unknown as MemoryStorage).values];
    fingerprint.mockRejectedValue(new Error("keychain"));
    await expect(saveViewerProfile({ repository: repo, existingProfileId: saved.profile.id, values: { ...values, name: "Changed" } })).rejects.toMatchObject({ profileId: undefined });
    expect([...(localStorage as unknown as MemoryStorage).values]).toEqual(before);
  });
  it("resave preserves exact identity, Field Guide and Viewer Notes; changed key creates separate learning", async () => {
    const repo = repository(); const saved = await saveViewerProfile({ repository: repo, values });
    const [identity] = await repo.listAiIdentities(saved.profile.id);
    await prepareFieldGuideForSession({ repository: repo, profile: saved.profile, providerConfig: config, model, language: "en" });
    const guide = await repo.getExistingFieldGuideBundle(identity.id, "en");
    await repo.beginViewerNoteReflection({ id: "learning", aiIdentityId: identity.id, sourceSessionId: "s", sourceWorkspaceId: saved.created!.rvWorkspace.id,
      sourceSnapshot: { schemaVersion: 1, sessionId: "s", sessionCode: "RV", workspaceId: saved.created!.rvWorkspace.id, profileId: saved.profile.id, protocolId: "rv-lite-core", protocolVersion: "1.0", sessionRunType: "automatic", capturedAt: "now" }, reflectionPacketSha256: "packet", packetJson: "{}" });
    await repo.commitViewerNoteReflection({ runId: "learning", aiIdentityId: identity.id, sourceSessionId: "s", sourceWorkspaceId: saved.created!.rvWorkspace.id, decision: "UPDATE", notes: "Preserve learned sensory procedure", contentSha256: "hash", estimatedTokens: 8, capacityTokens: 1024, protocolId: "rv-lite-core", sessionRunType: "automatic", changeSummary: "learned", reflectionPacketSha256: "packet", modelRouteSnapshot: model.route, generationSettingsSnapshot: { requested: {}, effective: {}, omitted: [] }, rawFinalResponseSha256: "response" });
    const notes = await repo.getExistingViewerNoteBundle(identity.id);
    await saveViewerProfile({ repository: repo, values, existingProfileId: saved.profile.id });
    expect((await repo.listAiIdentities(saved.profile.id)).map(i => i.id)).toEqual([identity.id]);
    expect(await repo.getExistingFieldGuideBundle(identity.id,"en")).toEqual(guide);
    const afterNotes = await repo.getExistingViewerNoteBundle(identity.id);
    expect(afterNotes?.identity.id).toBe(identity.id);
    expect(afterNotes?.versions).toEqual(notes?.versions);
    expect(afterNotes?.settings).toEqual(notes?.settings);
    expect(afterNotes?.reflectionRuns).toEqual(notes?.reflectionRuns);
    expect(afterNotes?.activeVersion?.content).toBe("Preserve learned sensory procedure");
    const ensure = vi.spyOn(repo,"ensureAiIdentity");
    await listEligibleViewerIdentities({ repository: repo, profileId: saved.profile.id, language: "en", providerConfigs: [config], models: [model] });
    expect(ensure).not.toHaveBeenCalled();
    fingerprint.mockResolvedValue("native-two");
    await saveViewerProfile({ repository: repo, values, existingProfileId: saved.profile.id });
    expect(await repo.listAiIdentities(saved.profile.id)).toHaveLength(2);
    expect(await repo.getExistingFieldGuideBundle(identity.id,"en")).toEqual(guide);
  });
  it("name-only resave also validates and prepares the stored route", async () => {
    const repo = repository(); const saved = await saveViewerProfile({ repository: repo, values });
    const ensure = vi.spyOn(repo, "ensureAiIdentity");
    await saveViewerProfile({ repository: repo, values: { name: "Renamed" }, existingProfileId: saved.profile.id });
    expect(ensure).toHaveBeenCalledTimes(1);
    fingerprint.mockRejectedValue(new Error("keychain"));
    await expect(saveViewerProfile({ repository: repo, values: { name: "Rejected" }, existingProfileId: saved.profile.id })).rejects.toMatchObject({ profileId: undefined });
    expect((await repo.listProfiles())[0].name).toBe("Renamed");
  });
  it("Browser save never invokes native IPC", async () => {
    runtime.desktop = false; const repo = repository();
    const saved = await saveViewerProfile({ repository: repo, values });
    expect((await repo.listAiIdentities(saved.profile.id))[0].credentialFingerprint).toBe("metadata-sha");
    expect(fingerprint).not.toHaveBeenCalled();
  });
});
