import type { ExportRepository } from "../contracts/exportRepository";
import { createId, nowIso } from "../repository";

const EXPORTS_KEY = "rvh.dev.exports";
type ExportStorage = Pick<Storage, "getItem" | "setItem">;
type ExportRecord = { id: string; workspaceId: string; researchProjectId?: string; exportType: string; artifactPath: string; manifestHash: string; createdAt: string };

export interface BrowserExportRepositoryDependencies {
  storage?: ExportStorage;
  now?: typeof nowIso;
  createId?: typeof createId;
}

export class BrowserExportRepository implements ExportRepository {
  constructor(private readonly dependencies: BrowserExportRepositoryDependencies = {}) {}

  private get storage(): ExportStorage {
    return this.dependencies.storage ?? localStorage;
  }

  async recordExport(workspaceId: string, researchProjectId: string | undefined, exportType: string, artifactPath: string, manifestHash: string): Promise<void> {
    let all: ExportRecord[] = [];
    try {
      const raw = this.storage.getItem(EXPORTS_KEY);
      if (raw) all = JSON.parse(raw) as ExportRecord[];
    } catch {
      all = [];
    }
    const record: ExportRecord = {
      id: (this.dependencies.createId ?? createId)("export"), workspaceId, researchProjectId, exportType, artifactPath, manifestHash,
      createdAt: (this.dependencies.now ?? nowIso)(),
    };
    this.storage.setItem(EXPORTS_KEY, JSON.stringify([...all, record]));
  }
}
