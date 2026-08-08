import { resolveGenerationSettings } from "../providers/capabilities";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import { getFullRcp } from "../resources/protocolRegistry";
import type { TargetRecord, TargetUsageRecord } from "../targets/types";
import { targetHasSupportedReveal } from "../targets/service";
import type { Profile } from "../types";
import type { PreflightCheck, ResearchConfig, ResearchPreflightResult } from "./types";

export interface ResearchPreflightInventory {
  profiles: Profile[];
  providerConfigs: ProviderConfig[];
  models: ProviderModel[];
  targets: TargetRecord[];
  targetUsage: TargetUsageRecord[];
}

export function runResearchPreflight(config: ResearchConfig, inventory: ResearchPreflightInventory): ResearchPreflightResult {
  const checks: PreflightCheck[] = [];
  const targetMap = new Map(inventory.targets.map((target) => [target.id, target]));
  const providerMap = new Map(inventory.providerConfigs.map((provider) => [provider.id, provider]));
  const profileMap = new Map(inventory.profiles.map((profile) => [profile.id, profile]));
  const modelKey = (providerConfigId: string, modelId: string) => `${providerConfigId}::${modelId}`;
  const modelMap = new Map(inventory.models.map((model) => [modelKey(model.providerConfigId, model.modelId), model]));

  if (config.sessionPolicy) {
    checks.push(config.sessionPolicy.requestTimeoutMs >= 1_000 && config.sessionPolicy.requestTimeoutMs <= 600_000 ? pass("session_timeout", "Request timeout is within the supported safety range") : fail("session_timeout", "Request timeout must be between 1 and 600 seconds"));
    checks.push(Number.isInteger(config.sessionPolicy.maxRetries) && config.sessionPolicy.maxRetries >= 0 && config.sessionPolicy.maxRetries <= 5 ? pass("session_retries", "Retry policy is valid") : fail("session_retries", "Retry count must be between 0 and 5"));
    checks.push(config.sessionPolicy.defaultMaxOutputTokens > 0 ? pass("session_output", "Default output limit is valid") : fail("session_output", "Default output limit must be positive"));
    checks.push(config.sessionPolicy.maxSessionCostUsd >= 0 ? pass("session_cost_limit", config.sessionPolicy.maxSessionCostUsd > 0 ? "A hard per-session cost stop is locked into the experiment" : "No hard per-session cost stop is configured") : fail("session_cost_limit", "Session cost limit cannot be negative"));
    checks.push(/^[A-Za-z0-9]{1,12}$/.test(config.sessionPolicy.sessionCodePrefix) ? pass("session_code", "Session code prefix is valid") : fail("session_code", "Session code prefix must contain 1–12 alphanumeric characters"));
  } else {
    checks.push(warn("session_policy", "Legacy Research configuration has no explicit Settings session-policy snapshot"));
  }

  const targets = config.targetIds.map((id) => targetMap.get(id));
  checks.push(targets.every(Boolean) ? pass("targets", `${targets.length} target(s) found`) : fail("targets", "One or more selected targets are missing"));
  checks.push(targets.every((target) => targetHasSupportedReveal(target)) ? pass("target_reveal", "Every selected target has supported reveal evidence") : fail("target_reveal", "All selected targets need a reveal description or supported image"));
  const requiresVision = targets.some((target) => target?.revealArtifacts?.some((artifact) => artifact.mimeType.startsWith("image/")));
  if (config.requireUnusedTargets) {
    const profileIds = new Set(config.conditions.map((condition) => condition.profileId));
    const used = new Set(inventory.targetUsage.filter((usage) => !usage.profileId || profileIds.has(usage.profileId)).map((usage) => usage.targetId));
    const reused = config.targetIds.filter((id) => used.has(id));
    checks.push(reused.length ? fail("target_reuse", `${reused.length} selected target(s) were already used by a participating Profile`) : pass("target_reuse", "Selected targets satisfy the unused-target rule"));
  } else {
    checks.push(warn("target_reuse", "Target reuse is allowed by this configuration"));
  }

  const effectiveSignatures = new Map<string, string[]>();
  for (const condition of config.conditions) {
    const profile = profileMap.get(condition.profileId);
    const provider = providerMap.get(condition.providerConfigId);
    const model = modelMap.get(modelKey(condition.providerConfigId, condition.modelId));
    const prefix = `condition:${condition.key}`;
    checks.push(profile ? pass(`${prefix}:profile`, `${condition.label}: Profile found`) : fail(`${prefix}:profile`, `${condition.label}: Profile is missing`));
    checks.push(provider?.lastStatus === "ok" ? pass(`${prefix}:provider`, `${condition.label}: provider connection was tested successfully`) : fail(`${prefix}:provider`, `${condition.label}: provider connection must pass Test & refresh before Research`));
    if (profile && provider && profile.credentialId !== provider.credentialId) checks.push(fail(`${prefix}:binding`, `${condition.label}: Profile is not bound to the selected API identity`));
    else if (profile && provider) checks.push(pass(`${prefix}:binding`, `${condition.label}: Profile/API identity binding matches`));
    if (!model) {
      checks.push(fail(`${prefix}:model`, `${condition.label}: model is not present in the current registry`));
      continue;
    }
    checks.push(pass(`${prefix}:model`, `${condition.label}: model route is cached`));
    const effective = resolveGenerationSettings(model.capabilities, condition.requestedSettings);
    checks.push(effective.omitted.length ? fail(`${prefix}:settings`, `${condition.label}: unsupported setting(s): ${effective.omitted.join(", ")}`) : pass(`${prefix}:settings`, `${condition.label}: requested settings are supported`));
    checks.push(condition.capabilitySnapshot && condition.effectiveSettings ? pass(`${prefix}:snapshot`, `${condition.label}: capability + requested/effective settings snapshot is present`) : fail(`${prefix}:snapshot`, `${condition.label}: Research capability snapshot is missing`));
    const signature = JSON.stringify(effective.effective);
    effectiveSignatures.set(signature, [...(effectiveSignatures.get(signature) ?? []), condition.key]);

    const protocol = getFullRcp(config.sessionLanguage);
    const roughInputTokens = Math.ceil((protocol.content.length + (condition.systemPrompt?.content.length ?? 0)) / 3.5);
    if (model.capabilities.contextTokens && roughInputTokens >= model.capabilities.contextTokens) checks.push(fail(`${prefix}:context`, `${condition.label}: estimated protocol context exceeds the advertised context window`));
    else if (model.capabilities.contextTokens) checks.push(pass(`${prefix}:context`, `${condition.label}: advertised context window is sufficient for protocol preflight`));
    else checks.push(warn(`${prefix}:context`, `${condition.label}: provider did not advertise a context limit`));
  }
  if ((config.templateType === "reasoning" || config.templateType === "temperature") && [...effectiveSignatures.values()].some((keys) => keys.length > 1)) {
    checks.push(fail("condition_distinguishability", "Two or more tested conditions resolve to the same effective generation settings"));
  } else {
    checks.push(pass("condition_distinguishability", "Tested conditions remain distinguishable at the known capability layer"));
  }

  for (let index = 0; index < config.judges.length; index += 1) {
    const judge = config.judges[index];
    const provider = providerMap.get(judge.providerConfigId);
    const model = modelMap.get(modelKey(judge.providerConfigId, judge.modelId));
    checks.push(provider?.lastStatus === "ok" ? pass(`judge:${index}:provider`, `Judge ${index + 1}: provider connection tested`) : fail(`judge:${index}:provider`, `Judge ${index + 1}: provider connection must be tested`));
    checks.push(model ? pass(`judge:${index}:model`, `Judge ${index + 1}: model route found`) : fail(`judge:${index}:model`, `Judge ${index + 1}: model route missing`));
    if (requiresVision) checks.push(model?.capabilities.supportsVision && model.capabilities.inputModalities.includes("image") ? pass(`judge:${index}:vision`, `Judge ${index + 1}: target image input is supported`) : fail(`judge:${index}:vision`, `Judge ${index + 1}: selected targets require image input support`));
  }
  checks.push(pass("secrets", "Judge/export design uses identifiers only; raw API keys are not part of Research config"));

  const sessionCount = config.targetIds.length * config.repetitions * config.conditions.length;
  const estimatedViewerCalls = sessionCount * 6;
  const estimatedJudgeCalls = sessionCount * config.judges.length;
  const estimatedCostUsd = estimateViewerCost(config, modelMap);
  if (estimatedCostUsd === undefined) checks.push(warn("cost", "Exact preflight cost is unavailable because one or more routes lack pricing metadata"));
  else checks.push(pass("cost", `Provider-derived rough Viewer estimate: $${estimatedCostUsd.toFixed(4)} (Judge cost depends on generated evidence length)`));
  return { ok: checks.every((check) => check.level !== "fail"), checks, estimatedCostUsd, estimatedViewerCalls, estimatedJudgeCalls };
}

function estimateViewerCost(config: ResearchConfig, models: Map<string, ProviderModel>): number | undefined {
  const protocol = getFullRcp(config.sessionLanguage);
  let total = 0;
  for (const condition of config.conditions) {
    const model = models.get(`${condition.providerConfigId}::${condition.modelId}`);
    if (!model?.pricing.promptPerToken || !model.pricing.completionPerToken) return undefined;
    const inputTokens = Math.ceil((protocol.content.length + (condition.systemPrompt?.content.length ?? 0)) / 3.5);
    const outputTokens = Math.min(condition.requestedSettings.maxOutputTokens ?? 2048, model.capabilities.maxOutputTokens ?? 2048);
    const sessions = config.targetIds.length * config.repetitions;
    total += sessions * 6 * ((inputTokens * model.pricing.promptPerToken) + (outputTokens * model.pricing.completionPerToken));
  }
  return Math.round(total * 1_000_000) / 1_000_000;
}

const pass = (id: string, message: string): PreflightCheck => ({ id, level: "pass", message });
const warn = (id: string, message: string): PreflightCheck => ({ id, level: "warning", message });
const fail = (id: string, message: string): PreflightCheck => ({ id, level: "fail", message });
