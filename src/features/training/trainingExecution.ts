import { prepareViewerNotesForSession, runViewerNoteReflection } from "../../aiCenter/viewerNotes";
import { prepareFieldGuideForSession, viewerSystemPromptSnapshotFromFieldGuide } from "../../aiCenter/fieldGuide";
import { sha256Text } from "../../application/sha256";
import { fieldGuideUpdateCompletesStage, runFieldGuideUpdate } from "../../aiCenter/fieldGuideUpdate";
import { aiIsBeDisplayName, humanIsBeDisplayName } from "../../domain/isBeIdentity";
import { runBlindJudging, selectMissingJudgeSelections, type JudgeSelection } from "../../judge/engine";
import { profileGenerationDefaults } from "../../profileViewerDefaults";
import type { ProviderConfig, ProviderModel } from "../../providers/types";
import { getRvLite } from "../../resources/protocolRegistry";
import type { SessionProgress } from "../../sessions/controller";
import { findCompletedAutomaticViewerReviewRecord, runAutomaticPostRevealReview } from "../../sessions/postReveal";
import { runAutomaticRvLiteSession } from "../../sessions/rvLiteController";
import type { AppRepository } from "../../storage/repository";
import type { TargetRecord } from "../../targets/types";
import type { TrainingRunRecord } from "../../training/types";
import type { AppSettings, InterfaceLanguage, Profile, ViewerSystemPromptSnapshot } from "../../types";

type ExecutionSettings = Pick<AppSettings, "maxRetries" | "requestTimeoutMs" | "sessionCodePrefix" | "maxSessionCostUsd">;

const defaultDependencies = {
  prepareFieldGuideForSession,
  viewerSystemPromptSnapshotFromFieldGuide,
  prepareViewerNotesForSession,
  runAutomaticRvLiteSession,
  runAutomaticPostRevealReview,
  runFieldGuideUpdate,
  runViewerNoteReflection,
  runBlindJudging,
};

export interface TrainingProgress {
  index: number;
  total: number;
  target: TargetRecord;
  sessionProgress?: SessionProgress;
}

export interface ExecuteTrainingRunInput {
  repository: AppRepository;
  initial: TrainingRunRecord;
  profile: Profile;
  providerConfig: ProviderConfig;
  model: ProviderModel;
  judges: JudgeSelection[];
  targets: TargetRecord[];
  language: InterfaceLanguage;
  settings: ExecutionSettings;
  rvSystemPrompt?: ViewerSystemPromptSnapshot;
  signal?: AbortSignal;
  shouldPause?: () => boolean;
  onProgress?: (progress: TrainingProgress) => void;
  onRunChange?: (run: TrainingRunRecord) => void;
  now?: () => string;
  dependencies?: Partial<typeof defaultDependencies>;
}

export interface TrainingExecutionOutcome {
  run: TrainingRunRecord;
  error?: string;
}

/** Returns the first target that has no durable completed-target checkpoint. */
export function firstPendingTrainingTargetIndex(run: TrainingRunRecord): number {
  const completed = new Set(run.completedTargetIds);
  const index = run.targetIds.findIndex((targetId) => !completed.has(targetId));
  return index < 0 ? run.targetIds.length : index;
}

export function isTrainingBlockBoundary(run: TrainingRunRecord, zeroBasedIndex: number): boolean {
  if (run.mode === "full") return (zeroBasedIndex + 1) % 7 === 0;
  const current = run.targetIds[zeroBasedIndex];
  const next = run.targetIds[zeroBasedIndex + 1];
  return !next || current.split("_").slice(0, 3).join("_") !== next.split("_").slice(0, 3).join("_");
}

async function currentTrainingRecord(repository: AppRepository, id: string, fallback: TrainingRunRecord): Promise<TrainingRunRecord> {
  return (await repository.listTrainingRuns()).find((run) => run.id === id) ?? fallback;
}


