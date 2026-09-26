import type {
  CreateTargetInput,
  TargetRecord,
  TargetUsageInput,
  TargetUsageRecord,
  UpdateTargetInput,
} from "../../targets/types";

/** Internal persistence contract for the Targets aggregate. */
export interface TargetsRepository {
  listTargets(collection?: TargetRecord["collection"]): Promise<TargetRecord[]>;
  listArchivedTargets(): Promise<TargetRecord[]>;
  createTarget(input: CreateTargetInput): Promise<TargetRecord>;
  syncFactoryTrainingTargetClassification(id: string, sourceMetadata: Record<string, unknown>): Promise<void>;
  updateTarget(id: string, input: UpdateTargetInput): Promise<TargetRecord>;
  archiveTarget(id: string): Promise<void>;
  restoreTarget(id: string): Promise<void>;
  recordTargetUsage(input: TargetUsageInput): Promise<void>;
  listTargetUsage(): Promise<TargetUsageRecord[]>;
}
