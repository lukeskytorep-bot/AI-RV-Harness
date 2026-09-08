import { assertViewerNoteBasePair } from "../../aiCenter/baseVersion";
import type {
  AiIdentity,
  BeginViewerNoteReflectionInput,
  CommitViewerNoteReflectionInput,
  EnsureAiIdentityInput,
  ViewerNoteActivationEvent,
  ViewerNoteBundle,
  ViewerNoteCapacity,
  ViewerNoteReflectionResult,
  ViewerNoteReflectionRun,
  ViewerNoteSettings,
  ViewerNoteVersion,
} from "../../aiCenter/types";
import type { AiCenterRepository } from "../contracts/aiCenterRepository";
import { createId, nowIso } from "../repository";

const AI_IDENTITIES_KEY = "rvh.dev.ai_identities";
const AI_NOTE_SETTINGS_KEY = "rvh.dev.ai_note_settings";
const AI_NOTE_VERSIONS_KEY = "rvh.dev.ai_note_versions";
const AI_NOTE_REFLECTION_RUNS_KEY = "rvh.dev.ai_note_reflection_runs";
const AI_NOTE_ACTIVATION_EVENTS_KEY = "rvh.dev.ai_note_activation_events";

export interface BrowserAiCenterRepositoryDependencies {
  storage?: Storage;
  now?: typeof nowIso;
  createId?: typeof createId;
}

export class BrowserAiCenterRepository implements AiCenterRepository {
  private readonly storage: Storage;

  constructor(private readonly dependencies: BrowserAiCenterRepositoryDependencies = {}) {
    this.storage = dependencies.storage ?? localStorage;
  }

