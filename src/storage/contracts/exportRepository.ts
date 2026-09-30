/** Internal persistence contract for the cross-domain export audit ledger. */
export interface ExportRepository {
  recordExport(workspaceId: string, researchProjectId: string | undefined, exportType: string, artifactPath: string, manifestHash: string): Promise<void>;
}
