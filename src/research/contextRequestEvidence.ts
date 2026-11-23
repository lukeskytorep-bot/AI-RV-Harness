import { sha256Text } from "../application/sha256";
import type { EffectiveGenerationSettings, ProviderMessage } from "../providers/types";
import type { SessionEventRecord } from "../sessions/types";

export const RESEARCH_CONTEXT_REQUEST_EVIDENCE_EVENT = "RESEARCH_CONTEXT_REQUEST_EVIDENCE_V1";

export interface ResearchContextRequestEvidenceMessage {
  index: number;
  role: ProviderMessage["role"];
  content: string;
  sha256: string;
}

export interface ResearchContextRequestEvidence {
  version: 1;
  messagesSha256: string;
  messages: ResearchContextRequestEvidenceMessage[];
  requestedMaxOutputTokens?: number;
  effectiveMaxOutputTokens?: number;
}

export async function buildResearchContextRequestEvidence(
  messages: readonly ProviderMessage[],
  settings: EffectiveGenerationSettings,
): Promise<ResearchContextRequestEvidence> {
  const evidenceMessages = await Promise.all(messages.map(async (message, index) => ({
    index,
    role: message.role,
    content: message.content,
    sha256: await sha256Text(message.content),
  })));
  const messagesSha256 = await sha256Text(JSON.stringify(evidenceMessages.map(({ role, content }) => ({ role, content }))));
  return {
    version: 1,
    messagesSha256,
    messages: evidenceMessages,
    ...(settings.requested.maxOutputTokens !== undefined ? { requestedMaxOutputTokens: settings.requested.maxOutputTokens } : {}),
    ...(settings.effective.maxOutputTokens !== undefined ? { effectiveMaxOutputTokens: settings.effective.maxOutputTokens } : {}),
  };
}


export interface ResearchContextRequestEvidenceRecord {
  eventId: string;
  sequenceNumber: number;
  evidence: ResearchContextRequestEvidence;
  logicalRequestId?: string;
  physicalAttempt?: number;
  physicalAttemptId?: string;
  stepId?: string;
  recoveryLevel?: number;
  semanticAttempt?: number;
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function metadataNumber(metadata: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function parseResearchContextRequestEvidenceEvents(events: readonly SessionEventRecord[]): ResearchContextRequestEvidenceRecord[] {
  const records: ResearchContextRequestEvidenceRecord[] = [];
  for (const event of events) {
    if (event.eventType !== RESEARCH_CONTEXT_REQUEST_EVIDENCE_EVENT || !event.content) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(event.content); } catch { continue; }
    if (!parsed || typeof parsed !== "object") continue;
    const evidence = parsed as Partial<ResearchContextRequestEvidence>;
    if (evidence.version !== 1 || typeof evidence.messagesSha256 !== "string" || !Array.isArray(evidence.messages)) continue;
    if (!evidence.messages.every((message) => message && typeof message === "object" && typeof message.index === "number" && typeof message.role === "string" && typeof message.content === "string" && typeof message.sha256 === "string")) continue;
    records.push({
      eventId: event.id,
      sequenceNumber: event.sequenceNumber,
      evidence: evidence as ResearchContextRequestEvidence,
      logicalRequestId: metadataString(event.metadata, "logicalRequestId"),
      physicalAttempt: metadataNumber(event.metadata, "physicalAttempt"),
      physicalAttemptId: metadataString(event.metadata, "physicalAttemptId"),
      stepId: metadataString(event.metadata, "stepId"),
      recoveryLevel: metadataNumber(event.metadata, "recoveryLevel"),
      semanticAttempt: metadataNumber(event.metadata, "semanticAttempt"),
    });
  }
  return records.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
}

export interface ResearchContextRequestEvidenceSummary {
  physicalAttempts: number;
  logicalRequests: number;
  transportRetries: number;
  recoveryAttempts: number;
}

export function summarizeResearchContextRequestEvidence(records: readonly ResearchContextRequestEvidenceRecord[]): ResearchContextRequestEvidenceSummary {
  const logicalRequests = new Set(records.map((record) => record.logicalRequestId).filter((value): value is string => Boolean(value)));
  return {
    physicalAttempts: records.length,
    logicalRequests: logicalRequests.size || records.length,
    transportRetries: records.filter((record) => (record.physicalAttempt ?? 1) > 1).length,
    recoveryAttempts: records.filter((record) => (record.recoveryLevel ?? 0) > 0).length,
  };
}
