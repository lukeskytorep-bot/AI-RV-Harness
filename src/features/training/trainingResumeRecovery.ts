import { prepareViewerSessionResume } from "../../sessions/viewerResumeDecision";
import { withWorkflow } from "../../application/workflowOwnership";
import type { AppRepository } from "../../storage/repository";
import type { TrainingRunRecord } from "../../training/types";
import type { InterfaceLanguage } from "../../types";
import { isTrainingRunUserFinished, userFinishedTrainingError } from "../../training/runLifecycle";

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
  // Post-Reveal operations are optional in Training. Their execution path
  // preserves prior memory automatically, including after an interrupted dispatch.
  // Only blind-session recovery above can require a paid-retry decision.
  return current;
}

export async function prepareTrainingRunResume(input:Parameters<typeof prepareTrainingRunResumeOwned>[0]) {
 const run=(await input.repository.listTrainingRuns()).find(run=>run.id===input.runId);if(!run)throw new Error("Training run no longer available");
 return withWorkflow(input.repository,{profileId:run.profileId,entity:{kind:"training",id:run.id}},repository=>prepareTrainingRunResumeOwned({...input,repository}));
}
