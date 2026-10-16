import { prepareViewerSessionResume } from "../../sessions/viewerResumeDecision";
import { learningAuditHasKnownResult, readLearningSettlement } from "../../aiCenter/learningExecution";
import { withWorkflow } from "../../application/workflowOwnership";
import type { AppRepository } from "../../storage/repository";
import type { TrainingRunRecord } from "../../training/types";
import type { InterfaceLanguage } from "../../types";
import { isTrainingRunUserFinished, userFinishedTrainingError } from "../../training/runLifecycle";
import { findCompletedAutomaticViewerReviewRecord } from "../../sessions/postReveal";
import { getPostRevealReviewRecoveryState, resolveUncertainPostRevealReviewStage } from "../../sessions/postRevealRecovery";

export interface TrainingResumeDecisionCopy {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
}

async function prepareTrainingRunResumeOwned(input: {
  repository: AppRepository;
  runId: string;
  fallbackLanguage: InterfaceLanguage;
  confirmUncertainViewerReview: (copy: TrainingResumeDecisionCopy) => Promise<boolean>;
}): Promise<TrainingRunRecord | null> {
  const current = (await input.repository.listTrainingRuns()).find((run) => run.id === input.runId);
  if (!current) throw new Error("Training run is no longer available.");
  if (isTrainingRunUserFinished(current)) throw userFinishedTrainingError();
  const checkpoint = current.activeTargetCheckpoint;
  if (checkpoint && ["blind_initializing", "blind_running"].includes(checkpoint.stage)) {
    const session = await input.repository.getRvSession(checkpoint.sessionId);
    if (!session || session.state === "Revealed" || session.state === "Completed") return current;
    const prepared = await prepareViewerSessionResume({ repository: input.repository, sessionId: checkpoint.sessionId,
      language: current.executionSnapshot?.language ?? input.fallbackLanguage, confirm: input.confirmUncertainViewerReview });
    return prepared ? current : null;
  }
  if (checkpoint && ["review_completed", "field_guide_update_completed"].includes(checkpoint.stage)) {
    const kind = checkpoint.stage === "review_completed" ? "field_guide" : "viewer_notes";
    const events = await input.repository.listSessionEvents(checkpoint.sessionId);
    const attempts = events.filter(e => e.eventType === "LEARNING_PHYSICAL_ATTEMPT" && e.metadata?.kind === kind);
    const snapshot = await input.repository.getSessionSnapshot(checkpoint.sessionId);
    const audits = kind === "field_guide"
      ? (current.fieldGuideUpdates ?? []).filter(a => a.sourceSessionId === checkpoint.sessionId).map(a => ({ ...a, packetHash: a.packetSha256 }))
      : snapshot?.viewerNotes ? (await input.repository.listViewerNoteReflectionRuns(snapshot.viewerNotes.aiIdentityId)).filter(a => a.sourceSessionId === checkpoint.sessionId).map(a => ({ ...a, packetHash: a.reflectionPacketSha256 })) : [];
    const settledPackets = new Set<string>();
    for (const audit of audits) {
      const settled = await readLearningSettlement(input.repository, checkpoint.sessionId, kind, audit.packetHash);
      if (settled?.auditId === audit.id) settledPackets.add(audit.packetHash);
    }
    const unresolved = attempts.filter(e => e.metadata?.state === "reserved" && !settledPackets.has(String(e.metadata?.packetHash))).filter(start => {
      const same = attempts.filter(e => e.metadata?.packetHash === start.metadata?.packetHash && e.metadata?.slot === start.metadata?.slot);
      return !same.some(e => e.metadata?.state === "resolved") && !same.some(e => e.metadata?.state === "finished" && e.metadata?.outcome !== "dispatch_unknown");
    });
    const legacyPending = audits.filter(a => !settledPackets.has(a.packetHash) && !learningAuditHasKnownResult(a)
      && !attempts.some(e => e.metadata?.packetHash === a.packetHash)
      && !events.some(e => e.eventType === "LEARNING_LEGACY_RESOLUTION" && e.metadata?.auditId === a.id));
    if (unresolved.length || legacyPending.length) {
      const pl = (current.executionSnapshot?.language ?? input.fallbackLanguage) === "pl";
      const confirmed = await input.confirmUncertainViewerReview({
        title: pl ? "Rozstrzygnąć niepewną aktualizację pamięci?" : "Resolve uncertain memory update?",
        description: pl ? "Żądanie mogło zostać wykonane. Potwierdzenie rozlicza wskazaną próbę jako nieudaną. Pozostały limit wynosi najwyżej dwa żądania łącznie; historia i poprzednia pamięć pozostają zachowane." : "The request may have executed. Confirmation marks the recorded attempt as failed. At most two requests in total remain allowed; history and previous memory are preserved.",
        confirmLabel: pl ? "Rozstrzygnij i kontynuuj" : "Resolve and continue", cancelLabel: pl ? "Anuluj" : "Cancel",
      });
      if (!confirmed) return null;
      // The enclosing workflow owns and fences the same Training and RV session.
      const refreshed = (await input.repository.listTrainingRuns()).find(r => r.id === current.id);
      if (refreshed?.activeTargetCheckpoint?.sessionId !== checkpoint.sessionId || refreshed.activeTargetCheckpoint.stage !== checkpoint.stage) throw new Error("Learning checkpoint changed during resolution.");
      if (isTrainingRunUserFinished(refreshed)) throw userFinishedTrainingError();
      const freshEvents = await input.repository.listSessionEvents(checkpoint.sessionId);
      if (JSON.stringify(freshEvents.filter(e => e.eventType.startsWith("LEARNING_"))) !== JSON.stringify(events.filter(e => e.eventType.startsWith("LEARNING_")))) throw new Error("Learning attempts changed during confirmation; no newer attempt was resolved.");
      for (const attempt of unresolved) await input.repository.appendSessionEvent(checkpoint.sessionId, { eventType: "LEARNING_PHYSICAL_ATTEMPT", metadata: { ...attempt.metadata, state: "resolved", message: "Explicit user resolution" } });
      for (const audit of legacyPending) await input.repository.appendSessionEvent(checkpoint.sessionId, { eventType: "LEARNING_LEGACY_RESOLUTION", metadata: { auditId: audit.id } });
    }
    return current;
  }
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
    if (isTrainingRunUserFinished(refreshedRun)) throw userFinishedTrainingError();
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

  const finalRun = (await input.repository.listTrainingRuns()).find((run) => run.id === input.runId) ?? current;
  if (isTrainingRunUserFinished(finalRun)) throw userFinishedTrainingError();
  return finalRun;
}

export async function prepareTrainingRunResume(input:Parameters<typeof prepareTrainingRunResumeOwned>[0]) {
 const run=(await input.repository.listTrainingRuns()).find(run=>run.id===input.runId);if(!run)throw new Error("Training run no longer available");
 return withWorkflow(input.repository,{profileId:run.profileId,entity:{kind:"training",id:run.id}},repository=>prepareTrainingRunResumeOwned({...input,repository}));
}
