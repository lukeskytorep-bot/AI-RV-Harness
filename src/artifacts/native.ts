import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../storage";
import type { ProviderImageInput } from "../providers/types";
import type { RevealArtifactRecord } from "../sessions/types";

function requireDesktop(): void {
  if (!isTauriRuntime()) throw new Error("Artifact storage requires the desktop runtime.");
}

export async function storeRevealArtifact(sessionId: string, file: File): Promise<RevealArtifactRecord> {
  requireDesktop();
  if (file.size > 25 * 1024 * 1024) throw new Error("Reveal artifact exceeds the 25 MB per-file limit.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  return invoke<RevealArtifactRecord>("store_reveal_artifact", {
    request: {
      sessionId,
      originalFileName: file.name,
      mimeType: normalizedMime(file),
      dataBase64: bytesToBase64(bytes),
    },
  });
}

export async function storeTargetArtifact(targetId: string, file: File): Promise<RevealArtifactRecord> {
  requireDesktop();
  if (file.size > 25 * 1024 * 1024) throw new Error("Target image exceeds the 25 MB per-file limit.");
  const mimeType = normalizedMime(file);
  if (!mimeType.startsWith("image/")) throw new Error("Target artifacts must be supported images.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  return invoke<RevealArtifactRecord>("store_target_artifact", {
    request: {
      targetId,
      originalFileName: file.name,
      mimeType,
      dataBase64: bytesToBase64(bytes),
    },
  });
}

export async function loadRevealImageForJudge(artifact: RevealArtifactRecord): Promise<ProviderImageInput> {
  requireDesktop();
  return invoke<ProviderImageInput>("read_reveal_image_for_judge", { path: artifact.path });
}

export async function imageFileToProviderInput(file: File): Promise<ProviderImageInput> {
  const mimeType = normalizedMime(file);
  if (!new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]).has(mimeType)) throw new Error("Unsupported chat image type.");
  if (file.size < 1 || file.size > 10 * 1024 * 1024) throw new Error("Chat image must be between 1 byte and 10 MB.");
  return { mimeType, dataBase64: bytesToBase64(new Uint8Array(await file.arrayBuffer())) };
}

function normalizedMime(file: File): string {
  if (file.type) return file.type.toLowerCase();
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".md")) return "text/markdown";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "application/octet-stream";
}

function bytesToBase64(bytes: Uint8Array): string {
  let result = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    result += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunk, bytes.length)));
  }
  return btoa(result);
}