  private read<T>(key: string, fallback: T): T {
    try {
      const raw = this.storage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  }

  private write<T>(key: string, value: T): void {
    this.storage.setItem(key, JSON.stringify(value));
  }

  private now(): string {
    return (this.dependencies.now ?? nowIso)();
  }

  private nextId(prefix: string): string {
    return (this.dependencies.createId ?? createId)(prefix);
  }

  async ensureAiIdentity(input: EnsureAiIdentityInput): Promise<AiIdentity> {
    const identities = this.read<AiIdentity[]>(AI_IDENTITIES_KEY, []);
    const normalizedBaseUrl = input.baseUrl?.trim().replace(/\/+$/, "").toLowerCase();
    const existing = identities.find((item) => item.profileId === input.profileId
      && item.credentialFingerprint === input.credentialFingerprint
      && item.provider === input.provider
      && (item.normalizedBaseUrl ?? "") === (normalizedBaseUrl ?? "")
      && item.modelRoute === input.modelRoute
      && item.role === input.role);
    const timestamp = this.now();
    if (existing) {
      const updated: AiIdentity = { ...existing, providerConfigId: input.providerConfigId, modelId: input.modelId, modelDisplayName: input.modelDisplayName, credentialDisplay: input.credentialDisplay, routeStatus: "available", lastUsedAt: timestamp, updatedAt: timestamp };
      this.write(AI_IDENTITIES_KEY, identities.map((item) => item.id === updated.id ? updated : item));
      return updated;
    }
    const identity: AiIdentity = {
      id: this.nextId("ai_identity"), profileId: input.profileId, credentialFingerprint: input.credentialFingerprint,
      credentialDisplay: input.credentialDisplay, providerConfigId: input.providerConfigId, provider: input.provider,
      ...(normalizedBaseUrl ? { normalizedBaseUrl } : {}), modelId: input.modelId, modelRoute: input.modelRoute,
      modelDisplayName: input.modelDisplayName, role: input.role, routeStatus: "available", firstUsedAt: timestamp,
      lastUsedAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
    };
    this.write(AI_IDENTITIES_KEY, [identity, ...identities]);
    if (input.role === "viewer") {
      const settings = this.read<ViewerNoteSettings[]>(AI_NOTE_SETTINGS_KEY, []);
      this.write(AI_NOTE_SETTINGS_KEY, [...settings, { aiIdentityId: identity.id, noteType: "viewer_self_notes", capacityTokens: 1024, defaultEnabled: true, experimentalStatus: "experimental", updatedAt: timestamp }]);
    }
    return identity;
  }

  async listAiIdentities(profileId: string): Promise<AiIdentity[]> {
    return this.read<AiIdentity[]>(AI_IDENTITIES_KEY, []).filter((item) => item.profileId === profileId).sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
  }

  async getViewerNoteBundle(aiIdentityId: string): Promise<ViewerNoteBundle | null> {
    const identity = this.read<AiIdentity[]>(AI_IDENTITIES_KEY, []).find((item) => item.id === aiIdentityId);
    if (!identity) return null;
    let settings = this.read<ViewerNoteSettings[]>(AI_NOTE_SETTINGS_KEY, []).find((item) => item.aiIdentityId === aiIdentityId);
    if (!settings) {
      settings = { aiIdentityId, noteType: "viewer_self_notes", capacityTokens: 1024, defaultEnabled: true, experimentalStatus: "experimental", updatedAt: this.now() };
      this.write(AI_NOTE_SETTINGS_KEY, [...this.read<ViewerNoteSettings[]>(AI_NOTE_SETTINGS_KEY, []), settings]);
    }
    const versions = await this.listViewerNoteVersions(aiIdentityId);
    return { identity, settings, activeVersion: versions.find((item) => item.id === settings?.activeVersionId), versions, activationEvents: await this.listViewerNoteActivationEvents(aiIdentityId), reflectionRuns: await this.listViewerNoteReflectionRuns(aiIdentityId) };
  }

  async listViewerNoteVersions(aiIdentityId: string): Promise<ViewerNoteVersion[]> {
    return this.read<ViewerNoteVersion[]>(AI_NOTE_VERSIONS_KEY, []).filter((item) => item.aiIdentityId === aiIdentityId).sort((a, b) => b.versionNumber - a.versionNumber);
  }

  async listViewerNoteActivationEvents(aiIdentityId: string): Promise<ViewerNoteActivationEvent[]> {
    return this.read<ViewerNoteActivationEvent[]>(AI_NOTE_ACTIVATION_EVENTS_KEY, []).filter((item) => item.aiIdentityId === aiIdentityId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listViewerNoteReflectionRuns(aiIdentityId: string): Promise<ViewerNoteReflectionRun[]> {
    return this.read<ViewerNoteReflectionRun[]>(AI_NOTE_REFLECTION_RUNS_KEY, []).filter((item) => item.aiIdentityId === aiIdentityId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async setViewerNoteCapacity(aiIdentityId: string, capacityTokens: ViewerNoteCapacity): Promise<void> {
    const settings = this.read<ViewerNoteSettings[]>(AI_NOTE_SETTINGS_KEY, []);
    const current = settings.find((item) => item.aiIdentityId === aiIdentityId);
    if (!current) throw new Error("Viewer Notes settings not found.");
    const active = current.activeVersionId ? this.read<ViewerNoteVersion[]>(AI_NOTE_VERSIONS_KEY, []).find((item) => item.id === current.activeVersionId) : undefined;
    if (active && active.estimatedTokens > capacityTokens) throw new Error(`Capacity cannot be reduced below the active notes size (${active.estimatedTokens} estimated tokens).`);
    this.write(AI_NOTE_SETTINGS_KEY, settings.map((item) => item.aiIdentityId === aiIdentityId ? { ...item, capacityTokens, updatedAt: this.now() } : item));
  }

  async setViewerNotesDefaultEnabled(aiIdentityId: string, enabled: boolean): Promise<void> {
    const settings = this.read<ViewerNoteSettings[]>(AI_NOTE_SETTINGS_KEY, []);
    if (!settings.some((item) => item.aiIdentityId === aiIdentityId)) throw new Error("Viewer Notes settings not found.");
    this.write(AI_NOTE_SETTINGS_KEY, settings.map((item) => item.aiIdentityId === aiIdentityId ? { ...item, defaultEnabled: enabled, updatedAt: this.now() } : item));
  }

  async beginViewerNoteReflection(input: BeginViewerNoteReflectionInput): Promise<ViewerNoteReflectionRun> {
    assertViewerNoteBasePair(input);
    const all = this.read<ViewerNoteReflectionRun[]>(AI_NOTE_REFLECTION_RUNS_KEY, []);
    const existing = all.find((item) => item.id === input.id || (item.aiIdentityId === input.aiIdentityId && item.sourceSessionId === input.sourceSessionId));
    if (existing) return existing;
    const run: ViewerNoteReflectionRun = { ...input, noteType: "viewer_self_notes", attemptCount: 0, status: "PENDING", createdAt: this.now() };
    this.write(AI_NOTE_REFLECTION_RUNS_KEY, [run, ...all]);
    return run;
  }

  async failViewerNoteReflection(runId: string, status: Exclude<ViewerNoteReflectionRun["status"], "PENDING" | "UPDATE" | "NO_CHANGE" | "STALE_BASE">, failureMessage: string, providerRequestId?: string, rawFinalResponseSha256?: string, attemptCount = 1): Promise<void> {
    const all = this.read<ViewerNoteReflectionRun[]>(AI_NOTE_REFLECTION_RUNS_KEY, []);
    this.write(AI_NOTE_REFLECTION_RUNS_KEY, all.map((item) => item.id === runId ? { ...item, status, failureMessage, attemptCount: item.attemptCount + attemptCount, ...(providerRequestId ? { providerRequestId } : {}), ...(rawFinalResponseSha256 ? { rawFinalResponseSha256 } : {}), completedAt: this.now() } : item));
  }

  async commitViewerNoteReflection(input: CommitViewerNoteReflectionInput): Promise<ViewerNoteReflectionResult> {
    assertViewerNoteBasePair(input);
    const runs = this.read<ViewerNoteReflectionRun[]>(AI_NOTE_REFLECTION_RUNS_KEY, []);
    const run = runs.find((item) => item.id === input.runId);
    if (!run) throw new Error("Viewer Notes reflection run not found.");
    if (run.status === "UPDATE") return { status: "UPDATE", version: this.read<ViewerNoteVersion[]>(AI_NOTE_VERSIONS_KEY, []).find((item) => item.reflectionRunId === run.id) };
    if (run.status === "NO_CHANGE") return { status: "NO_CHANGE" };
    const settings = this.read<ViewerNoteSettings[]>(AI_NOTE_SETTINGS_KEY, []);
    const current = settings.find((item) => item.aiIdentityId === input.aiIdentityId);
    if (!current) throw new Error("Viewer Notes settings not found.");
    const versions = this.read<ViewerNoteVersion[]>(AI_NOTE_VERSIONS_KEY, []);
    const active = current.activeVersionId ? versions.find((item) => item.id === current.activeVersionId) : undefined;
    if ((active?.id ?? undefined) !== input.baseVersionId || (active?.contentSha256 ?? undefined) !== input.baseContentSha256) {
      this.write(AI_NOTE_REFLECTION_RUNS_KEY, runs.map((item) => item.id === run.id ? { ...item, status: "STALE_BASE", failureMessage: "Active Viewer Notes changed while reflection was running.", completedAt: this.now() } : item));
      return { status: "STALE_BASE" };
    }
    const completedAt = this.now();
    if (input.decision === "NO_CHANGE") {
      this.write(AI_NOTE_REFLECTION_RUNS_KEY, runs.map((item) => item.id === run.id ? { ...item, status: "NO_CHANGE", attemptCount: item.attemptCount + (input.attemptCount ?? 1), changeSummary: input.changeSummary, providerRequestId: input.providerRequestId, rawFinalResponseSha256: input.rawFinalResponseSha256, completedAt } : item));
      return { status: "NO_CHANGE" };
    }
    if (!input.notes || !input.contentSha256 || input.estimatedTokens === undefined) throw new Error("Complete Viewer Notes are required for UPDATE.");
    const version: ViewerNoteVersion = { id: this.nextId("ai_note_version"), aiIdentityId: input.aiIdentityId, versionNumber: Math.max(0, ...versions.filter((item) => item.aiIdentityId === input.aiIdentityId).map((item) => item.versionNumber)) + 1, content: input.notes, contentSha256: input.contentSha256, estimatedTokens: input.estimatedTokens, estimatorVersion: "conservative-char-v1", capacityTokensAtCreation: input.capacityTokens, sourceSessionId: input.sourceSessionId, sourceWorkspaceId: input.sourceWorkspaceId, protocolId: input.protocolId, sessionRunType: input.sessionRunType, changeSummary: input.changeSummary, ...(input.baseVersionId ? { baseVersionId: input.baseVersionId } : {}), ...(input.baseContentSha256 ? { baseContentSha256: input.baseContentSha256 } : {}), reflectionRunId: input.runId, reflectionPacketSha256: input.reflectionPacketSha256, modelRouteSnapshot: input.modelRouteSnapshot, generationSettingsSnapshot: input.generationSettingsSnapshot, createdAt: completedAt };
    const activation: ViewerNoteActivationEvent = { id: this.nextId("ai_note_activation"), aiIdentityId: input.aiIdentityId, ...(active ? { fromVersionId: active.id } : {}), toVersionId: version.id, activationSource: active ? "model_update" : "initial_version", workspaceId: input.sourceWorkspaceId, sourceSessionId: input.sourceSessionId, createdAt: completedAt };
    this.write(AI_NOTE_VERSIONS_KEY, [version, ...versions]);
    this.write(AI_NOTE_ACTIVATION_EVENTS_KEY, [activation, ...this.read<ViewerNoteActivationEvent[]>(AI_NOTE_ACTIVATION_EVENTS_KEY, [])]);
    this.write(AI_NOTE_SETTINGS_KEY, settings.map((item) => item.aiIdentityId === input.aiIdentityId ? { ...item, activeVersionId: version.id, updatedAt: completedAt } : item));
    this.write(AI_NOTE_REFLECTION_RUNS_KEY, runs.map((item) => item.id === run.id ? { ...item, status: "UPDATE", attemptCount: item.attemptCount + (input.attemptCount ?? 1), changeSummary: input.changeSummary, providerRequestId: input.providerRequestId, rawFinalResponseSha256: input.rawFinalResponseSha256, completedAt } : item));
    return { status: "UPDATE", version };
  }

  async restoreViewerNoteVersion(aiIdentityId: string, versionId: string, workspaceId?: string): Promise<void> {
    const settings = this.read<ViewerNoteSettings[]>(AI_NOTE_SETTINGS_KEY, []);
    const current = settings.find((item) => item.aiIdentityId === aiIdentityId);
    const version = this.read<ViewerNoteVersion[]>(AI_NOTE_VERSIONS_KEY, []).find((item) => item.id === versionId && item.aiIdentityId === aiIdentityId);
    if (!current || !version) throw new Error("Viewer Notes version not found.");
    if (version.estimatedTokens > current.capacityTokens) throw new Error("The selected version does not fit the current capacity.");
    const timestamp = this.now();
    this.write(AI_NOTE_SETTINGS_KEY, settings.map((item) => item.aiIdentityId === aiIdentityId ? { ...item, activeVersionId: version.id, updatedAt: timestamp } : item));
    this.write(AI_NOTE_ACTIVATION_EVENTS_KEY, [{ id: this.nextId("ai_note_activation"), aiIdentityId, ...(current.activeVersionId ? { fromVersionId: current.activeVersionId } : {}), toVersionId: version.id, activationSource: "human_restore", ...(workspaceId ? { workspaceId } : {}), createdAt: timestamp }, ...this.read<ViewerNoteActivationEvent[]>(AI_NOTE_ACTIVATION_EVENTS_KEY, [])]);
  }
}
