import type {
  BlindingMappingRecord,
  ResearchAssignmentRecord,
  ResearchConditionRecord,
  ResearchConfig,
  ResearchLockPlan,
  ResearchProjectRecord,
  ResearchResults,
  ResearchState,
} from "../../research/types";
import type { ResearchRepository } from "../contracts/researchRepository";
import { createId, nowIso } from "../repository";

const RESEARCH_PROJECTS_KEY = "rvh.dev.research_projects";
const RESEARCH_CONDITIONS_KEY = "rvh.dev.research_conditions";
const RESEARCH_ASSIGNMENTS_KEY = "rvh.dev.research_assignments";
const BLINDING_MAPPINGS_KEY = "rvh.dev.blinding_mappings";
const RESEARCH_RESULTS_KEY = "rvh.dev.research_results";

type ResearchStorage = Pick<Storage, "getItem" | "setItem">;

export interface BrowserResearchRepositoryDependencies {
  storage?: ResearchStorage;
  now?: typeof nowIso;
  createId?: typeof createId;
}

export class BrowserResearchRepository implements ResearchRepository {
  constructor(private readonly dependencies: BrowserResearchRepositoryDependencies = {}) {}

  private get storage(): ResearchStorage {
    return this.dependencies.storage ?? localStorage;
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

  isScoresFrozen(projectId: string): boolean {
    return Boolean(this.read<ResearchProjectRecord[]>(RESEARCH_PROJECTS_KEY, []).find((item) => item.id === projectId)?.scoresFrozenAt);
  }

  hasRecordedTargetUse(targetId: string): boolean {
    return this.read<ResearchAssignmentRecord[]>(RESEARCH_ASSIGNMENTS_KEY, []).some((item) => item.targetId === targetId);
  }

  async createResearchProject(config: ResearchConfig): Promise<ResearchProjectRecord> {
    const timestamp = this.now();
    const project: ResearchProjectRecord = { id: this.nextId("research"), workspaceId: config.workspaceId, name: config.name.trim(), templateType: config.templateType, state: "Draft", config: structuredClone(config), createdAt: timestamp, updatedAt: timestamp };
    this.write(RESEARCH_PROJECTS_KEY, [project, ...this.read<ResearchProjectRecord[]>(RESEARCH_PROJECTS_KEY, [])]);
    return project;
  }

  async getResearchProject(id: string): Promise<ResearchProjectRecord | null> {
    return this.read<ResearchProjectRecord[]>(RESEARCH_PROJECTS_KEY, []).find((project) => project.id === id) ?? null;
  }

  async listResearchProjects(workspaceId?: string): Promise<ResearchProjectRecord[]> {
    return this.read<ResearchProjectRecord[]>(RESEARCH_PROJECTS_KEY, []).filter((project) => !workspaceId || project.workspaceId === workspaceId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async setResearchProjectState(id: string, state: ResearchState): Promise<void> {
    const timestamp = this.now();
    this.write(RESEARCH_PROJECTS_KEY, this.read<ResearchProjectRecord[]>(RESEARCH_PROJECTS_KEY, []).map((project) => project.id === id ? {
      ...project, state, updatedAt: timestamp,
      ...(state === "ScoresFrozen" && !project.scoresFrozenAt ? { scoresFrozenAt: timestamp } : {}),
      ...(state === "Unblinded" && !project.unblindedAt ? { unblindedAt: timestamp } : {}),
    } : project));
  }

  async lockResearchProject(id: string, plan: ResearchLockPlan): Promise<void> {
    const projects = this.read<ResearchProjectRecord[]>(RESEARCH_PROJECTS_KEY, []);
    const project = projects.find((item) => item.id === id);
    if (!project || !["Draft", "Preflight"].includes(project.state)) throw new Error("Research project cannot be locked from its current state.");
    const timestamp = this.now();
    this.write(RESEARCH_CONDITIONS_KEY, [...this.read<ResearchConditionRecord[]>(RESEARCH_CONDITIONS_KEY, []), ...structuredClone(plan.conditions)]);
    this.write(RESEARCH_ASSIGNMENTS_KEY, [...this.read<ResearchAssignmentRecord[]>(RESEARCH_ASSIGNMENTS_KEY, []), ...structuredClone(plan.assignments)]);
    this.write(BLINDING_MAPPINGS_KEY, [...this.read<BlindingMappingRecord[]>(BLINDING_MAPPINGS_KEY, []), ...structuredClone(plan.mappings)]);
    this.write(RESEARCH_PROJECTS_KEY, projects.map((item) => item.id === id ? { ...item, state: "Locked", configHash: plan.configHash, lockedAt: timestamp, updatedAt: timestamp } : item));
  }

  async listResearchConditions(projectId: string): Promise<ResearchConditionRecord[]> {
    return this.read<ResearchConditionRecord[]>(RESEARCH_CONDITIONS_KEY, []).filter((item) => item.researchProjectId === projectId);
  }

  async listResearchAssignments(projectId: string): Promise<ResearchAssignmentRecord[]> {
    return this.read<ResearchAssignmentRecord[]>(RESEARCH_ASSIGNMENTS_KEY, []).filter((item) => item.researchProjectId === projectId).sort((a, b) => a.executionOrder - b.executionOrder);
  }

  async listBlindingMappings(projectId: string): Promise<BlindingMappingRecord[]> {
    return this.read<BlindingMappingRecord[]>(BLINDING_MAPPINGS_KEY, []).filter((item) => item.researchProjectId === projectId);
  }

  async updateResearchAssignment(id: string, sessionId: string | undefined, status: string): Promise<void> {
    this.write(RESEARCH_ASSIGNMENTS_KEY, this.read<ResearchAssignmentRecord[]>(RESEARCH_ASSIGNMENTS_KEY, []).map((item) => item.id === id ? { ...item, sessionId, status } : item));
  }

  async saveResearchResults(projectId: string, results: ResearchResults, hash: string): Promise<void> {
    const all = this.read<Array<{ id: string; projectId: string; results: ResearchResults; hash: string; createdAt: string }>>(RESEARCH_RESULTS_KEY, []);
    if (all.some((item) => item.projectId === projectId)) throw new Error("Research results are immutable once written.");
    this.write(RESEARCH_RESULTS_KEY, [...all, { id: this.nextId("research_results"), projectId, results: structuredClone(results), hash, createdAt: this.now() }]);
  }

  async getResearchResults(projectId: string): Promise<ResearchResults | null> {
    return this.read<Array<{ projectId: string; results: ResearchResults }>>(RESEARCH_RESULTS_KEY, []).find((item) => item.projectId === projectId)?.results ?? null;
  }
}
