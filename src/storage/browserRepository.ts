import type { AppSettings, ChatMessage, ChatMode, ChatThread, ChatThreadGroup, CreateProfileInput, CreateWorkspaceInput, Profile, ProfileAiConfigurationInput, UpdateProfileInput, Workspace } from "../types";
import type { CreateProviderConfigInput, ProviderConfig, ProviderModel } from "../providers/types";
import type { CreateRvSessionInput, RevealInput, RvSession, RvSessionState, SessionEventInput, SessionEventRecord, SessionSnapshot, TargetClarificationRecord } from "../sessions/types";
import type { CreateMonitorRunInput, MonitorInterventionInput, MonitorInterventionRecord, MonitorRunRecord } from "../monitor/types";
import type { CreateJudgeRunInput, FrozenJudgeScoreInput, JudgeScoreRecord } from "../judge/types";
import { computeJudgeTotal } from "../domain/scoring";
import type { CreateTargetInput, TargetRecord, TargetUsageInput, TargetUsageRecord, UpdateTargetInput } from "../targets/types";
import type { CustomProtocolVersion, SaveCustomProtocolVersionInput } from "../protocols/types";
import type { BlindingMappingRecord, ResearchAssignmentRecord, ResearchConditionRecord, ResearchConfig, ResearchLockPlan, ResearchProjectRecord, ResearchResults, ResearchState } from "../research/types";
import type { CreateWorkspaceSourceInput, WorkspaceSource } from "../sources/types";
import type { AppRepository } from "./repository";
import { createId, nowIso } from "./repository";
import { serializePostRevealTurn } from "../sessions/postRevealTranscript";
import { verifySealedViewerEvidence } from "../sessions/evidence";
import { applyReasoningRegistryToProviderModel } from "../providers/modelReasoningRegistry";
import type { CreateTrainingRunInput, TrainingRunRecord, UpdateTrainingRunInput } from "../training/types";

const PROFILES_KEY = "rvh.dev.profiles";
const WORKSPACES_KEY = "rvh.dev.workspaces";
const SETTINGS_KEY = "rvh.dev.settings";
const PROVIDERS_KEY = "rvh.dev.providers";
const MODELS_KEY = "rvh.dev.models";
const RV_SESSIONS_KEY = "rvh.dev.rv_sessions";
const SESSION_EVENTS_KEY = "rvh.dev.session_events";
const SESSION_SNAPSHOTS_KEY = "rvh.dev.session_snapshots";
const REVEALS_KEY = "rvh.dev.reveals";
const CHAT_THREADS_KEY = "rvh.dev.chat_threads";
const CHAT_THREAD_GROUPS_KEY = "rvh.dev.chat_thread_groups";
const CHAT_MESSAGES_KEY = "rvh.dev.chat_messages";
const MONITOR_RUNS_KEY = "rvh.dev.monitor_runs";
const MONITOR_INTERVENTIONS_KEY = "rvh.dev.monitor_interventions";
const JUDGE_RUNS_KEY = "rvh.dev.judge_runs";
const JUDGE_SCORES_KEY = "rvh.dev.judge_scores";
const TARGETS_KEY = "rvh.dev.targets";
const TARGET_USAGE_KEY = "rvh.dev.target_usage";
const CUSTOM_PROTOCOLS_KEY = "rvh.dev.custom_protocols";
const RESEARCH_PROJECTS_KEY = "rvh.dev.research_projects";
const RESEARCH_CONDITIONS_KEY = "rvh.dev.research_conditions";
const RESEARCH_ASSIGNMENTS_KEY = "rvh.dev.research_assignments";
const BLINDING_MAPPINGS_KEY = "rvh.dev.blinding_mappings";
const RESEARCH_RESULTS_KEY = "rvh.dev.research_results";
const WORKSPACE_SOURCES_KEY = "rvh.dev.workspace_sources";
const CHAT_SOURCE_SELECTION_KEY = "rvh.dev.chat_source_selection";
const TARGET_CLARIFICATIONS_KEY = "rvh.dev.target_clarifications";
const TRAINING_RUNS_KEY = "rvh.dev.training_runs";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function isLegacyStarterTrainingTarget(target: TargetRecord): boolean {
  return target.collection === "training" && /^training_(?:[1-9]|10)$/.test(target.id);
}

export class BrowserRepository implements AppRepository {
  async createTrainingRun(input: CreateTrainingRunInput): Promise<TrainingRunRecord> {
    const all = read<TrainingRunRecord[]>(TRAINING_RUNS_KEY, []);
    const timestamp = nowIso();
    const run: TrainingRunRecord = { ...input, id: createId("training"), runNumber: Math.max(0, ...all.map((item) => item.runNumber)) + 1, completedTargetIds: [], sessionIds: [], currentIndex: 0, errors: [], createdAt: timestamp, updatedAt: timestamp };
    write(TRAINING_RUNS_KEY, [run, ...all]);
    return run;
  }

  async updateTrainingRun(id: string, input: UpdateTrainingRunInput): Promise<void> {
    write(TRAINING_RUNS_KEY, read<TrainingRunRecord[]>(TRAINING_RUNS_KEY, []).map((run) => run.id === id ? { ...run, ...input, errors: input.error ? [...run.errors, input.error] : run.errors, updatedAt: nowIso() } : run));
  }

  async listTrainingRuns(): Promise<TrainingRunRecord[]> {
    return read<TrainingRunRecord[]>(TRAINING_RUNS_KEY, []).map((run) => ({ ...run, sessionIds: run.sessionIds ?? [] })).sort((a, b) => b.runNumber - a.runNumber);
  }

