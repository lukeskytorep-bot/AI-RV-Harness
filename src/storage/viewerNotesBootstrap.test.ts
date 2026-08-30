import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserRepository } from "./browserRepository";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
  clear(): void { this.values.clear(); }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  get length(): number { return this.values.size; }
}

describe("Viewer Notes first-version bootstrap", () => {
  beforeEach(() => vi.stubGlobal("localStorage", new MemoryStorage()));

  it("creates and activates version 1 when both base fields are absent", async () => {
    const repository = new BrowserRepository();
    const identity = await repository.ensureAiIdentity({
      profileId: "profile",
      credentialFingerprint: "credential",
      credentialDisplay: "…TIAL",
      providerConfigId: "pc",
      provider: "openrouter",
      modelId: "viewer",
      modelRoute: "openrouter:viewer",
      modelDisplayName: "Viewer",
      role: "viewer",
    });
    await repository.beginViewerNoteReflection({
      id: "reflection",
      aiIdentityId: identity.id,
      sourceSessionId: "session",
      sourceWorkspaceId: "workspace",
      reflectionPacketSha256: "packet-hash",
      packetJson: "{}",
    });
    const result = await repository.commitViewerNoteReflection({
      runId: "reflection",
      aiIdentityId: identity.id,
      sourceSessionId: "session",
      sourceWorkspaceId: "workspace",
      decision: "UPDATE",
      notes: "Prefer direct sensory descriptions.",
      contentSha256: "notes-hash",
      estimatedTokens: 8,
      capacityTokens: 1024,
      protocolId: "rv-lite-core",
      sessionRunType: "automatic",
      changeSummary: "Created the first notes.",
      reflectionPacketSha256: "packet-hash",
      modelRouteSnapshot: "openrouter:viewer",
      generationSettingsSnapshot: { requested: { maxOutputTokens: 8192 }, effective: { maxOutputTokens: 8192 }, omitted: [] },
      rawFinalResponseSha256: "response-hash",
    });
    const bundle = await repository.getViewerNoteBundle(identity.id);
    expect(result.status).toBe("UPDATE");
    expect(result.version?.versionNumber).toBe(1);
    expect(bundle?.activeVersion?.content).toContain("sensory");
    expect(bundle?.versions).toHaveLength(1);
    expect(bundle?.activationEvents[0].activationSource).toBe("initial_version");
  });

  it("rejects a half-populated base before touching storage", async () => {
    const repository = new BrowserRepository();
    await expect(repository.beginViewerNoteReflection({
      id: "reflection",
      aiIdentityId: "identity",
      sourceSessionId: "session",
      sourceWorkspaceId: "workspace",
      baseContentSha256: "orphan-hash",
      reflectionPacketSha256: "packet-hash",
      packetJson: "{}",
    })).rejects.toThrow(/supplied together/);
  });
});
