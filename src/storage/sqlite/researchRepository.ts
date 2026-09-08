import type {
  BlindingMappingRecord,
  ResearchAssignmentRecord,
  ResearchConditionRecord,
  ResearchConfig,
  ResearchLockPlan,
  ResearchProjectRecord,
  ResearchResults,
  ResearchState,
  ResearchTemplateType,
} from "../../research/types";
import type { DatabaseTransactionStatement } from "../databaseNative";
import type { ResearchRepository } from "../contracts/researchRepository";
import { createId, nowIso } from "../repository";

type WriteResult = { rowsAffected: number };
type ResearchProjectRow = {
  id: string;
  workspace_id: string;
  name: string;
  template_type: ResearchTemplateType;
  state: ResearchState;
  config_json: string;
  config_hash: string | null;
  locked_at: string | null;
  scores_frozen_at: string | null;
  unblinded_at: string | null;
  created_at: string;
  updated_at: string;
};

export interface SqliteResearchRepositoryDependencies {
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
  executeWrite(query: string, bindValues?: unknown[]): Promise<WriteResult>;
  executeTransaction(statements: DatabaseTransactionStatement[]): Promise<unknown>;
  now?: typeof nowIso;
  createId?: typeof createId;
}

function mapResearchProject(row: ResearchProjectRow): ResearchProjectRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    templateType: row.template_type,
    state: row.state,
    config: JSON.parse(row.config_json) as ResearchConfig,
    configHash: row.config_hash ?? undefined,
    lockedAt: row.locked_at ?? undefined,
    scoresFrozenAt: row.scores_frozen_at ?? undefined,
    unblindedAt: row.unblinded_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteResearchRepository implements ResearchRepository {
  constructor(private readonly dependencies: SqliteResearchRepositoryDependencies) {}

  private now(): string {
    return (this.dependencies.now ?? nowIso)();
  }

  private nextId(prefix: string): string {
    return (this.dependencies.createId ?? createId)(prefix);
  }

  async isScoresFrozen(projectId: string): Promise<boolean> {
    return Boolean((await this.dependencies.select<Array<{ scores_frozen_at: string | null }>>(
      "SELECT scores_frozen_at FROM research_projects WHERE id = $1",
      [projectId],
    ))[0]?.scores_frozen_at);
  }

  async createResearchProject(config: ResearchConfig): Promise<ResearchProjectRecord> {
    const timestamp = this.now();
    const project: ResearchProjectRecord = {
      id: this.nextId("research"), workspaceId: config.workspaceId, name: config.name.trim(), templateType: config.templateType,
      state: "Draft", config: structuredClone(config), createdAt: timestamp, updatedAt: timestamp,
    };
    await this.dependencies.executeWrite(
      `INSERT INTO research_projects (id, workspace_id, name, template_type, state, config_json, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Draft', $5, $6, $6)`,
      [project.id, project.workspaceId, project.name, project.templateType, JSON.stringify(project.config), timestamp],
    );
    return project;
  }

  async getResearchProject(id: string): Promise<ResearchProjectRecord | null> {
    const rows = await this.dependencies.select<ResearchProjectRow[]>(
      `SELECT id, workspace_id, name, template_type, state, config_json, config_hash, locked_at,
              scores_frozen_at, unblinded_at, created_at, updated_at FROM research_projects WHERE id = $1 LIMIT 1`, [id],
    );
    return rows[0] ? mapResearchProject(rows[0]) : null;
  }

  async listResearchProjects(workspaceId?: string): Promise<ResearchProjectRecord[]> {
    const rows = workspaceId
      ? await this.dependencies.select<ResearchProjectRow[]>(`SELECT id, workspace_id, name, template_type, state, config_json, config_hash, locked_at, scores_frozen_at, unblinded_at, created_at, updated_at FROM research_projects WHERE workspace_id = $1 ORDER BY created_at DESC`, [workspaceId])
      : await this.dependencies.select<ResearchProjectRow[]>(`SELECT id, workspace_id, name, template_type, state, config_json, config_hash, locked_at, scores_frozen_at, unblinded_at, created_at, updated_at FROM research_projects ORDER BY created_at DESC`);
    return rows.map(mapResearchProject);
  }

  async setResearchProjectState(id: string, state: ResearchState): Promise<void> {
    const timestamp = this.now();
    await this.dependencies.executeWrite(
      `UPDATE research_projects SET state = $1, updated_at = $2,
         scores_frozen_at = CASE WHEN $1 = 'ScoresFrozen' THEN COALESCE(scores_frozen_at, $2) ELSE scores_frozen_at END,
         unblinded_at = CASE WHEN $1 = 'Unblinded' THEN COALESCE(unblinded_at, $2) ELSE unblinded_at END
       WHERE id = $3`,
      [state, timestamp, id],
    );
  }

  async lockResearchProject(id: string, plan: ResearchLockPlan): Promise<void> {
    const timestamp = this.now();
    const projectState = await this.dependencies.select<{ state: ResearchState }[]>("SELECT state FROM research_projects WHERE id = $1", [id]);
    if (!projectState[0] || !["Draft", "Preflight"].includes(projectState[0].state)) throw new Error("Research project cannot be locked from its current state.");
    const statements: DatabaseTransactionStatement[] = plan.conditions.map((condition) => ({
      query: "INSERT INTO research_conditions (id, research_project_id, condition_key, condition_config_json) VALUES ($1, $2, $3, $4)",
      values: [condition.id, id, condition.conditionKey, JSON.stringify(condition.config)],
    }));
    statements.push(...plan.assignments.map((assignment) => ({
      query: `INSERT INTO research_assignments (id, research_project_id, anonymous_session_id, session_id, target_id, execution_order, judge_order, status)
           VALUES ($1, $2, $3, NULL, $4, $5, $6, $7)`,
      values: [assignment.id, id, assignment.anonymousSessionId, assignment.targetId, assignment.executionOrder, assignment.judgeOrder, assignment.status],
    })));
    statements.push(...plan.mappings.map((mapping) => ({
      query: `INSERT INTO blinding_mappings (id, research_project_id, anonymous_session_id, condition_id, pair_key, pair_order, mapping_hash, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      values: [mapping.id, id, mapping.anonymousSessionId, mapping.conditionId, mapping.pairKey, mapping.pairOrder ?? null, mapping.mappingHash, mapping.createdAt],
    })));
    statements.push({
      query: "UPDATE research_projects SET state = 'Locked', config_hash = $1, locked_at = $2, updated_at = $2 WHERE id = $3 AND state IN ('Draft','Preflight')",
      values: [plan.configHash, timestamp, id],
    });
    await this.dependencies.executeTransaction(statements);
  }

  async listResearchConditions(projectId: string): Promise<ResearchConditionRecord[]> {
    const rows = await this.dependencies.select<Array<{ id: string; research_project_id: string; condition_key: string; condition_config_json: string }>>(
      `SELECT id, research_project_id, condition_key, condition_config_json FROM research_conditions WHERE research_project_id = $1 ORDER BY condition_key`, [projectId],
    );
    return rows.map((row) => ({ id: row.id, researchProjectId: row.research_project_id, conditionKey: row.condition_key, config: JSON.parse(row.condition_config_json) as ResearchConditionRecord["config"] }));
  }

  async listResearchAssignments(projectId: string): Promise<ResearchAssignmentRecord[]> {
    const rows = await this.dependencies.select<Array<{ id: string; research_project_id: string; anonymous_session_id: string; session_id: string | null; target_id: string | null; execution_order: number; judge_order: number | null; status: string }>>(
      `SELECT id, research_project_id, anonymous_session_id, session_id, target_id, execution_order, judge_order, status FROM research_assignments WHERE research_project_id = $1 ORDER BY execution_order`, [projectId],
    );
    return rows.map((row) => {
      if (!row.target_id || row.judge_order === null) throw new Error("Locked Research assignment is incomplete.");
      return { id: row.id, researchProjectId: row.research_project_id, anonymousSessionId: row.anonymous_session_id, sessionId: row.session_id ?? undefined, targetId: row.target_id, executionOrder: row.execution_order, judgeOrder: row.judge_order, status: row.status };
    });
  }

  async listBlindingMappings(projectId: string): Promise<BlindingMappingRecord[]> {
    const rows = await this.dependencies.select<Array<{ id: string; research_project_id: string; anonymous_session_id: string; condition_id: string; pair_key: string | null; pair_order: string | null; mapping_hash: string; created_at: string }>>(
      `SELECT id, research_project_id, anonymous_session_id, condition_id, pair_key, pair_order, mapping_hash, created_at FROM blinding_mappings WHERE research_project_id = $1`, [projectId],
    );
    return rows.map((row) => ({ id: row.id, researchProjectId: row.research_project_id, anonymousSessionId: row.anonymous_session_id, conditionId: row.condition_id, pairKey: row.pair_key ?? "", pairOrder: row.pair_order ?? undefined, mappingHash: row.mapping_hash, createdAt: row.created_at }));
  }

  async updateResearchAssignment(id: string, sessionId: string | undefined, status: string): Promise<void> {
    await this.dependencies.executeWrite("UPDATE research_assignments SET session_id = $1, status = $2 WHERE id = $3", [sessionId ?? null, status, id]);
  }

  async saveResearchResults(projectId: string, results: ResearchResults, hash: string): Promise<void> {
    const existing = await this.dependencies.select<{ id: string }[]>("SELECT id FROM research_results WHERE research_project_id = $1 LIMIT 1", [projectId]);
    if (existing.length) throw new Error("Research results are immutable once written.");
    await this.dependencies.executeWrite(
      `INSERT INTO research_results (id, research_project_id, results_json, results_hash, created_at) VALUES ($1, $2, $3, $4, $5)`,
      [this.nextId("research_results"), projectId, JSON.stringify(results), hash, this.now()],
    );
  }

  async getResearchResults(projectId: string): Promise<ResearchResults | null> {
    const rows = await this.dependencies.select<{ results_json: string }[]>("SELECT results_json FROM research_results WHERE research_project_id = $1 ORDER BY created_at DESC LIMIT 1", [projectId]);
    return rows[0] ? JSON.parse(rows[0].results_json) as ResearchResults : null;
  }
}
