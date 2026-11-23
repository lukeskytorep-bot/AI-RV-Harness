import { sha256Text } from "../application/sha256";
import type { EffectiveGenerationSettings, ProviderMessage } from "../providers/types";

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
