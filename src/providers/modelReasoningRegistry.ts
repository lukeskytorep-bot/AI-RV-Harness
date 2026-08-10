import registryJson from "../resources/modelReasoningRegistry.json";
import type { ProviderKind, ProviderModel, ReasoningCapability, ReasoningEffort, ReasoningOption, ReasoningTransport } from "./types";

export const STANDARD_REASONING_EFFORTS: ReasoningEffort[] = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

type RegistryTransport = { kind: ReasoningTransport["kind"]; value: string };
type RegistryOption = { value: ReasoningEffort; label: string; transports: Record<string, RegistryTransport> };
type RegistryEntry = { id: string; aliases: string[]; mandatory: boolean; source: string; options: RegistryOption[] };
type RegistryDocument = { schemaVersion: number; registryVersion: string; verifiedAt: string; models: RegistryEntry[] };

const registry = registryJson as RegistryDocument;

export function applyModelReasoningRegistry(provider: ProviderKind, modelId: string, discovered: ReasoningCapability): ReasoningCapability {
  if (discovered.registryVersion === registry.registryVersion && discovered.options) return discovered;

  const providerEfforts = [...(discovered.providerEfforts ?? discovered.efforts)];
  const entry = findRegistryEntry(modelId);
  if (entry) {
    const options = entry.options.map((option): ReasoningOption => ({
      value: option.value,
      label: option.label,
      verification: "registry",
      transport: option.transports[provider] ?? option.transports.default ?? defaultTransport(provider, option.value),
    }));
    return {
      ...discovered,
      supported: options.length > 0,
      efforts: options.map((option) => option.value),
      options,
      mandatory: entry.mandatory,
      defaultEffort: discovered.defaultEffort && options.some((option) => option.value === discovered.defaultEffort) ? discovered.defaultEffort : undefined,
      confidence: "verified",
      registryStatus: "known",
      registryModelId: entry.id,
      registryVersion: registry.registryVersion,
      verifiedAt: registry.verifiedAt,
      verificationSource: entry.source,
      providerEfforts,
    };
  }

  const efforts = STANDARD_REASONING_EFFORTS.filter((effort) => !(discovered.mandatory && effort === "none"));
  const options = efforts.map((effort): ReasoningOption => ({
    value: effort,
    label: effort.toUpperCase(),
    verification: providerEfforts.includes(effort) ? "provider_metadata" : "unverified",
    transport: defaultTransport(provider, effort),
  }));
  return {
    ...discovered,
    supported: true,
    efforts,
    options,
    registryStatus: "unknown",
    registryVersion: registry.registryVersion,
    verifiedAt: registry.verifiedAt,
    providerEfforts,
  };
}

export function applyReasoningRegistryToProviderModel(model: ProviderModel): ProviderModel {
  return {
    ...model,
    capabilities: {
      ...model.capabilities,
      reasoning: applyModelReasoningRegistry(model.provider, model.modelId, model.capabilities.reasoning),
    },
  };
}

export function reasoningOptions(capability: ReasoningCapability): ReasoningOption[] {
  return capability.options ?? capability.efforts.map((effort) => ({
    value: effort,
    label: effort.toUpperCase(),
    verification: capability.confidence === "verified" ? "registry" : capability.confidence === "provider_metadata" ? "provider_metadata" : "unverified",
    transport: { kind: "effort", value: effort },
  }));
}

export function findReasoningOption(capability: ReasoningCapability, effort: ReasoningEffort): ReasoningOption | undefined {
  return reasoningOptions(capability).find((option) => option.value === effort);
}

function findRegistryEntry(modelId: string): RegistryEntry | undefined {
  const normalized = normalizeModelId(modelId);
  return registry.models.find((entry) => [entry.id, ...entry.aliases].some((candidate) => normalizeModelId(candidate) === normalized));
}

function normalizeModelId(modelId: string): string {
  return modelId.trim().toLocaleLowerCase().replace(/^models\//, "").replace(/:(?:free|batch)$/i, "");
}

function defaultTransport(provider: ProviderKind, effort: ReasoningEffort): ReasoningTransport {
  return provider === "google"
    ? { kind: "thinking_level", value: effort }
    : { kind: "effort", value: effort };
}
