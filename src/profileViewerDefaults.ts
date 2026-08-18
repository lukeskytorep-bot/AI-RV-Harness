import { resolveGenerationSettings } from "./providers/capabilities";
import type { GenerationSettings, ProviderModel, ReasoningEffort } from "./providers/types";
import type { InterfaceLanguage, Profile, ViewerSystemPromptSnapshot } from "./types";
import { buildEffectiveViewerPrompt, FACTORY_PROMPT_VERSION, factoryViewerEditablePrompt } from "./resources/systemPrompts";

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
  language: InterfaceLanguage = "en",
): Promise<ViewerSystemPromptSnapshot | undefined> {
  if (!profile) return undefined;
  const editable = normalizeProfileSystemPrompt(profile.defaultViewerSystemPrompt ?? "") ?? factoryViewerEditablePrompt(language);
  const content = buildEffectiveViewerPrompt(language, editable);
  return {
    id: `profile_viewer_prompt_${profile.id}`,
    version: `${FACTORY_PROMPT_VERSION}:${profile.updatedAt}`,
    content,
    contentSha256: await sha256Text(content),
  };
}

export async function customSystemPromptSnapshot(
  editableInput: string,
  id: string,
  language: InterfaceLanguage = "en",
): Promise<ViewerSystemPromptSnapshot | undefined> {
  const editable = normalizeProfileSystemPrompt(editableInput);
  if (!editable) return undefined;
  const content = buildEffectiveViewerPrompt(language, editable);
  return { id, version: "1", content, contentSha256: await sha256Text(content) };
}

async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
