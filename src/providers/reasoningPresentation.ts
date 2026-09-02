import type { getCopy } from "../i18n";
import { reasoningOptions } from "./modelReasoningRegistry";
import type { ProviderModel, ReasoningOption } from "./types";

export function reasoningOptionLabel(copy: ReturnType<typeof getCopy>, option: ReasoningOption): string {
  return option.verification === "unverified" ? `${option.label} · ${copy.unverified}` : option.label;
}

export function reasoningCapabilityLead(copy: ReturnType<typeof getCopy>, model: ProviderModel): string {
  const choices = reasoningOptions(model.capabilities.reasoning);
  if (model.capabilities.reasoning.registryStatus === "known" && !choices.length) return copy.reasoningAutoOnly;
  if (model.capabilities.reasoning.mandatory) return copy.reasoningMandatory;
  return model.capabilities.reasoning.registryStatus === "known" ? copy.reasoningVerifiedRegistry : copy.reasoningProviderFallback;
}