async function trainingPostRevealReviewPacketSha256(repository: AppRepository, sessionId: string, language: InterfaceLanguage, request: string): Promise<string> {
  const [snapshot, reveal, evidence] = await Promise.all([
    repository.getSessionSnapshot(sessionId),
    repository.getReveal(sessionId),
    repository.getViewerEvidence(sessionId),
  ]);
  if (!snapshot || !reveal) throw new Error("Cannot hash the Training post-Reveal Review packet without the immutable Session Snapshot and Reveal.");
  const artifacts = [...(reveal.artifactManifest ?? [])]
    .map((artifact) => ({ artifactId: artifact.artifactId, originalFileName: artifact.originalFileName, mimeType: artifact.mimeType, sha256: artifact.sha256 }))
    .sort((a, b) => a.artifactId.localeCompare(b.artifactId));
  return sha256Text(JSON.stringify({
    packetVersion: "training-post-reveal-review-v1",
    sessionId,
    language,
    viewerRoute: {
      providerConfigId: snapshot.providerConfigId,
      provider: snapshot.provider,
      modelId: snapshot.modelId,
      modelRoute: snapshot.modelRoute,
    },
    sealedBlindEvidence: evidence,
    reveal: { hash: reveal.hash, text: reveal.text?.trim() ?? "", artifacts },
    request,
  }));
}

