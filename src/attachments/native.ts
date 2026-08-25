import { invoke } from "@tauri-apps/api/core";
import type { ProviderImageInput } from "../providers/types";
import type { ImportedDocumentSource } from "../sources/service";
import { isTauriRuntime } from "../storage";

export interface ImportedImageAttachment extends ProviderImageInput {
  displayName: string;
  sha256: string;
  sizeBytes: number;
  width: number;
  height: number;
}

export type ImportedAttachment =
  | ({ kind: "document" } & ImportedDocumentSource)
  | ({ kind: "image" } & ImportedImageAttachment);

export interface BuiltinDocumentManifest {
  id: string;
  fileName: string;
  language: "pl" | "en";
  title: string;
  description: string;
  sha256: string;
  sizeBytes: number;
}

function requireDesktop(): void {
  if (!isTauriRuntime()) throw new Error("Attachment import requires the desktop runtime.");
}

export async function chooseAndImportAttachments(title: string): Promise<ImportedAttachment[]> {
  requireDesktop();
  const paths = await invoke<string[]>("choose_attachments", { title });
  const attachments: ImportedAttachment[] = [];
  for (const path of paths.slice(0, 12)) {
    attachments.push(await invoke<ImportedAttachment>("import_attachment", { path }));
  }
  return attachments;
}

export async function listBuiltinDocuments(): Promise<BuiltinDocumentManifest[]> {
  requireDesktop();
  return invoke<BuiltinDocumentManifest[]>("list_builtin_documents");
}

export async function readBuiltinDocument(id: string): Promise<ImportedDocumentSource> {
  requireDesktop();
  return invoke<ImportedDocumentSource>("read_builtin_document", { id });
}

export async function saveBuiltinDocument(id: string, title: string): Promise<string | null> {
  requireDesktop();
  return invoke<string | null>("save_builtin_document", { id, title });
}