  async createDatabaseSnapshot(_destinationPath: string): Promise<void> {
    throw new Error("Backup snapshots are available in the desktop app.");
  }

  async closeForRestore(): Promise<void> {
    throw new Error("Restore is available in the desktop app.");
  }

  async listProfiles(): Promise<Profile[]> {
    return read<Profile[]>(PROFILES_KEY, []).filter((profile) => !profile.archivedAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async createProfile(input: CreateProfileInput): Promise<Profile> {
    const profiles = read<Profile[]>(PROFILES_KEY, []);
    const timestamp = nowIso();
    const profile: Profile = {
      id: createId("profile"),
      name: input.name.trim(),
      humanName: input.humanName?.trim() || undefined,
      note: input.note?.trim() || undefined,
      credentialId: input.aiConfiguration?.credentialId,
      credentialProvider: input.aiConfiguration?.credentialProvider,
      defaultViewerModelId: input.aiConfiguration?.defaultViewerModelId,
      defaultViewerReasoningEffort: input.aiConfiguration?.defaultViewerReasoningEffort,
      defaultViewerTemperature: input.aiConfiguration?.defaultViewerTemperature,
      defaultViewerSystemPrompt: input.aiConfiguration?.defaultViewerSystemPrompt?.trim() || undefined,
      defaultMonitorSystemPrompt: input.aiConfiguration?.defaultMonitorSystemPrompt?.trim() || undefined,
      defaultMonitorProviderConfigId: input.aiConfiguration?.defaultMonitorProviderConfigId,
      defaultMonitorModelId: input.aiConfiguration?.defaultMonitorModelId,
      defaultJudgeProviderConfigId: input.aiConfiguration?.defaultJudgeProviderConfigId,
      defaultJudgeModelId: input.aiConfiguration?.defaultJudgeModelId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    write(PROFILES_KEY, [profile, ...profiles]);
    return profile;
  }

  async updateProfile(id: string, input: UpdateProfileInput): Promise<void> {
    const name = input.name.trim();
    write(PROFILES_KEY, read<Profile[]>(PROFILES_KEY, []).map((profile) => profile.id === id ? { ...profile, name, humanName: input.humanName?.trim() || undefined, note: input.note?.trim() || undefined, updatedAt: nowIso() } : profile));
  }

  async archiveProfile(id: string): Promise<void> {
    const timestamp = nowIso();
    write(PROFILES_KEY, read<Profile[]>(PROFILES_KEY, []).map((profile) => profile.id === id ? { ...profile, archivedAt: timestamp, updatedAt: timestamp } : profile));
    write(WORKSPACES_KEY, read<Workspace[]>(WORKSPACES_KEY, []).map((workspace) => workspace.profileId === id ? { ...workspace, archivedAt: timestamp, updatedAt: timestamp } : workspace));
  }

  async setProfileAiConfiguration(profileId: string, input: ProfileAiConfigurationInput): Promise<void> {
    const timestamp = nowIso();
    write(
      PROFILES_KEY,
      read<Profile[]>(PROFILES_KEY, []).map((profile) =>
        profile.id === profileId
          ? {
              ...profile,
              credentialId: input.credentialId,
              credentialProvider: input.credentialProvider,
              defaultViewerModelId: input.defaultViewerModelId,
              defaultViewerReasoningEffort: input.defaultViewerReasoningEffort,
              defaultViewerTemperature: input.defaultViewerTemperature,
              defaultViewerSystemPrompt: input.defaultViewerSystemPrompt?.trim() || undefined,
              defaultMonitorSystemPrompt: input.defaultMonitorSystemPrompt?.trim() || undefined,
              defaultMonitorProviderConfigId: input.defaultMonitorProviderConfigId,
              defaultMonitorModelId: input.defaultMonitorModelId,
              defaultJudgeProviderConfigId: input.defaultJudgeProviderConfigId,
              defaultJudgeModelId: input.defaultJudgeModelId,
              updatedAt: timestamp,
            }
          : profile,
      ),
    );
  }

  async listWorkspaces(profileId?: string): Promise<Workspace[]> {
    const all = read<Workspace[]>(WORKSPACES_KEY, []);
    return all
      .filter((workspace) => !workspace.archivedAt && (!profileId || workspace.profileId === profileId))
      .sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
  }

  async createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
    const all = read<Workspace[]>(WORKSPACES_KEY, []);
    const timestamp = nowIso();
    const workspace: Workspace = {
      id: createId("workspace"),
      profileId: input.profileId,
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastOpenedAt: timestamp,
    };
    write(WORKSPACES_KEY, [workspace, ...all]);
    return workspace;
  }

  async touchWorkspace(id: string): Promise<void> {
    const all = read<Workspace[]>(WORKSPACES_KEY, []);
    const timestamp = nowIso();
    write(
      WORKSPACES_KEY,
      all.map((workspace) =>
        workspace.id === id ? { ...workspace, updatedAt: timestamp, lastOpenedAt: timestamp } : workspace,
      ),
    );
  }

  async setProfileCredential(profileId: string, credentialId?: string, provider?: string): Promise<void> {
    const timestamp = nowIso();
    write(
      PROFILES_KEY,
      read<Profile[]>(PROFILES_KEY, []).map((profile) =>
        profile.id === profileId
          ? { ...profile, credentialId, credentialProvider: provider, defaultViewerModelId: undefined, defaultViewerReasoningEffort: undefined, defaultViewerTemperature: undefined, updatedAt: timestamp }
          : profile,
      ),
    );
  }

  async listChatThreadGroups(workspaceId: string, mode: ChatMode): Promise<ChatThreadGroup[]> {
    const allGroups = read<ChatThreadGroup[]>(CHAT_THREAD_GROUPS_KEY, []);
    let relevant = allGroups
      .filter((group) => group.workspaceId === workspaceId && group.mode === mode && !group.archivedAt)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt));
    const legacyThreads = read<ChatThread[]>(CHAT_THREADS_KEY, []).filter((thread) => thread.workspaceId === workspaceId && thread.mode === mode && !thread.archivedAt && !thread.threadGroupId);
    if (!relevant.length && legacyThreads.length) {
      const timestamp = nowIso();
      const legacyGroup: ChatThreadGroup = { id: `legacy_group_${workspaceId}_${mode}`, workspaceId, mode, title: "Thread 1", createdAt: legacyThreads.reduce((oldest, thread) => thread.createdAt < oldest ? thread.createdAt : oldest, legacyThreads[0].createdAt), updatedAt: timestamp };
      write(CHAT_THREAD_GROUPS_KEY, [...allGroups, legacyGroup]);
      write(CHAT_THREADS_KEY, read<ChatThread[]>(CHAT_THREADS_KEY, []).map((thread) => legacyThreads.some((legacy) => legacy.id === thread.id) ? { ...thread, threadGroupId: legacyGroup.id } : thread));
      relevant = [legacyGroup];
    }
    return relevant;
  }

