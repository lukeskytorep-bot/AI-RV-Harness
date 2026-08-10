import type { AppSettings, ChatMessage, ChatMode, ChatThread, CreateProfileInput, CreateWorkspaceInput, Profile, ProfileAiConfigurationInput, UpdateProfileInput, Workspace } from "../types";
import type { CreateProviderConfigInput, ProviderConfig, ProviderModel } from "../providers/types";
import type { CreateRvSessionInput, RevealInput, RvSession, RvSessionState, SessionEventInput, SessionSnapshot, TargetClarificationRecord } from "../sessions/types";
import type { CreateMonitorRunInput, MonitorInterventionInput, MonitorInterventionRecord, MonitorRunRecord } from "../monitor/types";
import type { CreateJudgeRunInput, FrozenJudgeScoreInput, JudgeScoreRecord } from "../judge/types";
import type { CreateTargetInput, TargetRecord, TargetUsageInput, TargetUsageRecord, UpdateTargetInput } from "../targets/types";
import type { CustomProtocolVersion, SaveCustomProtocolVersionInput } from "../protocols/types";
import type { BlindingMappingRecord, ResearchAssignmentRecord, ResearchConditionRecord, ResearchConfig, ResearchLockPlan, ResearchProjectRecord, ResearchResults, ResearchState } from "../research/types";
import type { CreateWorkspaceSourceInput, WorkspaceSource } from "../sources/types";

