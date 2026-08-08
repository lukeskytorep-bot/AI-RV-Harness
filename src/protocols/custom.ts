import type { AppRepository } from "../storage/repository";
import { createId } from "../storage/repository";
import type { CustomProtocolDraft, CustomProtocolDryRunStep, CustomProtocolVersion } from "./types";

type CustomProtocolRepository = Pick<AppRepository, "listCustomProtocols" | "saveCustomProtocolVersion">;

export async function saveCustomProtocol(
  repository: CustomProtocolRepository,
  draft: CustomProtocolDraft,
  protocolId?: string,
): Promise<CustomProtocolVersion> {
  const normalized = normalizeDraft(draft);
  const existing = protocolId ? (await repository.listCustomProtocols()).filter((item) => item.protocolId === protocolId) : [];
  const nextVersionNumber = existing.reduce((max, item) => Math.max(max, Number(item.version.replace(/^v/i, "")) || 0), 0) + 1;
  const id = protocolId ?? createId("protocol");
  const version = `v${nextVersionNumber}`;
  const canonical = JSON.stringify({
    protocolId: id,
    version,
    language: normalized.language,
    systemPrompt: normalized.systemPrompt ?? "",
    steps: normalized.steps,
  });
  return repository.saveCustomProtocolVersion({
    protocolId: id,
    versionId: createId("protocol_version"),
    displayName: normalized.name,
    description: normalized.description,
    version,
    language: normalized.language,
    systemPrompt: normalized.systemPrompt,
    steps: normalized.steps,
    contentHash: await sha256Text(canonical),
    createdAt: new Date().toISOString(),
  });
}

export async function duplicateCustomProtocol(repository: CustomProtocolRepository, source: CustomProtocolVersion, newName: string): Promise<CustomProtocolVersion> {
  return saveCustomProtocol(repository, {
    name: newName,
    description: source.description,
    language: source.language,
    systemPrompt: source.systemPrompt,
    steps: source.steps,
  });
}

export function dryRunCustomProtocol(protocol: CustomProtocolVersion): CustomProtocolDryRunStep[] {
  return [
    ...protocol.steps.map((prompt, index) => ({ sequence: index + 1, role: "Viewer" as const, prompt, boundary: "BLIND" as const })),
    { sequence: protocol.steps.length + 1, role: "Reveal" as const, boundary: "REVEAL" as const },
  ];
}

export function normalizeDraft(draft: CustomProtocolDraft): CustomProtocolDraft {
  const name = draft.name.trim();
  const steps = draft.steps.map((step) => step.trim()).filter(Boolean);
  if (!name) throw new Error("Custom Protocol name is required.");
  if (steps.length < 1 || steps.length > 20) throw new RangeError("Custom Protocol requires 1–20 non-empty blind steps.");
  return {
    name,
    description: draft.description?.trim() || undefined,
    language: draft.language,
    systemPrompt: draft.systemPrompt?.trim() || undefined,
    steps,
  };
}

async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
