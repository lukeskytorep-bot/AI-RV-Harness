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

/** Internal persistence contract for Research methodology, lock/blinding state and frozen results. */
export interface ResearchRepository {
  createResearchProject(config: ResearchConfig): Promise<ResearchProjectRecord>;
  getResearchProject(id: string): Promise<ResearchProjectRecord | null>;
  listResearchProjects(workspaceId?: string): Promise<ResearchProjectRecord[]>;
  listArchivedResearchProjects(): Promise<ResearchProjectRecord[]>;
  archiveResearchProject(id: string): Promise<void>;
  restoreResearchProject(id: string): Promise<void>;
  setResearchProjectState(id: string, state: ResearchState): Promise<void>;
  lockResearchProject(id: string, plan: ResearchLockPlan): Promise<void>;
  listResearchConditions(projectId: string): Promise<ResearchConditionRecord[]>;
  listResearchAssignments(projectId: string): Promise<ResearchAssignmentRecord[]>;
  listBlindingMappings(projectId: string): Promise<BlindingMappingRecord[]>;
  updateResearchAssignment(id: string, sessionId: string | undefined, status: string): Promise<void>;
  saveResearchResults(projectId: string, results: ResearchResults, hash: string): Promise<void>;
  getResearchResults(projectId: string): Promise<ResearchResults | null>;
}
