import { resolveGenerationSettings } from "./providers/capabilities";
import type { GenerationSettings, ProviderModel, ReasoningEffort } from "./providers/types";
import type { Profile, ViewerSystemPromptSnapshot } from "./types";

export const DEFAULT_VIEWER_TEMPERATURE = 0.9;
export const MAX_PROFILE_SYSTEM_PROMPT_LENGTH = 100_000;

export function defaultTemperatureForModel(model: ProviderModel | null): number | undefined {
  if (!model?.capabilities.temperature.supported) return undefined;
  const { min, max } = model.capabilities.temperature;
  return Math.min(max ?? DEFAULT_VIEWER_TEMPERATURE, Math.max(min ?? DEFAULT_VIEWER_TEMPERATURE, DEFAULT_VIEWER_TEMPERATURE));
}

export function reasoningEffortForModel(
  model: ProviderModel | null,
  effort?: ReasoningEffort,
): ReasoningEffort | undefined {
  if (!model || !effort || !model.capabilities.reasoning.supported) return undefined;
  if (model.capabilities.reasoning.mandatory && effort === "none") return undefined;
  return model.capabilities.reasoning.efforts.includes(effort) ? effort : undefined;
}

export function profileGenerationDefaults(
  profile: Profile | null,
  model: ProviderModel | null,
): GenerationSettings {
  if (!model) return {};
  const useCalibratedPair = profile?.defaultViewerModelId === model.modelId;
  const requested: GenerationSettings = {
    ...(useCalibratedPair && reasoningEffortForModel(model, profile?.defaultViewerReasoningEffort)
      ? { reasoningEffort: profile!.defaultViewerReasoningEffort }
      : {}),
    ...(model.capabilities.temperature.supported
      ? {
          temperature:
            useCalibratedPair && profile?.defaultViewerTemperature !== undefined
              ? profile.defaultViewerTemperature
              : defaultTemperatureForModel(model),
        }
      : {}),
  };
  return resolveGenerationSettings(model.capabilities, requested).effective;
}

export function normalizeProfileSystemPrompt(value: string): string | undefined {
  const content = value.trim();
  if (!content) return undefined;
  if (content.length > MAX_PROFILE_SYSTEM_PROMPT_LENGTH) {
    throw new RangeError(`Viewer System Prompt must not exceed ${MAX_PROFILE_SYSTEM_PROMPT_LENGTH.toLocaleString()} characters.`);
  }
  return content;
}

export async function profileSystemPromptSnapshot(
  profile: Profile | null,
): Promise<ViewerSystemPromptSnapshot | undefined> {
  const content = normalizeProfileSystemPrompt(profile?.defaultViewerSystemPrompt ?? "");
  if (!profile || !content) return undefined;
  return {
    id: `profile_viewer_prompt_${profile.id}`,
    version: profile.updatedAt,
    content,
    contentSha256: await sha256Text(content),
  };
}

export async function customSystemPromptSnapshot(
  contentInput: string,
  id: string,
): Promise<ViewerSystemPromptSnapshot | undefined> {
  const content = normalizeProfileSystemPrompt(contentInput);
  if (!content) return undefined;
  return { id, version: "1", content, contentSha256: await sha256Text(content) };
}

async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
