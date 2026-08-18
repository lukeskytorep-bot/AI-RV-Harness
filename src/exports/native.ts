import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../storage";

export interface ExportTextFile { relativePath: string; content: string }
export interface ExportArtifactCopy { sourcePath: string; relativePath: string }

export async function writeExportPackage(input: {
  exportId: string;
  files: ExportTextFile[];
  artifactCopies?: ExportArtifactCopy[];
  destination?: "managed" | "training";
  baseDirectory?: string;
  overwriteExisting?: boolean;
}): Promise<string> {
  if (!isTauriRuntime()) throw new Error("Export package writing requires the desktop runtime.");
  const result = await invoke<{ directory: string }>("write_export_package", { request: input });
  return result.directory;
}