export async function executeTrainingRun(input: ExecuteTrainingRunInput): Promise<TrainingExecutionOutcome> {
  const dependencies = { ...defaultDependencies, ...input.dependencies };
  const targetById = new Map(input.targets.map((target) => [target.id, target]));
  const completed = new Set(input.initial.completedTargetIds);
  const now = input.now ?? (() => new Date().toISOString());
  let working: TrainingRunRecord = {
    ...input.initial,
    sessionIds: input.initial.sessionIds ?? [],
    currentIndex: firstPendingTrainingTargetIndex(input.initial),
    status: "Running",
    executionSnapshot: input.initial.executionSnapshot ?? {
      language: input.language,
      generationSettings: profileGenerationDefaults(input.profile, input.model),
      transport: { ...input.settings },
      ...(input.rvSystemPrompt ? { rvSystemPrompt: input.rvSystemPrompt } : {}),
    },
  };
  const execution = working.executionSnapshot!;
  input.onRunChange?.(working);

  try {
    await input.repository.updateTrainingRun(working.id, { status: "Running", currentIndex: working.currentIndex, executionSnapshot: execution });
    for (let index = working.currentIndex; index < working.targetIds.length; index += 1) {
      if (input.signal?.aborted) throw new DOMException("Training cancelled", "AbortError");
      const targetId = working.targetIds[index];
      if (completed.has(targetId)) continue;
      const target = targetById.get(targetId);
      if (!target) throw new Error(`Missing target: ${targetId}`);
      input.onProgress?.({ index, total: working.targetIds.length, target });

      let checkpoint = working.activeTargetCheckpoint?.targetId === targetId ? working.activeTargetCheckpoint : undefined;
      if (!checkpoint) {
        // Freeze the currently active Field Guide for this session, not for the
        // whole multi-target Training run. A successful update after target N
        // must therefore be visible to target N+1, while Resume continues from
        // the immutable snapshot already stored by the session controller.
        const fieldGuide = await dependencies.prepareFieldGuideForSession({
          repository: input.repository,
          profile: input.profile,
          providerConfig: input.providerConfig,
          model: input.model,
          language: execution.language,
        });
        const rvSystemPrompt = await dependencies.viewerSystemPromptSnapshotFromFieldGuide(fieldGuide);
        const viewerNotes = await dependencies.prepareViewerNotesForSession({
          repository: input.repository,
          profileId: input.profile.id,
          providerConfig: input.providerConfig,
          model: input.model,
          enabled: working.viewerNotesEnabled ?? false,
        });
        const session = await dependencies.runAutomaticRvLiteSession({
          repository: input.repository,
          workspaceId: working.workspaceId,
          profileId: input.profile.id,
          profileName: aiIsBeDisplayName(input.profile),
          humanIsBeDisplayName: humanIsBeDisplayName(input.profile),
          providerConfig: input.providerConfig,
          model: input.model,
          protocol: getRvLite(execution.language, working.protocolVariant),
          sessionLanguage: execution.language,
          requestedSettings: execution.generationSettings,
          viewerNotes,
          rvSystemPrompt,
          automaticTarget: target,
          signal: input.signal,
          maxRetries: execution.transport.maxRetries,
          requestTimeoutMs: execution.transport.requestTimeoutMs,
          sessionCodePrefix: execution.transport.sessionCodePrefix,
          ...(execution.transport.maxSessionCostUsd > 0 ? { maxSessionCostUsd: execution.transport.maxSessionCostUsd } : {}),
          onProgress: (sessionProgress) => input.onProgress?.({ index, total: working.targetIds.length, target, sessionProgress }),
        });
        if (session.state !== "Revealed") throw new Error(session.stopReason ?? "The training session was interrupted.");
        checkpoint = { targetId, sessionId: session.sessionId, stage: "session_revealed" };
        working = { ...working, activeTargetCheckpoint: checkpoint, updatedAt: now() };
        await input.repository.updateTrainingRun(working.id, { activeTargetCheckpoint: checkpoint });
        input.onRunChange?.(working);
      }

      let viewerReview: string | null = null;
      let viewerReviewRequest: string | null = null;
      const loadStoredViewerReview = async () => {
        const storedSession = (await input.repository.listRvSessions(working.workspaceId)).find((session) => session.id === checkpoint!.sessionId);
        return findCompletedAutomaticViewerReviewRecord(storedSession?.postRevealTranscript ?? "", execution.language);
      };
      const reviewPacketSha256 = async (request: string) => trainingPostRevealReviewPacketSha256(
        input.repository,
        checkpoint!.sessionId,
        execution.language,
        request,
      );

      if (checkpoint.stage === "session_revealed") {
        const storedReview = await loadStoredViewerReview();
        viewerReview = storedReview?.content ?? null;
        viewerReviewRequest = storedReview?.request ?? null;
        if (!viewerReview) {
          const transcript = await dependencies.runAutomaticPostRevealReview({
            repository: input.repository,
            sessionId: checkpoint.sessionId,
            viewer: { providerConfig: input.providerConfig, model: input.model },
            timeoutMs: execution.transport.requestTimeoutMs,
            maxRetries: execution.transport.maxRetries,
            signal: input.signal,
          });
          const completedReview = findCompletedAutomaticViewerReviewRecord(transcript, execution.language);
          viewerReview = completedReview?.content ?? null;
          viewerReviewRequest = completedReview?.request ?? null;
        }
        if (!viewerReview || !viewerReviewRequest) throw new Error("Completed automatic Viewer Review could not be recovered after post-Reveal execution.");
        checkpoint = { ...checkpoint, stage: "review_completed", postRevealReviewPacketSha256: await reviewPacketSha256(viewerReviewRequest) };
        working = { ...working, activeTargetCheckpoint: checkpoint, updatedAt: now() };
        await input.repository.updateTrainingRun(working.id, { activeTargetCheckpoint: checkpoint });
        input.onRunChange?.(working);
      }

      if (checkpoint.stage === "review_completed") {
        if (!viewerReview) {
          const storedReview = await loadStoredViewerReview();
          viewerReview = storedReview?.content ?? null;
          viewerReviewRequest = storedReview?.request ?? null;
        }
        if (!viewerReview) throw new Error("Completed automatic Viewer Review is required before Field Guide Update.");
        const fieldGuideResult = await dependencies.runFieldGuideUpdate({
          repository: input.repository,
          trainingRun: working,
          sessionId: checkpoint.sessionId,
          postRevealReview: viewerReview,
          providerConfig: input.providerConfig,
          model: input.model,
          timeoutMs: execution.transport.requestTimeoutMs,
          maxRetries: execution.transport.maxRetries,
          signal: input.signal,
        });
        if (fieldGuideResult && !fieldGuideUpdateCompletesStage(fieldGuideResult.status)) {
          throw new Error(`Field Guide Update did not complete (${fieldGuideResult.status}).${fieldGuideResult.audit.failureMessage ? ` ${fieldGuideResult.audit.failureMessage}` : ""}`);
        }
        const refreshed = await currentTrainingRecord(input.repository, working.id, working);
        working = { ...refreshed, activeTargetCheckpoint: {
          ...checkpoint,
          stage: "field_guide_update_completed",
          ...(fieldGuideResult?.audit.packetSha256 ? { fieldGuideUpdatePacketSha256: fieldGuideResult.audit.packetSha256 } : {}),
        }, updatedAt: now() };
        checkpoint = working.activeTargetCheckpoint!;
        await input.repository.updateTrainingRun(working.id, { activeTargetCheckpoint: checkpoint });
        input.onRunChange?.(working);
      }

      if (checkpoint.stage === "field_guide_update_completed") {
        if (!viewerReview) viewerReview = (await loadStoredViewerReview())?.content ?? null;
        if (!viewerReview) throw new Error("Completed automatic Viewer Review is required before Viewer Notes Reflection.");
        await dependencies.runViewerNoteReflection({
          repository: input.repository,
          sessionId: checkpoint.sessionId,
          viewerReview,
          providerConfig: input.providerConfig,
          model: input.model,
          timeoutMs: execution.transport.requestTimeoutMs,
          maxRetries: execution.transport.maxRetries,
          signal: input.signal,
        });
        const sessionSnapshot = await input.repository.getSessionSnapshot(checkpoint.sessionId);
        const reflectionPacketSha256 = sessionSnapshot?.viewerNotes?.enabled
          ? (await input.repository.listViewerNoteReflectionRuns(sessionSnapshot.viewerNotes.aiIdentityId))
              .filter((run) => run.sourceSessionId === checkpoint!.sessionId && run.status !== "PENDING")
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.reflectionPacketSha256
          : undefined;
        checkpoint = {
          ...checkpoint,
          stage: "viewer_notes_reflection_completed",
          ...(reflectionPacketSha256 ? { viewerNotesReflectionPacketSha256: reflectionPacketSha256 } : {}),
        };
        working = { ...working, activeTargetCheckpoint: checkpoint, updatedAt: now() };
        await input.repository.updateTrainingRun(working.id, { activeTargetCheckpoint: checkpoint });
        input.onRunChange?.(working);
      }

      if (input.signal?.aborted) throw new DOMException("Training cancelled", "AbortError");
      if (input.judges.length && checkpoint.stage === "viewer_notes_reflection_completed") {
        const existingScores = await input.repository.listJudgeScores(checkpoint.sessionId);
        const missingJudges = selectMissingJudgeSelections(existingScores, input.judges);
        if (missingJudges.length) {
          await dependencies.runBlindJudging({
            repository: input.repository,
            sessionId: checkpoint.sessionId,
            language: execution.language,
            judges: missingJudges,
            maxRetries: execution.transport.maxRetries,
            timeoutMs: execution.transport.requestTimeoutMs,
            signal: input.signal,
          });
        }
        checkpoint = { ...checkpoint, stage: "judging_completed" };
        working = { ...working, activeTargetCheckpoint: checkpoint, updatedAt: now() };
        await input.repository.updateTrainingRun(working.id, { activeTargetCheckpoint: checkpoint });
        input.onRunChange?.(working);
      }
      if (input.signal?.aborted) throw new DOMException("Training cancelled", "AbortError");
      await input.repository.updateRvSessionState(checkpoint.sessionId, "Completed");

      completed.add(target.id);
      working = {
        ...working,
        completedTargetIds: [...working.completedTargetIds, target.id],
        sessionIds: [...working.sessionIds, checkpoint.sessionId],
        currentIndex: index + 1,
        activeTargetCheckpoint: undefined,
        updatedAt: now(),
      };
      await input.repository.updateTrainingRun(working.id, {
        completedTargetIds: working.completedTargetIds,
        sessionIds: working.sessionIds,
        currentIndex: working.currentIndex,
        activeTargetCheckpoint: null,
      });
      input.onRunChange?.(working);

      if (input.shouldPause?.() || (working.pauseAfterBlock && isTrainingBlockBoundary(working, index) && index + 1 < working.targetIds.length)) {
        working = { ...working, status: "Paused", updatedAt: now() };
        await input.repository.updateTrainingRun(working.id, { status: "Paused" });
        input.onRunChange?.(working);
        return { run: working };
      }
    }

    working = { ...working, status: "Completed", currentIndex: working.targetIds.length, completedAt: now(), updatedAt: now() };
    await input.repository.updateTrainingRun(working.id, { status: "Completed", currentIndex: working.currentIndex, completedAt: working.completedAt });
    input.onRunChange?.(working);
    return { run: working };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    working = { ...working, status: "Interrupted", errors: [...working.errors, message], updatedAt: now() };
    await input.repository.updateTrainingRun(working.id, { status: "Interrupted", error: message });
    input.onRunChange?.(working);
    return { run: working, error: message };
  }
}
