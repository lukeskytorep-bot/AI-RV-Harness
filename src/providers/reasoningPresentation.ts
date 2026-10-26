import type { getCopy } from "../i18n";
import { reasoningOptions } from "./modelReasoningRegistry";
import type { CustomReasoningMode, ProviderModel, ReasoningEffort, ReasoningOption } from "./types";

export function reasoningOptionLabel(copy: ReturnType<typeof getCopy>, option: ReasoningOption): string {
  return option.verification === "unverified" ? `${option.label} · ${copy.unverified}` : option.label;
}

export function reasoningCapabilityLead(copy: ReturnType<typeof getCopy>, model: ProviderModel): string {
  const choices = reasoningOptions(model.capabilities.reasoning);
  if (model.capabilities.reasoning.registryStatus === "known" && !choices.length) return copy.reasoningAutoOnly;
  if (model.capabilities.reasoning.mandatory) return copy.reasoningMandatory;
  return model.capabilities.reasoning.registryStatus === "known" ? copy.reasoningVerifiedRegistry : copy.reasoningProviderFallback;
}

export type ReasoningSelectionSource = "provider" | "profile" | "session";

export function reasoningSelectionLead(
  copy: ReturnType<typeof getCopy>,
  model: ProviderModel,
  input: { customReasoningMode?: CustomReasoningMode; reasoningEffort?: "" | ReasoningEffort; source: ReasoningSelectionSource },
): string {
  const sourceSuffix = input.source === "profile"
    ? copy.reasoningSourceProfile
    : input.source === "session"
      ? copy.reasoningSourceSession
      : "";
  let value: string;
  if (model.provider === "custom_openai" && input.customReasoningMode && input.customReasoningMode !== "default") {
    value = input.customReasoningMode === "on" ? copy.customReasoningOn : copy.customReasoningOff;
  } else if (input.reasoningEffort) {
    const option = reasoningOptions(model.capabilities.reasoning).find((item) => item.value === input.reasoningEffort);
    value = option ? reasoningOptionLabel(copy, option) : input.reasoningEffort.toUpperCase();
  } else {
    value = copy.customReasoningDefault;
  }
  return `${copy.reasoning}: ${value}${sourceSuffix ? ` · ${sourceSuffix}` : ""}`;
}
