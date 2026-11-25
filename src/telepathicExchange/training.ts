import type { AppRepository } from "../storage/repository";
import { createTelepathicSeriesState } from "./engine";
import { freezeTelepathicTrainingTargetCode, restoreTelepathicTrainingTargetCode } from "./trainingTargetCode";
import { freezeTelepathicTrainingLearning } from "./trainingLearning";
import type { TelepathicSeriesConfig, TelepathicSeriesState } from "./types";

/**
 * Create and persist an AI-AI telepathic training series after freezing the
 * exact active Viewer Learning packages for every participant. The learning
 * bundles are read only; no Field Guide or Viewer Notes write API is called.
 */
export async function createTelepathicAiTrainingSeries(input: {
  repository: AppRepository;
  config: TelepathicSeriesConfig;
  now?: () => string;
}): Promise<TelepathicSeriesState> {
  if (input.config.mode !== "ai_ai_training") throw new Error("Telepathic Training requires mode=ai_ai_training.");
  const codeConfig = await freezeTelepathicTrainingTargetCode(input.config, await input.repository.listProfiles());
  const frozenConfig = await freezeTelepathicTrainingLearning({ repository: input.repository, config: codeConfig, now: input.now });
  const timestamp = input.now?.() ?? new Date().toISOString();
  const state = createTelepathicSeriesState(frozenConfig, timestamp);
  await restoreTelepathicTrainingTargetCode(state);
  await input.repository.saveTelepathicSeries(state);
  return structuredClone(state);
}