  async createChatThreadGroup(workspaceId: string, mode: ChatMode, title?: string): Promise<ChatThreadGroup> {
    const all = read<ChatThreadGroup[]>(CHAT_THREAD_GROUPS_KEY, []);
    const timestamp = nowIso();
    const group: ChatThreadGroup = {
      id: createId("thread_group"),
      workspaceId,
      mode,
      title: title?.trim().slice(0, 160) || `Thread ${all.filter((item) => item.workspaceId === workspaceId && item.mode === mode).length + 1}`,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    write(CHAT_THREAD_GROUPS_KEY, [...all, group]);
    return group;
  }

  async renameChatThreadGroup(groupId: string, title: string): Promise<void> {
    const clean = title.trim();
    if (!clean) throw new Error("Thread title is required.");
    write(CHAT_THREAD_GROUPS_KEY, read<ChatThreadGroup[]>(CHAT_THREAD_GROUPS_KEY, []).map((group) => group.id === groupId ? { ...group, title: clean.slice(0, 160), updatedAt: nowIso() } : group));
  }

  async archiveChatThreadGroup(groupId: string): Promise<void> {
    const groups = read<ChatThreadGroup[]>(CHAT_THREAD_GROUPS_KEY, []);
    const group = groups.find((item) => item.id === groupId && !item.archivedAt);
    if (!group) throw new Error("Thread not found.");
    const activeConversation = read<ChatThread[]>(CHAT_THREADS_KEY, []).find((item) => item.threadGroupId === groupId && item.formalRvState === "BLIND" && !item.archivedAt);
    if (activeConversation) throw new Error("A Thread containing a blind Manual RV conversation cannot be archived.");
    const timestamp = nowIso();
    write(CHAT_THREAD_GROUPS_KEY, groups.map((item) => item.id === groupId ? { ...item, archivedAt: timestamp, updatedAt: timestamp } : item));
    write(CHAT_THREADS_KEY, read<ChatThread[]>(CHAT_THREADS_KEY, []).map((item) => item.threadGroupId === groupId && !item.archivedAt ? { ...item, archivedAt: timestamp, updatedAt: timestamp } : item));
  }

  async listChatThreads(workspaceId: string, mode: ChatMode): Promise<ChatThread[]> {
    return read<ChatThread[]>(CHAT_THREADS_KEY, [])
      .filter((thread) => thread.workspaceId === workspaceId && thread.mode === mode && !thread.archivedAt)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt));
  }

  async createChatThread(workspaceId: string, mode: ChatMode, title?: string, threadGroupId?: string): Promise<ChatThread> {
    const all = read<ChatThread[]>(CHAT_THREADS_KEY, []);
    const timestamp = nowIso();
    const thread: ChatThread = {
      id: createId("thread"), workspaceId, mode, threadGroupId,
      title: title?.trim().slice(0, 160) || (mode === "conversation" ? "Conversation" : "Manual RV Session"),
      createdAt: timestamp, updatedAt: timestamp,
    };
    write(CHAT_THREADS_KEY, [...all, thread]);
    return thread;
  }

  async getOrCreateChatThread(workspaceId: string, mode: ChatMode): Promise<ChatThread> {
    const existing = (await this.listChatThreads(workspaceId, mode))[0];
    if (!existing) return this.createChatThread(workspaceId, mode);
    await this.touchChatThread(existing.id);
    return { ...existing, updatedAt: nowIso() };
  }

  async touchChatThread(threadId: string): Promise<void> {
    const timestamp = nowIso();
    write(CHAT_THREADS_KEY, read<ChatThread[]>(CHAT_THREADS_KEY, []).map((thread) => thread.id === threadId && !thread.archivedAt ? { ...thread, updatedAt: timestamp } : thread));
  }

  async renameChatThread(threadId: string, title: string): Promise<void> {
    const clean = title.trim();
    if (!clean) throw new Error("Thread title is required.");
    write(CHAT_THREADS_KEY, read<ChatThread[]>(CHAT_THREADS_KEY, []).map((thread) => thread.id === threadId ? { ...thread, title: clean.slice(0, 160), updatedAt: nowIso() } : thread));
  }

  async archiveChatThread(threadId: string): Promise<void> {
    const threads = read<ChatThread[]>(CHAT_THREADS_KEY, []);
    const thread = threads.find((item) => item.id === threadId && !item.archivedAt);
    if (!thread) throw new Error("Chat thread not found.");
    if (thread.formalRvState === "BLIND") throw new Error("A blind Manual RV thread must be ended before it can be archived.");
    const timestamp = nowIso();
    write(CHAT_THREADS_KEY, threads.map((item) => item.id === threadId ? { ...item, archivedAt: timestamp, updatedAt: timestamp } : item));
  }

  async setChatThreadFormalRvState(threadId: string, state?: ChatThread["formalRvState"]): Promise<void> {
    write(CHAT_THREADS_KEY, read<ChatThread[]>(CHAT_THREADS_KEY, []).map((thread) => thread.id === threadId && thread.mode === "manual_rv" ? { ...thread, formalRvState: state, updatedAt: nowIso() } : thread));
  }

  async listChatMessages(threadId: string): Promise<ChatMessage[]> {
    return read<ChatMessage[]>(CHAT_MESSAGES_KEY, []).filter((message) => message.threadId === threadId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async appendChatMessage(threadId: string, role: ChatMessage["role"], content: string): Promise<ChatMessage> {
    const message: ChatMessage = { id: createId("message"), threadId, role, content, createdAt: nowIso() };
    write(CHAT_MESSAGES_KEY, [...read<ChatMessage[]>(CHAT_MESSAGES_KEY, []), message]);
    const timestamp = nowIso();
    write(CHAT_THREADS_KEY, read<ChatThread[]>(CHAT_THREADS_KEY, []).map((thread) => thread.id === threadId ? { ...thread, updatedAt: timestamp } : thread));
    return message;
  }

  async listWorkspaceSources(workspaceId: string): Promise<WorkspaceSource[]> {
    return read<WorkspaceSource[]>(WORKSPACE_SOURCES_KEY, []).filter((source) => source.workspaceId === workspaceId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createWorkspaceSource(input: CreateWorkspaceSourceInput): Promise<WorkspaceSource> {
    const source: WorkspaceSource = { id: input.id, workspaceId: input.workspaceId, sourceType: input.sourceType, displayName: input.displayName.trim(), content: input.content, contentHash: input.contentHash, metadata: input.metadata ?? {}, createdAt: nowIso() };
    write(WORKSPACE_SOURCES_KEY, [source, ...read<WorkspaceSource[]>(WORKSPACE_SOURCES_KEY, [])]);
    return source;
  }

  async deleteWorkspaceSource(id: string): Promise<void> {
    write(WORKSPACE_SOURCES_KEY, read<WorkspaceSource[]>(WORKSPACE_SOURCES_KEY, []).filter((source) => source.id !== id));
    const selections = read<Record<string, string[]>>(CHAT_SOURCE_SELECTION_KEY, {});
    for (const key of Object.keys(selections)) selections[key] = selections[key].filter((sourceId) => sourceId !== id);
    write(CHAT_SOURCE_SELECTION_KEY, selections);
  }

  async listActiveChatSourceIds(threadId: string): Promise<string[]> {
    return read<Record<string, string[]>>(CHAT_SOURCE_SELECTION_KEY, {})[threadId] ?? [];
  }

  async setChatSourceActive(threadId: string, sourceId: string, active: boolean): Promise<void> {
    const all = read<Record<string, string[]>>(CHAT_SOURCE_SELECTION_KEY, {});
    const current = all[threadId] ?? [];
    all[threadId] = active ? [...new Set([...current, sourceId])] : current.filter((id) => id !== sourceId);
    write(CHAT_SOURCE_SELECTION_KEY, all);
  }

  async loadSettings(): Promise<Partial<AppSettings>> {
    return read<Partial<AppSettings>>(SETTINGS_KEY, {});
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    write(SETTINGS_KEY, settings);
  }

  async listProviderConfigs(): Promise<ProviderConfig[]> {
    return read<ProviderConfig[]>(PROVIDERS_KEY, []).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async createProviderConfig(input: CreateProviderConfigInput): Promise<ProviderConfig> {
    const timestamp = nowIso();
    const provider: ProviderConfig = {
      id: input.id,
      provider: input.provider,
      label: input.label.trim(),
      credentialId: input.credentialId,
      credentialHint: input.credentialHint,
      credentialFingerprint: input.fingerprint,
      baseUrl: input.baseUrl?.trim() || undefined,
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    write(PROVIDERS_KEY, [provider, ...(await this.listProviderConfigs())]);
    return provider;
  }

  async updateProviderCredentialMetadata(id: string, credentialHint: string, fingerprint: string): Promise<void> {
    const timestamp = nowIso();
    write(
      PROVIDERS_KEY,
      (await this.listProviderConfigs()).map((item) => item.id === id
        ? { ...item, credentialHint, credentialFingerprint: fingerprint, lastStatus: undefined, lastError: undefined, lastTestedAt: undefined, updatedAt: timestamp }
        : item),
    );
  }

  async deleteProviderConfig(id: string): Promise<void> {
    const removed = (await this.listProviderConfigs()).find((item) => item.id === id);
    write(PROVIDERS_KEY, (await this.listProviderConfigs()).filter((item) => item.id !== id));
    write(MODELS_KEY, read<ProviderModel[]>(MODELS_KEY, []).filter((item) => item.providerConfigId !== id));
    if (removed) {
      const timestamp = nowIso();
      write(PROFILES_KEY, read<Profile[]>(PROFILES_KEY, []).map((profile) => {
        const ownsRemovedCredential = profile.credentialId === removed.credentialId;
        const usesRemovedMonitor = profile.defaultMonitorProviderConfigId === id;
        const usesRemovedJudge = profile.defaultJudgeProviderConfigId === id;
        if (!ownsRemovedCredential && !usesRemovedMonitor && !usesRemovedJudge) return profile;
        return {
          ...profile,
          ...(ownsRemovedCredential ? {
            credentialId: undefined,
            credentialProvider: undefined,
            defaultViewerModelId: undefined,
            defaultViewerReasoningEffort: undefined,
            defaultViewerTemperature: undefined,
          } : {}),
          ...(usesRemovedMonitor ? { defaultMonitorProviderConfigId: undefined, defaultMonitorModelId: undefined } : {}),
          ...(usesRemovedJudge ? { defaultJudgeProviderConfigId: undefined, defaultJudgeModelId: undefined } : {}),
          updatedAt: timestamp,
        };
      }));
    }
  }

  async updateProviderConnectionStatus(id: string, status: "ok" | "error", error?: string): Promise<void> {
    const timestamp = nowIso();
    write(
      PROVIDERS_KEY,
      (await this.listProviderConfigs()).map((item) =>
        item.id === id
          ? { ...item, lastTestedAt: timestamp, lastStatus: status, lastError: error, updatedAt: timestamp }
          : item,
      ),
    );
  }

  async listProviderModels(providerConfigId?: string): Promise<ProviderModel[]> {
    return read<ProviderModel[]>(MODELS_KEY, [])
      .filter((item) => !providerConfigId || item.providerConfigId === providerConfigId)
      .map(applyReasoningRegistryToProviderModel)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  async replaceProviderModels(providerConfigId: string, models: ProviderModel[]): Promise<void> {
    const current = read<ProviderModel[]>(MODELS_KEY, []);
    const favorites = new Set(current.filter((item) => item.providerConfigId === providerConfigId && item.favorite).map((item) => item.modelId));
    const existing = current.filter((item) => item.providerConfigId !== providerConfigId);
    write(MODELS_KEY, [...existing, ...models.map((model) => ({ ...model, favorite: Boolean(model.favorite || favorites.has(model.modelId)) }))]);
  }

  async setProviderModelFavorite(providerConfigId: string, modelId: string, favorite: boolean): Promise<void> {
    write(MODELS_KEY, read<ProviderModel[]>(MODELS_KEY, []).map((model) =>
      model.providerConfigId === providerConfigId && model.modelId === modelId ? { ...model, favorite } : model,
    ));
  }

  async clearProviderModelCache(): Promise<void> {
    write(MODELS_KEY, []);
  }

  async listTargets(collection?: TargetRecord["collection"]): Promise<TargetRecord[]> {
    return read<TargetRecord[]>(TARGETS_KEY, [])
      .filter((target) => !isLegacyStarterTrainingTarget(target))
      .filter((target) => !collection || target.collection === collection)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async createTarget(input: CreateTargetInput): Promise<TargetRecord> {
    const timestamp = nowIso();
    const target: TargetRecord = {
      id: input.id,
      collection: input.collection,
      title: input.title.trim(),
      revealText: input.revealText?.trim() || undefined,
      revealArtifactPath: input.revealArtifactPath,
      revealArtifacts: input.revealArtifacts ?? [],
      tags: input.tags ?? [],
      sourceMetadata: input.sourceMetadata ?? {},
      contentHash: input.contentHash,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    write(TARGETS_KEY, [target, ...read<TargetRecord[]>(TARGETS_KEY, [])]);
    return target;
  }

  async updateTarget(id: string, input: UpdateTargetInput): Promise<TargetRecord> {
    const all = read<TargetRecord[]>(TARGETS_KEY, []);
    const target = all.find((item) => item.id === id);
    if (!target || target.collection !== "user") throw new Error("User target not found.");
    if (this.targetHasRecordedUse(id)) throw new Error("Used targets are locked to preserve session and Research integrity.");
    const updated: TargetRecord = { ...target, title: input.title.trim(), revealText: input.revealText?.trim() || undefined, tags: [...input.tags], contentHash: input.contentHash, updatedAt: nowIso() };
    write(TARGETS_KEY, all.map((item) => item.id === id ? updated : item));
    return updated;
  }

  async deleteTarget(id: string): Promise<void> {
    const all = read<TargetRecord[]>(TARGETS_KEY, []);
    const target = all.find((item) => item.id === id);
    if (!target || target.collection !== "user") throw new Error("User target not found.");
    if (this.targetHasRecordedUse(id)) throw new Error("Used targets are locked to preserve session and Research integrity.");
    write(TARGETS_KEY, all.filter((item) => item.id !== id));
  }

  private targetHasRecordedUse(id: string): boolean {
    return read<TargetUsageRecord[]>(TARGET_USAGE_KEY, []).some((item) => item.targetId === id)
      || read<RvSession[]>(RV_SESSIONS_KEY, []).some((item) => item.targetId === id)
      || read<ResearchAssignmentRecord[]>(RESEARCH_ASSIGNMENTS_KEY, []).some((item) => item.targetId === id);
  }

  async recordTargetUsage(input: TargetUsageInput): Promise<void> {
    write(TARGET_USAGE_KEY, [...read<Array<TargetUsageInput & { id: string; usedAt: string }>>(TARGET_USAGE_KEY, []), { ...input, id: createId("target_usage"), usedAt: nowIso() }]);
  }

  async listTargetUsage(): Promise<TargetUsageRecord[]> {
    return read<TargetUsageRecord[]>(TARGET_USAGE_KEY, []).sort((a, b) => b.usedAt.localeCompare(a.usedAt));
  }

  async listCustomProtocols(language?: "pl" | "en"): Promise<CustomProtocolVersion[]> {
    return read<CustomProtocolVersion[]>(CUSTOM_PROTOCOLS_KEY, []).filter((protocol) => !language || protocol.language === language).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async saveCustomProtocolVersion(input: SaveCustomProtocolVersionInput): Promise<CustomProtocolVersion> {
    const all = read<CustomProtocolVersion[]>(CUSTOM_PROTOCOLS_KEY, []);
    const record: CustomProtocolVersion = { ...input, steps: [...input.steps] };
    write(CUSTOM_PROTOCOLS_KEY, [record, ...all]);
    return record;
  }

  async createRvSession(input: CreateRvSessionInput): Promise<RvSession> {
    const timestamp = nowIso();
    const session: RvSession = {
      id: input.id,
      workspaceId: input.workspaceId,
      profileId: input.profileId,
      sessionCode: input.sessionCode,
      state: "Draft",
      runType: input.runType,
      preRevealTranscript: "",
      postRevealTranscript: "",
      targetId: input.targetId,
      researchProjectId: input.researchProjectId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    write(RV_SESSIONS_KEY, [session, ...read<RvSession[]>(RV_SESSIONS_KEY, [])]);
    return session;
  }

  async updateRvSessionState(id: string, state: RvSessionState, stopReason?: string): Promise<void> {
    const timestamp = nowIso();
    write(
      RV_SESSIONS_KEY,
      read<RvSession[]>(RV_SESSIONS_KEY, []).map((session) =>
        session.id === id ? { ...session, state, updatedAt: timestamp, ...(state === "Completed" ? { completedAt: timestamp } : {}) } : session,
      ),
    );
    if (stopReason) await this.appendSessionEvent(id, { eventType: "SESSION_STOPPED", role: "controller", content: stopReason });
  }

  async appendPostRevealTurn(sessionId: string, role: "user" | "assistant" | "monitor", content: string): Promise<string> {
    const sessions = read<RvSession[]>(RV_SESSIONS_KEY, []);
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) throw new Error("RV session not found.");
    if (session.state !== "Revealed" && session.state !== "Completed") throw new Error("Post-reveal discussion requires Reveal.");
    if (session.researchProjectId) {
      const project = read<ResearchProjectRecord[]>(RESEARCH_PROJECTS_KEY, []).find((item) => item.id === session.researchProjectId);
      if (!project?.scoresFrozenAt) throw new Error("Research post-reveal discussion requires frozen scores.");
    }
    const next = `${session.postRevealTranscript}${serializePostRevealTurn(role, content)}`;
    const timestamp = nowIso();
    write(RV_SESSIONS_KEY, sessions.map((item) => item.id === sessionId ? { ...item, postRevealTranscript: next, updatedAt: timestamp } : item));
    await this.appendSessionEvent(sessionId, { eventType: `POST_REVEAL_${role.toUpperCase()}`, role, content: content.trim() });
    return next;
  }

  async appendSessionEvent(sessionId: string, event: SessionEventInput): Promise<void> {
    const all = read<SessionEventRecord[]>(SESSION_EVENTS_KEY, []);
    const sequenceNumber = all.filter((item) => item.sessionId === sessionId).reduce((max, item) => Math.max(max, item.sequenceNumber), 0) + 1;
    write(SESSION_EVENTS_KEY, [...all, { ...event, id: createId("event"), sessionId, sequenceNumber, createdAt: nowIso() }]);
  }

  async listSessionEvents(sessionId: string): Promise<SessionEventRecord[]> {
    return read<SessionEventRecord[]>(SESSION_EVENTS_KEY, [])
      .filter((event) => event.sessionId === sessionId)
      .sort((left, right) => left.sequenceNumber - right.sequenceNumber)
      .map((event) => structuredClone(event));
  }

  async updatePreRevealTranscript(sessionId: string, transcript: string): Promise<void> {
    write(RV_SESSIONS_KEY, read<RvSession[]>(RV_SESSIONS_KEY, []).map((session) => session.id === sessionId && !session.preRevealSealedAt ? { ...session, preRevealTranscript: transcript, updatedAt: nowIso() } : session));
  }

  async saveSessionSnapshot(sessionId: string, snapshot: SessionSnapshot, hash: string): Promise<void> {
    const all = read<Array<{ sessionId: string; snapshot: SessionSnapshot; hash: string }>>(SESSION_SNAPSHOTS_KEY, []);
    if (all.some((item) => item.sessionId === sessionId)) throw new Error("session snapshots are immutable");
    write(SESSION_SNAPSHOTS_KEY, [...all, { sessionId, snapshot, hash }]);
  }

  async getSessionSnapshot(sessionId: string): Promise<SessionSnapshot | null> {
    return read<Array<{ sessionId: string; snapshot: SessionSnapshot; hash: string }>>(SESSION_SNAPSHOTS_KEY, []).find((item) => item.sessionId === sessionId)?.snapshot ?? null;
  }

  async sealPreReveal(sessionId: string, transcript: string, hash: string): Promise<void> {
    const timestamp = nowIso();
    write(RV_SESSIONS_KEY, read<RvSession[]>(RV_SESSIONS_KEY, []).map((session) => session.id === sessionId ? { ...session, preRevealTranscript: transcript, preRevealHash: hash, preRevealSealedAt: timestamp, state: "AwaitingReveal", updatedAt: timestamp } : session));
  }

  async acceptReveal(sessionId: string, reveal: RevealInput): Promise<void> {
    const reveals = read<Array<{ sessionId: string; reveal: RevealInput; acceptedAt: string }>>(REVEALS_KEY, []);
    if (reveals.some((item) => item.sessionId === sessionId)) throw new Error("reveal already exists");
    write(REVEALS_KEY, [...reveals, { sessionId, reveal, acceptedAt: nowIso() }]);
    await this.updateRvSessionState(sessionId, "Revealed");
  }

  async getReveal(sessionId: string): Promise<RevealInput | null> {
    const item = read<Array<{ sessionId: string; reveal: RevealInput; acceptedAt: string }>>(REVEALS_KEY, []).find((entry) => entry.sessionId === sessionId);
    return item ? structuredClone(item.reveal) : null;
  }

  async getViewerEvidence(sessionId: string): Promise<string> {
    const session = read<RvSession[]>(RV_SESSIONS_KEY, []).find((item) => item.id === sessionId);
    if (!session?.preRevealSealedAt || !session.preRevealHash) return "";
    return verifySealedViewerEvidence(session.preRevealTranscript, session.preRevealHash);
  }

  async listRvSessions(workspaceId: string): Promise<RvSession[]> {
    return read<RvSession[]>(RV_SESSIONS_KEY, []).filter((session) => session.workspaceId === workspaceId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async addTargetClarification(sessionId: string, content: string): Promise<TargetClarificationRecord> {
    const clean = content.trim();
    if (!clean) throw new Error("Target clarification cannot be empty.");
    const session = read<RvSession[]>(RV_SESSIONS_KEY, []).find((item) => item.id === sessionId);
    if (!session || (session.state !== "Revealed" && session.state !== "Completed")) throw new Error("Target clarification is available only after Reveal.");
    if (session.researchProjectId) {
      const project = read<ResearchProjectRecord[]>(RESEARCH_PROJECTS_KEY, []).find((item) => item.id === session.researchProjectId);
      if (!project?.scoresFrozenAt) throw new Error("Research target clarification requires frozen Judge scores.");
    }
    const record: TargetClarificationRecord = { id: createId("clarification"), sessionId, content: clean, createdAt: nowIso() };
    write(TARGET_CLARIFICATIONS_KEY, [...read<TargetClarificationRecord[]>(TARGET_CLARIFICATIONS_KEY, []), record]);
    return record;
  }

  async listTargetClarifications(sessionId: string): Promise<TargetClarificationRecord[]> {
    return read<TargetClarificationRecord[]>(TARGET_CLARIFICATIONS_KEY, []).filter((item) => item.sessionId === sessionId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async createMonitorRun(input: CreateMonitorRunInput): Promise<string> {
    const id = createId("monitor");
    const all = read<Array<CreateMonitorRunInput & { id: string; createdAt: string }>>(MONITOR_RUNS_KEY, []);
    write(MONITOR_RUNS_KEY, [...all, { ...input, id, createdAt: nowIso() }]);
    return id;
  }

  async appendMonitorIntervention(monitorRunId: string, intervention: MonitorInterventionInput): Promise<void> {
    const all = read<Array<MonitorInterventionInput & { id: string; monitorRunId: string; sequenceNumber: number; createdAt: string }>>(MONITOR_INTERVENTIONS_KEY, []);
    const sequenceNumber = all.filter((item) => item.monitorRunId === monitorRunId).reduce((max, item) => Math.max(max, item.sequenceNumber), 0) + 1;
    write(MONITOR_INTERVENTIONS_KEY, [...all, { ...intervention, id: createId("monitor_event"), monitorRunId, sequenceNumber, createdAt: nowIso() }]);
  }

  async listMonitorRuns(workspaceId: string): Promise<MonitorRunRecord[]> {
    const sessions = read<RvSession[]>(RV_SESSIONS_KEY, []);
    const sessionMap = new Map(sessions.filter((session) => session.workspaceId === workspaceId).map((session) => [session.id, session]));
    const interventions = read<MonitorInterventionRecord[]>(MONITOR_INTERVENTIONS_KEY, []);
    return read<Array<CreateMonitorRunInput & { id: string; createdAt: string }>>(MONITOR_RUNS_KEY, []).filter((run) => sessionMap.has(run.sessionId)).map((run) => ({ ...run, sessionCode: sessionMap.get(run.sessionId)!.sessionCode, interventionCount: interventions.filter((item) => item.monitorRunId === run.id).length })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listMonitorInterventions(monitorRunId: string): Promise<MonitorInterventionRecord[]> {
    return read<MonitorInterventionRecord[]>(MONITOR_INTERVENTIONS_KEY, []).filter((item) => item.monitorRunId === monitorRunId).sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  }

  async recordFrozenJudgeResult(run: CreateJudgeRunInput, score: FrozenJudgeScoreInput): Promise<JudgeScoreRecord> {
    const runs = read<CreateJudgeRunInput[]>(JUDGE_RUNS_KEY, []);
    if (runs.some((item) => item.sessionId === run.sessionId && item.judgeIndex === run.judgeIndex)) throw new Error("Judge index is already recorded for this session.");
    const timestamp = nowIso();
    const record: JudgeScoreRecord = {
      ...score,
      judgeIndex: run.judgeIndex,
      modelRoute: run.modelRoute,
      total: computeJudgeTotal(score),
      frozenAt: timestamp,
      createdAt: timestamp,
    };
    write(JUDGE_RUNS_KEY, [...runs, structuredClone(run)]);
    write(JUDGE_SCORES_KEY, [...read<JudgeScoreRecord[]>(JUDGE_SCORES_KEY, []), structuredClone(record)]);
    return record;
  }

  async listJudgeScores(sessionId: string): Promise<JudgeScoreRecord[]> {
    const runIds = new Set(read<CreateJudgeRunInput[]>(JUDGE_RUNS_KEY, []).filter((run) => run.sessionId === sessionId).map((run) => run.id));
    return read<JudgeScoreRecord[]>(JUDGE_SCORES_KEY, []).filter((score) => runIds.has(score.judgeRunId)).sort((a, b) => a.judgeIndex - b.judgeIndex);
  }

  async createResearchProject(config: ResearchConfig): Promise<ResearchProjectRecord> {
    const timestamp = nowIso();
    const project: ResearchProjectRecord = { id: createId("research"), workspaceId: config.workspaceId, name: config.name.trim(), templateType: config.templateType, state: "Draft", config: structuredClone(config), createdAt: timestamp, updatedAt: timestamp };
    write(RESEARCH_PROJECTS_KEY, [project, ...read<ResearchProjectRecord[]>(RESEARCH_PROJECTS_KEY, [])]);
    return project;
  }

  async getResearchProject(id: string): Promise<ResearchProjectRecord | null> {
    return read<ResearchProjectRecord[]>(RESEARCH_PROJECTS_KEY, []).find((project) => project.id === id) ?? null;
  }

  async listResearchProjects(workspaceId?: string): Promise<ResearchProjectRecord[]> {
    return read<ResearchProjectRecord[]>(RESEARCH_PROJECTS_KEY, []).filter((project) => !workspaceId || project.workspaceId === workspaceId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async setResearchProjectState(id: string, state: ResearchState): Promise<void> {
    const timestamp = nowIso();
    write(RESEARCH_PROJECTS_KEY, read<ResearchProjectRecord[]>(RESEARCH_PROJECTS_KEY, []).map((project) => project.id === id ? {
      ...project, state, updatedAt: timestamp,
      ...(state === "ScoresFrozen" && !project.scoresFrozenAt ? { scoresFrozenAt: timestamp } : {}),
      ...(state === "Unblinded" && !project.unblindedAt ? { unblindedAt: timestamp } : {}),
    } : project));
  }

  async lockResearchProject(id: string, plan: ResearchLockPlan): Promise<void> {
    const projects = read<ResearchProjectRecord[]>(RESEARCH_PROJECTS_KEY, []);
    const project = projects.find((item) => item.id === id);
    if (!project || !["Draft", "Preflight"].includes(project.state)) throw new Error("Research project cannot be locked from its current state.");
    const timestamp = nowIso();
    write(RESEARCH_CONDITIONS_KEY, [...read<ResearchConditionRecord[]>(RESEARCH_CONDITIONS_KEY, []), ...structuredClone(plan.conditions)]);
    write(RESEARCH_ASSIGNMENTS_KEY, [...read<ResearchAssignmentRecord[]>(RESEARCH_ASSIGNMENTS_KEY, []), ...structuredClone(plan.assignments)]);
    write(BLINDING_MAPPINGS_KEY, [...read<BlindingMappingRecord[]>(BLINDING_MAPPINGS_KEY, []), ...structuredClone(plan.mappings)]);
    write(RESEARCH_PROJECTS_KEY, projects.map((item) => item.id === id ? { ...item, state: "Locked", configHash: plan.configHash, lockedAt: timestamp, updatedAt: timestamp } : item));
  }

  async listResearchConditions(projectId: string): Promise<ResearchConditionRecord[]> {
    return read<ResearchConditionRecord[]>(RESEARCH_CONDITIONS_KEY, []).filter((item) => item.researchProjectId === projectId);
  }

  async listResearchAssignments(projectId: string): Promise<ResearchAssignmentRecord[]> {
    return read<ResearchAssignmentRecord[]>(RESEARCH_ASSIGNMENTS_KEY, []).filter((item) => item.researchProjectId === projectId).sort((a, b) => a.executionOrder - b.executionOrder);
  }

  async listBlindingMappings(projectId: string): Promise<BlindingMappingRecord[]> {
    return read<BlindingMappingRecord[]>(BLINDING_MAPPINGS_KEY, []).filter((item) => item.researchProjectId === projectId);
  }

  async updateResearchAssignment(id: string, sessionId: string | undefined, status: string): Promise<void> {
    write(RESEARCH_ASSIGNMENTS_KEY, read<ResearchAssignmentRecord[]>(RESEARCH_ASSIGNMENTS_KEY, []).map((item) => item.id === id ? { ...item, sessionId, status } : item));
  }

  async saveResearchResults(projectId: string, results: ResearchResults, hash: string): Promise<void> {
    const all = read<Array<{ id: string; projectId: string; results: ResearchResults; hash: string; createdAt: string }>>(RESEARCH_RESULTS_KEY, []);
    if (all.some((item) => item.projectId === projectId)) throw new Error("Research results are immutable once written.");
    write(RESEARCH_RESULTS_KEY, [...all, { id: createId("research_results"), projectId, results: structuredClone(results), hash, createdAt: nowIso() }]);
  }

  async getResearchResults(projectId: string): Promise<ResearchResults | null> {
    return read<Array<{ projectId: string; results: ResearchResults }>>(RESEARCH_RESULTS_KEY, []).find((item) => item.projectId === projectId)?.results ?? null;
  }

  async recordExport(workspaceId: string, researchProjectId: string | undefined, exportType: string, artifactPath: string, manifestHash: string): Promise<void> {
    const key = "rvh.dev.exports";
    const all = read<Array<{ id: string; workspaceId: string; researchProjectId?: string; exportType: string; artifactPath: string; manifestHash: string; createdAt: string }>>(key, []);
    write(key, [...all, { id: createId("export"), workspaceId, researchProjectId, exportType, artifactPath, manifestHash, createdAt: nowIso() }]);
  }
}
