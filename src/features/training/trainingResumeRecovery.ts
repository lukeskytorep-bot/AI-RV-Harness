import type { AppRepository } from "../../storage/repository";
import type { TrainingRunRecord } from "../../training/types";
import type { InterfaceLanguage } from "../../types";
import { findCompletedAutomaticViewerReviewRecord } from "../../sessions/postReveal";
import { getPostRevealReviewRecoveryState, resolveUncertainPostRevealReviewStage } from "../../sessions/postRevealRecovery";

export interface TrainingResumeDecisionCopy {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
}

export async function prepareTrainingRunResume(input: {
  repository: AppRepository;
  runId: string;
  fallbackLanguage: InterfaceLanguage;
  confirmUncertainViewerReview: (copy: TrainingResumeDecisionCopy) => Promise<boolean>;
}): Promise<TrainingRunRecord | null> {
  const current = (await input.repository.listTrainingRuns()).find((run) => run.id === input.runId);
  if (!current) throw new Error("Training run is no longer available.");
  const checkpoint = current.activeTargetCheckpoint;
  if (!checkpoint || checkpoint.stage !== "session_revealed") return current;

  const language = current.executionSnapshot?.language ?? input.fallbackLanguage;
  const session = await input.repository.getRvSession(checkpoint.sessionId);
  const completed = findCompletedAutomaticViewerReviewRecord(session?.postRevealTranscript ?? "", language);
  let recovery = await getPostRevealReviewRecoveryState(input.repository, checkpoint.sessionId, { viewer: Boolean(completed) });
  if (completed || !recovery.requiresDecision) return current;
  if (recovery.nextStage !== "viewer") throw new Error("Training Resume found an unexpected uncertain post-Reveal stage.");
  const decisionAttempt = recovery.viewer?.attempt;
  if (!decisionAttempt) throw new Error("Training Resume could not identify the uncertain Viewer Review attempt.");

  const pl = language === "pl";
  const confirmed = await input.confirmUncertainViewerReview({
    title: pl ? "Ponowić niepewny Viewer Review?" : "Retry uncertain Viewer Review?",
    description: pl
      ? "Poprzednie wywołanie Viewera mogło zostać wykonane, ale jego wynik nie został trwale zapisany. Ponowienie może spowodować dodatkowe naliczenie kosztu. Potwierdzenie oznacza uznanie tej konkretnej próby za nieudaną i ponowienie tylko brakującego Viewer Review."
      : "The previous Viewer call may have been executed, but its result was not durably saved. Retrying may incur an additional charge. Confirming marks only that specific uncertain attempt as failed and retries only the missing Viewer Review.",
    confirmLabel: pl ? "Ponów Viewer Review" : "Retry Viewer Review",
    cancelLabel: pl ? "Anuluj" : "Cancel",
  });
  if (!confirmed) return null;

  await input.repository.withPostRevealReviewLease(checkpoint.sessionId, async () => {
    const refreshedRun = (await input.repository.listTrainingRuns()).find((run) => run.id === input.runId);
    if (!refreshedRun) throw new Error("Training run is no longer available.");
    const refreshedCheckpoint = refreshedRun.activeTargetCheckpoint;
    if (!refreshedCheckpoint || refreshedCheckpoint.sessionId !== checkpoint.sessionId || refreshedCheckpoint.stage !== "session_revealed") return;

    const refreshedSession = await input.repository.getRvSession(checkpoint.sessionId);
    const refreshedCompleted = findCompletedAutomaticViewerReviewRecord(refreshedSession?.postRevealTranscript ?? "", language);
    recovery = await getPostRevealReviewRecoveryState(input.repository, checkpoint.sessionId, { viewer: Boolean(refreshedCompleted) });
    if (refreshedCompleted || !recovery.requiresDecision) return;
    if (recovery.nextStage !== "viewer") throw new Error("Training Resume found an unexpected uncertain post-Reveal stage.");
    if (recovery.viewer?.attempt !== decisionAttempt) {
      throw new Error(pl
        ? "Stan Viewer Review zmienił się podczas potwierdzenia. Nie rozstrzygnięto nowszej próby. Użyj Wznów ponownie, aby ocenić aktualny stan."
        : "The Viewer Review state changed while confirmation was open. The newer attempt was not resolved. Use Resume again to review the current state.");
    }
    await resolveUncertainPostRevealReviewStage({ repository: input.repository, sessionId: checkpoint.sessionId, stage: "viewer" });
  });

  return (await input.repository.listTrainingRuns()).find((run) => run.id === input.runId) ?? current;
}
