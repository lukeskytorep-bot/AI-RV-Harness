import { prepareViewerNotesForSession, runViewerNoteReflection } from "../../aiCenter/viewerNotes";
import { aiIsBeDisplayName, humanIsBeDisplayName } from "../../domain/isBeIdentity";
import { runBlindJudging, type JudgeSelection } from "../../judge/engine";
import { profileGenerationDefaults } from "../../profileViewerDefaults";
import type { ProviderConfig, ProviderModel } from "../../providers/types";
import { getRvLite } from "../../resources/protocolRegistry";
import type { SessionProgress } from "../../sessions/controller";
import { runAutomaticPostRevealReview } from "../../sessions/postReveal";
import { runAutomaticRvLiteSession } from "../../sessions/rvLiteController";
import type { AppRepository } from "../../storage/repository";
import type { TargetRecord } from "../../targets/types";
import type { TrainingRunRecord } from "../../training/types";
import type { AppSettings, InterfaceLanguage, Profile, ViewerSystemPromptSnapshot } from "../../types";

type ExecutionSettings = Pick<AppSettings, "maxRetries" | "requestTimeoutMs" | "sessionCodePrefix" | "maxSessionCostUsd">;

const defaultDependencies = {
  prepareViewerNotesForSession,
  runAutomaticRvLiteSession,
  runAutomaticPostRevealReview,
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
          ...(execution.rvSystemPrompt ? { rvSystemPrompt: execution.rvSystemPrompt } : {}),
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

      if (checkpoint.stage === "session_revealed") {
        await dependencies.runAutomaticPostRevealReview({
          repository: input.repository,
          sessionId: checkpoint.sessionId,
          viewer: { providerConfig: input.providerConfig, model: input.model },
          timeoutMs: execution.transport.requestTimeoutMs,
          maxRetries: execution.transport.maxRetries,
          signal: input.signal,
          afterViewerReview: async ({ content }) => {
            await dependencies.runViewerNoteReflection({
              repository: input.repository,
              sessionId: checkpoint!.sessionId,
              viewerReview: content,
              providerConfig: input.providerConfig,
              model: input.model,
              timeoutMs: execution.transport.requestTimeoutMs,
              maxRetries: execution.transport.maxRetries,
              signal: input.signal,
            });
          },
        });
        checkpoint = { ...checkpoint, stage: "review_completed" };
        working = { ...working, activeTargetCheckpoint: checkpoint, updatedAt: now() };
        await input.repository.updateTrainingRun(working.id, { activeTargetCheckpoint: checkpoint });
        input.onRunChange?.(working);
      }
      if (input.signal?.aborted) throw new DOMException("Training cancelled", "AbortError");
      if (input.judges.length && checkpoint.stage === "review_completed") {
        await dependencies.runBlindJudging({
          repository: input.repository,
          sessionId: checkpoint.sessionId,
          language: execution.language,
          judges: input.judges,
          maxRetries: execution.transport.maxRetries,
          timeoutMs: execution.transport.requestTimeoutMs,
          signal: input.signal,
        });
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