export interface AppRepository {
  listProfiles(): Promise<Profile[]>;
  createProfile(input: CreateProfileInput): Promise<Profile>;
  updateProfile(id: string, input: UpdateProfileInput): Promise<void>;
  archiveProfile(id: string): Promise<void>;
  setProfileAiConfiguration(profileId: string, input: ProfileAiConfigurationInput): Promise<void>;
  listWorkspaces(profileId?: string): Promise<Workspace[]>;
  createWorkspace(input: CreateWorkspaceInput): Promise<Workspace>;
  touchWorkspace(id: string): Promise<void>;
  setProfileCredential(profileId: string, credentialId?: string, provider?: string): Promise<void>;
  listChatThreads(workspaceId: string, mode: ChatMode): Promise<ChatThread[]>;
  createChatThread(workspaceId: string, mode: ChatMode, title?: string): Promise<ChatThread>;
  getOrCreateChatThread(workspaceId: string, mode: ChatMode): Promise<ChatThread>;
  touchChatThread(threadId: string): Promise<void>;
  renameChatThread(threadId: string, title: string): Promise<void>;
  archiveChatThread(threadId: string): Promise<void>;
  setChatThreadFormalRvState(threadId: string, state?: ChatThread["formalRvState"]): Promise<void>;
  listChatMessages(threadId: string): Promise<ChatMessage[]>;
  appendChatMessage(threadId: string, role: ChatMessage["role"], content: string): Promise<ChatMessage>;
  listWorkspaceSources(workspaceId: string): Promise<WorkspaceSource[]>;
  createWorkspaceSource(input: CreateWorkspaceSourceInput): Promise<WorkspaceSource>;
  deleteWorkspaceSource(id: string): Promise<void>;
  listActiveChatSourceIds(threadId: string): Promise<string[]>;
  setChatSourceActive(threadId: string, sourceId: string, active: boolean): Promise<void>;
  loadSettings(): Promise<Partial<AppSettings>>;
  saveSettings(settings: AppSettings): Promise<void>;
  listProviderConfigs(): Promise<ProviderConfig[]>;
  createProviderConfig(input: CreateProviderConfigInput): Promise<ProviderConfig>;
  updateProviderCredentialMetadata(id: string, credentialHint: string, fingerprint: string): Promise<void>;
  deleteProviderConfig(id: string): Promise<void>;
  updateProviderConnectionStatus(id: string, status: "ok" | "error", error?: string): Promise<void>;
  listProviderModels(providerConfigId?: string): Promise<ProviderModel[]>;
  replaceProviderModels(providerConfigId: string, models: ProviderModel[]): Promise<void>;
  setProviderModelFavorite(providerConfigId: string, modelId: string, favorite: boolean): Promise<void>;
  clearProviderModelCache(): Promise<void>;
  listTargets(collection?: TargetRecord["collection"]): Promise<TargetRecord[]>;
  createTarget(input: CreateTargetInput): Promise<TargetRecord>;
  updateTarget(id: string, input: UpdateTargetInput): Promise<TargetRecord>;
  deleteTarget(id: string): Promise<void>;
  recordTargetUsage(input: TargetUsageInput): Promise<void>;
  listTargetUsage(): Promise<TargetUsageRecord[]>;
  listCustomProtocols(language?: "pl" | "en"): Promise<CustomProtocolVersion[]>;
  saveCustomProtocolVersion(input: SaveCustomProtocolVersionInput): Promise<CustomProtocolVersion>;
  createRvSession(input: CreateRvSessionInput): Promise<RvSession>;
  updateRvSessionState(id: string, state: RvSessionState, stopReason?: string): Promise<void>;
  appendSessionEvent(sessionId: string, event: SessionEventInput): Promise<void>;
  updatePreRevealTranscript(sessionId: string, transcript: string): Promise<void>;
  appendPostRevealTurn(sessionId: string, role: "user" | "assistant", content: string): Promise<string>;
  saveSessionSnapshot(sessionId: string, snapshot: SessionSnapshot, hash: string): Promise<void>;
  getSessionSnapshot(sessionId: string): Promise<SessionSnapshot | null>;
  sealPreReveal(sessionId: string, transcript: string, hash: string): Promise<void>;
  acceptReveal(sessionId: string, reveal: RevealInput): Promise<void>;
  getReveal(sessionId: string): Promise<RevealInput | null>;
  getViewerEvidence(sessionId: string): Promise<string>;
  listRvSessions(workspaceId: string): Promise<RvSession[]>;
  addTargetClarification(sessionId: string, content: string): Promise<TargetClarificationRecord>;
  listTargetClarifications(sessionId: string): Promise<TargetClarificationRecord[]>;
  createMonitorRun(input: CreateMonitorRunInput): Promise<string>;
  appendMonitorIntervention(monitorRunId: string, intervention: MonitorInterventionInput): Promise<void>;
  listMonitorRuns(workspaceId: string): Promise<MonitorRunRecord[]>;
  listMonitorInterventions(monitorRunId: string): Promise<MonitorInterventionRecord[]>;
  recordFrozenJudgeResult(run: CreateJudgeRunInput, score: FrozenJudgeScoreInput): Promise<JudgeScoreRecord>;
  listJudgeScores(sessionId: string): Promise<JudgeScoreRecord[]>;
  createResearchProject(config: ResearchConfig): Promise<ResearchProjectRecord>;
  getResearchProject(id: string): Promise<ResearchProjectRecord | null>;
  listResearchProjects(workspaceId?: string): Promise<ResearchProjectRecord[]>;
  setResearchProjectState(id: string, state: ResearchState): Promise<void>;
  lockResearchProject(id: string, plan: ResearchLockPlan): Promise<void>;
  listResearchConditions(projectId: string): Promise<ResearchConditionRecord[]>;
  listResearchAssignments(projectId: string): Promise<ResearchAssignmentRecord[]>;
  listBlindingMappings(projectId: string): Promise<BlindingMappingRecord[]>;
  updateResearchAssignment(id: string, sessionId: string | undefined, status: string): Promise<void>;
  saveResearchResults(projectId: string, results: ResearchResults, hash: string): Promise<void>;
  getResearchResults(projectId: string): Promise<ResearchResults | null>;
  recordExport(workspaceId: string, researchProjectId: string | undefined, exportType: string, artifactPath: string, manifestHash: string): Promise<void>;
  createDatabaseSnapshot(destinationPath: string): Promise<void>;
  closeForRestore(): Promise<void>;
}

export function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
