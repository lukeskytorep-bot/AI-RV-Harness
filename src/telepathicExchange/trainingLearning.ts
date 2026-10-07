import { sha256Text } from "../application/sha256";
import type { ProviderMessage } from "../providers/types";
import type { AppRepository } from "../storage/repository";
import type { TelepathicProviderPacket } from "./packets";
import type { TelepathicLanguage, TelepathicLearningSnapshotRef, TelepathicParticipant, TelepathicSeriesConfig } from "./types";

function nowIso(now?: () => string): string {
  return now?.() ?? new Date().toISOString();
}

async function assertStoredHash(label: string, content: string, expectedSha256: string): Promise<void> {
  const actual = await sha256Text(content);
  if (actual !== expectedSha256) throw new Error(`${label} content no longer matches its stored SHA-256.`);
}

async function snapshotFieldGuide(input: {
  repository: AppRepository;
  participant: TelepathicParticipant;
  language: TelepathicLanguage;
  capturedAt: string;
}): Promise<TelepathicLearningSnapshotRef | undefined> {
  const identityId = input.participant.ai?.aiIdentityId;
  if (!identityId) return undefined;
  const bundle = await input.repository.getExistingFieldGuideBundle(identityId, input.language);
  const active = bundle?.activeVersion;
  if (!active) return undefined;
  if (active.aiIdentityId !== identityId) throw new Error("Field Guide active version does not belong to the selected AI Identity.");
  if (active.language !== input.language) throw new Error("Field Guide active version language does not match the training language.");
  await assertStoredHash("Field Guide", active.content, active.contentSha256);
  return {
    id: active.id,
    version: String(active.versionNumber),
    versionNumber: active.versionNumber,
    content: active.content,
    contentSha256: active.contentSha256,
    capturedAt: input.capturedAt,
    profileId: input.participant.ai?.profileId,
    aiIdentityId: input.participant.ai?.aiIdentityId,
    modelRoute: input.participant.ai?.route ?? "",
    language: input.language,
    estimatedTokens: active.estimatedTokens,
  };
}

async function snapshotViewerNotes(input: {
  repository: AppRepository;
  participant: TelepathicParticipant;
  capturedAt: string;
}): Promise<TelepathicLearningSnapshotRef | undefined> {
  const identityId = input.participant.ai?.aiIdentityId;
  if (!identityId) return undefined;
  const bundle = await input.repository.getExistingViewerNoteBundle(identityId);
  const active = bundle?.activeVersion;
  if (!active) return undefined;
  if (active.aiIdentityId !== identityId) throw new Error("Viewer Notes active version does not belong to the selected AI Identity.");
  await assertStoredHash("Viewer Notes", active.content, active.contentSha256);
  return {
    id: active.id,
    version: String(active.versionNumber),
    versionNumber: active.versionNumber,
    content: active.content,
    contentSha256: active.contentSha256,
    capturedAt: input.capturedAt,
    profileId: input.participant.ai?.profileId,
    aiIdentityId: input.participant.ai?.aiIdentityId,
    modelRoute: input.participant.ai?.route ?? "",
    estimatedTokens: active.estimatedTokens,
  };
}

/**
 * Freeze the exact active Viewer Learning content for an AI-AI telepathic
 * training series. This is deliberately read-only: the function only reads
 * existing Field Guide / Viewer Notes bundles and never bootstraps, restores,
 * activates, reflects on, or updates either learning package.
 */
export async function freezeTelepathicTrainingLearning(input: {
  repository: AppRepository;
  config: TelepathicSeriesConfig;
  now?: () => string;
}): Promise<TelepathicSeriesConfig> {
  if (input.config.mode !== "ai_ai_training") throw new Error("Viewer Learning snapshots are frozen only for AI-AI telepathic training.");
  if (input.config.participants.some((item) => item.kind !== "ai" || !item.ai)) throw new Error("AI-AI telepathic training requires AI participants with frozen route snapshots.");
  const capturedAt = nowIso(input.now);
  const participants = await Promise.all(input.config.participants.map(async (item) => ({
    ...structuredClone(item),
    fieldGuide: await snapshotFieldGuide({ repository: input.repository, participant: item, language: input.config.language, capturedAt }),
    viewerNotes: await snapshotViewerNotes({ repository: input.repository, participant: item, capturedAt }),
  })));
  return { ...structuredClone(input.config), participants };
}

