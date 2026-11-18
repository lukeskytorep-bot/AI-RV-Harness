/** Exclude only STEP1's frozen wire-setting plumbing from historical prompt/execution hashes. */
export function normalizeCustomCompatibilityWiring(value: string): string {
  return value
    .replace('import { newRunGenerationSettings } from "../providers/customCompatibility";\n', "")
    .replace('import type { GenerationSettings, ProviderChatResponse, ProviderConfig, ProviderMessage, ProviderModel, ProviderStreamEvent } from "../providers/types";', 'import type { ProviderChatResponse, ProviderConfig, ProviderMessage, ProviderModel, ProviderStreamEvent } from "../providers/types";')
    .replace('  requestedSettings?: GenerationSettings;\n', "")
    .replace('  const requested = input.requestedSettings ?? newRunGenerationSettings(input.providerConfig, {});\n', "")
    .replace('resolveGenerationSettings(input.model.capabilities, { ...requested, maxOutputTokens }, { provider: input.model.provider })', 'resolveGenerationSettings(input.model.capabilities, { maxOutputTokens })')
    .replace('Partial<Pick<AppRepository, "appendSessionEventWithProviderState" | "getSessionSnapshot">>', 'Partial<Pick<AppRepository, "appendSessionEventWithProviderState">>')
    .replace('  const monitorGenerationSettings = input.monitor ? (input.resumeSession\n    ? (input.repository.getSessionSnapshot ? (await input.repository.getSessionSnapshot(input.resumeSession.id))?.monitor?.generationSettings : undefined) ?? {}\n    : newRunGenerationSettings(input.monitor.providerConfig, {})) : undefined;\n', "")
    .replace('        generationSettings: monitorGenerationSettings,\n', "")
    .replace('              requestedSettings: monitorGenerationSettings,\n', "");
}
