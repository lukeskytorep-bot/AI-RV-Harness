import type { AppRepository } from "../storage/repository";
import { createId } from "../storage/repository";
import type { RevealArtifactRecord } from "../sessions/types";
import type { RevealInput } from "../sessions/types";
import type { TargetRecord } from "./types";

type TargetRepository = Pick<AppRepository, "createTarget">;
type TargetMutationRepository = Pick<AppRepository, "updateTarget">;

export async function createUserTarget(
  repository: TargetRepository,
  input: { id?: string; title: string; revealText?: string; revealArtifacts?: RevealArtifactRecord[]; tags?: string[]; source?: string },
): Promise<TargetRecord> {
  const title = input.title.trim();
  const revealText = input.revealText?.trim();
  if (!title) throw new Error("Target name is required.");
  const revealArtifacts = (input.revealArtifacts ?? []).filter((artifact) => artifact.mimeType.startsWith("image/"));
  if (!revealText && !revealArtifacts.length) throw new Error("A reveal description or image is required.");
  const tags = [...new Set((input.tags ?? []).map((tag) => tag.trim()).filter(Boolean))];
  const canonical = targetCanonical(title, revealText, revealArtifacts, tags);
  return repository.createTarget({
    id: input.id ?? createId("target"),
    collection: "user",
    title,
    ...(revealText ? { revealText } : {}),
    ...(revealArtifacts.length ? { revealArtifacts } : {}),
    tags,
    sourceMetadata: { origin: input.source ?? "user_created" },
    contentHash: await sha256Text(canonical),
  });
}

export async function updateUserTarget(
  repository: TargetMutationRepository,
  target: TargetRecord,
  input: { title: string; revealText?: string; tags?: string[] },
): Promise<TargetRecord> {
  if (target.collection !== "user") throw new Error("Training targets are read-only.");
  const title = input.title.trim();
  const revealText = input.revealText?.trim();
  const revealArtifacts = (target.revealArtifacts ?? []).filter((artifact) => artifact.mimeType.startsWith("image/"));
  if (!title) throw new Error("Target name is required.");
  if (!revealText && !revealArtifacts.length) throw new Error("A reveal description or existing image is required.");
  const tags = [...new Set((input.tags ?? []).map((tag) => tag.trim()).filter(Boolean))];
  return repository.updateTarget(target.id, {
    title,
    ...(revealText ? { revealText } : {}),
    tags,
    contentHash: await sha256Text(targetCanonical(title, revealText, revealArtifacts, tags)),
  });
}

export function chooseRandomTarget(targets: TargetRecord[]): TargetRecord | null {
  if (!targets.length) return null;
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return targets[buffer[0] % targets.length];
}

export function targetHasSupportedReveal(target: TargetRecord | undefined): boolean {
  return Boolean(target && (target.revealText?.trim() || target.revealArtifacts?.some((artifact) => artifact.mimeType.startsWith("image/"))));
}

export async function buildAutomaticTargetReveal(target: TargetRecord): Promise<RevealInput> {
  const text = target.revealText?.trim();
  const artifactManifest = (target.revealArtifacts ?? []).filter((artifact) => artifact.mimeType.startsWith("image/"));
  if (!text && !artifactManifest.length) throw new Error("Automatic target has no supported reveal evidence.");
  const hashMaterial = JSON.stringify({ text: text ?? null, artifacts: artifactManifest.map((artifact) => ({ sha256: artifact.sha256, mimeType: artifact.mimeType })) });
  return {
    source: "automatic_target",
    ...(text ? { text } : {}),
    ...(artifactManifest.length ? { artifactManifest } : {}),
    hash: await sha256Text(hashMaterial),
  };
}

function targetCanonical(title: string, revealText: string | undefined, revealArtifacts: RevealArtifactRecord[], tags: string[]): string {
  return JSON.stringify({ title, revealText, artifacts: revealArtifacts.map((artifact) => ({ sha256: artifact.sha256, mimeType: artifact.mimeType })), tags });
}

async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