export async function assertTelepathicLearningSnapshotIntegrity(input: {
  snapshot: TelepathicLearningSnapshotRef;
  label: string;
  participant: TelepathicParticipant;
  expectedLanguage?: TelepathicLanguage;
}): Promise<void> {
  const { snapshot, label, participant, expectedLanguage } = input;
  if (!participant.ai) throw new Error(`${label} snapshot requires an AI participant.`);
  if (!snapshot.content || !snapshot.capturedAt || !snapshot.profileId || !snapshot.aiIdentityId || !snapshot.modelRoute) {
    throw new Error(`${label} snapshot is incomplete.`);
  }
  if (snapshot.profileId !== participant.ai.profileId) throw new Error(`${label} snapshot Profile does not match the participant.`);
  if (snapshot.aiIdentityId !== participant.ai.aiIdentityId) throw new Error(`${label} snapshot AI Identity does not match the participant.`);
  if (snapshot.modelRoute !== participant.ai.route) throw new Error(`${label} snapshot model route does not match the participant.`);
  if (expectedLanguage && snapshot.language !== expectedLanguage) throw new Error(`${label} snapshot language does not match the training language.`);
  await assertStoredHash(label, snapshot.content, snapshot.contentSha256);
}

function learningBoundary(language: TelepathicLanguage): string {
  return language === "pl"
    ? "Poniższe Field Guide i Viewer Notes są zamrożonym, osobistym kontekstem tej dokładnej tożsamości Viewera. Są tylko do odczytu w tym treningu telepatycznym. Możesz korzystać z zawartego doświadczenia, ale nie twórz, nie aktualizuj ani nie przepisuj tych zasobów. Nie traktuj ich jako danych celu ani danych innych uczestników."
    : "The Field Guide and Viewer Notes below are frozen personal context for this exact Viewer identity. They are read-only in this telepathic training. You may use the experience they contain, but do not create, update, or rewrite these resources. Do not treat them as target data or as data from other participants.";
}

function learningMessage(kind: "FIELD GUIDE" | "VIEWER NOTES", snapshot: TelepathicLearningSnapshotRef, participant: TelepathicParticipant): ProviderMessage {
  return {
    role: "system",
    content: `[TELEPATHIC TRAINING ${kind} — READ-ONLY]\nparticipant=${participant.id}\nidentity=${participant.ai?.aiIdentityId ?? "unknown"}\nroute=${snapshot.modelRoute}\nversion=${snapshot.version}\nversion_id=${snapshot.id}\nsha256=${snapshot.contentSha256}\ncaptured_at=${snapshot.capturedAt}\n[BEGIN ${kind}]\n${snapshot.content}\n[END ${kind}]`,
  };
}

/**
 * Add only this participant's frozen learning to an AI-AI training call.
 * The packet scope and user-stage content remain unchanged, so blindness and
 * round isolation are preserved. Conversation telepathic exchange is never
 * enriched by this function.
 */
export async function withTelepathicTrainingLearning(input: {
  packet: TelepathicProviderPacket;
  participant: TelepathicParticipant;
  language: TelepathicLanguage;
}): Promise<TelepathicProviderPacket> {
  if (input.participant.kind !== "ai" || !input.participant.ai) throw new Error("Telepathic training learning requires an AI participant.");
  const messages: ProviderMessage[] = [{ role: "system", content: `[TELEPATHIC TRAINING VIEWER LEARNING — READ-ONLY BOUNDARY]\n${learningBoundary(input.language)}` }];
  if (input.participant.fieldGuide) {
    await assertTelepathicLearningSnapshotIntegrity({
      snapshot: input.participant.fieldGuide,
      label: "Field Guide",
      participant: input.participant,
      expectedLanguage: input.language,
    });
    messages.push(learningMessage("FIELD GUIDE", input.participant.fieldGuide, input.participant));
  }
  if (input.participant.viewerNotes) {
    await assertTelepathicLearningSnapshotIntegrity({
      snapshot: input.participant.viewerNotes,
      label: "Viewer Notes",
      participant: input.participant,
    });
    messages.push(learningMessage("VIEWER NOTES", input.participant.viewerNotes, input.participant));
  }
  return { ...input.packet, messages: [...messages, ...input.packet.messages.map((message: ProviderMessage) => ({ ...message }))] };
}
