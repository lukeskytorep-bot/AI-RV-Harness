import type { AppRepository } from "../storage/repository";
import { createId } from "../storage/repository";
import type { WorkspaceSource } from "./types";

export interface ImportedDocumentSource {
  displayName: string;
  sourceType: WorkspaceSource["sourceType"];
  content: string;
  contentHash: string;
  mimeType: string;
  importMethod: string;
  sizeBytes: number;
}

type SourceRepository = Pick<AppRepository, "createWorkspaceSource">;

export async function createTextWorkspaceSource(repository: SourceRepository, workspaceId: string, fileName: string, content: string): Promise<WorkspaceSource> {
  const clean = content.replace(/^\uFEFF/, "");
  if (!clean.trim()) throw new Error("Source file is empty.");
  if (new TextEncoder().encode(clean).byteLength > 10 * 1024 * 1024) throw new Error("Source file exceeds the 10 MB text-source limit.");
  const sourceType = fileName.toLowerCase().endsWith(".md") ? "markdown" : "text";
  return repository.createWorkspaceSource({
    id: createId("source"), workspaceId, sourceType, displayName: fileName.trim() || "Source", content: clean,
    contentHash: await sha256Text(clean), metadata: { importedAs: sourceType },
  });
}

export async function createImportedWorkspaceSource(
  repository: SourceRepository,
  workspaceId: string,
  imported: ImportedDocumentSource,
): Promise<WorkspaceSource> {
  if (!imported.content.trim()) throw new Error("Imported document contains no readable text.");
  if (new TextEncoder().encode(imported.content).byteLength > 2 * 1024 * 1024) throw new Error("Imported document text exceeds the 2 MB limit.");
  return repository.createWorkspaceSource({
    id: createId("source"),
    workspaceId,
    sourceType: imported.sourceType,
    displayName: imported.displayName.trim() || "Document",
    content: imported.content,
    contentHash: imported.contentHash,
    metadata: {
      importedAs: imported.sourceType,
      mimeType: imported.mimeType,
      importMethod: imported.importMethod,
      originalSizeBytes: imported.sizeBytes,
      trust: "untrusted_user_source",
    },
  });
}

export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
