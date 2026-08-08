import type { AppRepository } from "../storage/repository";
import { createId } from "../storage/repository";
import type { WorkspaceSource } from "./types";

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

export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
