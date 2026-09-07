import type {
  CreateTargetInput,
  TargetRecord,
  TargetUsageInput,
  TargetUsageRecord,
  UpdateTargetInput,
} from "../../targets/types";
import type { TargetsRepository } from "../contracts/targetsRepository";
import { createId, nowIso } from "../repository";

const TARGETS_KEY = "rvh.dev.targets";
const TARGET_USAGE_KEY = "rvh.dev.target_usage";

type TargetStorage = Pick<Storage, "getItem" | "setItem">;

export interface BrowserTargetsRepositoryDependencies {
  storage?: TargetStorage;
  createId?: typeof createId;
  now?: typeof nowIso;
  hasRecordedUse?: (targetId: string) => boolean;
}

function isLegacyStarterTrainingTarget(target: TargetRecord): boolean {
  return target.collection === "training" && /^training_(?:[1-9]|10)$/.test(target.id);
}

export class BrowserTargetsRepository implements TargetsRepository {
  constructor(private readonly dependencies: BrowserTargetsRepositoryDependencies = {}) {}

  private get storage(): TargetStorage {
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

  async listTargets(collection?: TargetRecord["collection"]): Promise<TargetRecord[]> {
    return this.read<TargetRecord[]>(TARGETS_KEY, [])
      .filter((target) => !isLegacyStarterTrainingTarget(target))
      .filter((target) => !collection || target.collection === collection)
      .sort((a, b) => collection
        ? b.updatedAt.localeCompare(a.updatedAt)
        : a.collection.localeCompare(b.collection) || b.updatedAt.localeCompare(a.updatedAt));
  }

  async createTarget(input: CreateTargetInput): Promise<TargetRecord> {
    const timestamp = (this.dependencies.now ?? nowIso)();
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
    this.write(TARGETS_KEY, [target, ...this.read<TargetRecord[]>(TARGETS_KEY, [])]);
    return target;
  }

  async updateTarget(id: string, input: UpdateTargetInput): Promise<TargetRecord> {
    const all = this.read<TargetRecord[]>(TARGETS_KEY, []);
    const target = all.find((item) => item.id === id);
    if (!target || target.collection !== "user") throw new Error("User target not found.");
    if (this.dependencies.hasRecordedUse?.(id)) throw new Error("Used targets are locked to preserve session and Research integrity.");
    const updated: TargetRecord = {
      ...target,
      title: input.title.trim(),
      revealText: input.revealText?.trim() || undefined,
      tags: [...input.tags],
      contentHash: input.contentHash,
      updatedAt: (this.dependencies.now ?? nowIso)(),
    };
    this.write(TARGETS_KEY, all.map((item) => item.id === id ? updated : item));
    return updated;
  }

  async deleteTarget(id: string): Promise<void> {
    const all = this.read<TargetRecord[]>(TARGETS_KEY, []);
    const target = all.find((item) => item.id === id);
    if (!target || target.collection !== "user") throw new Error("User target not found.");
    if (this.dependencies.hasRecordedUse?.(id)) throw new Error("Used targets are locked to preserve session and Research integrity.");
    this.write(TARGETS_KEY, all.filter((item) => item.id !== id));
  }

  async recordTargetUsage(input: TargetUsageInput): Promise<void> {
    const record: TargetUsageRecord = {
      ...input,
      id: (this.dependencies.createId ?? createId)("target_usage"),
      usedAt: (this.dependencies.now ?? nowIso)(),
    };
    this.write(TARGET_USAGE_KEY, [...this.read<TargetUsageRecord[]>(TARGET_USAGE_KEY, []), record]);
  }

  async listTargetUsage(): Promise<TargetUsageRecord[]> {
    return this.read<TargetUsageRecord[]>(TARGET_USAGE_KEY, []).sort((a, b) => b.usedAt.localeCompare(a.usedAt));
  }
}
