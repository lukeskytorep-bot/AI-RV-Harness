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
  createTarget(input: CreateTargetInput): Promise<TargetRecord>;
  updateTarget(id: string, input: UpdateTargetInput): Promise<TargetRecord>;
  deleteTarget(id: string): Promise<void>;
  recordTargetUsage(input: TargetUsageInput): Promise<void>;
  listTargetUsage(): Promise<TargetUsageRecord[]>;
}
