import type { AppRepository } from "../storage/repository";
import { createTelepathicSeriesState } from "./engine";
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
  const frozenConfig = await freezeTelepathicTrainingLearning({ repository: input.repository, config: input.config, now: input.now });
  const timestamp = input.now?.() ?? new Date().toISOString();
  const state = createTelepathicSeriesState(frozenConfig, timestamp);
  await input.repository.saveTelepathicSeries(state);
  return structuredClone(state);
}
