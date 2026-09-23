import { resolveGenerationSettings } from "../providers/capabilities";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import { buildEffectiveViewerPrompt, LOCKED_BASE_VOCABULARY_VERSION, LOCKED_IDENTITY_VERSION } from "../resources/systemPrompts";
import type { TargetRecord, TargetUsageRecord } from "../targets/types";
import { targetHasSupportedReveal } from "../targets/service";
import type { Profile } from "../types";
import type { PreflightCheck, ResearchConfig, ResearchPreflightResult } from "./types";
import { modelRouteKey } from "../modelRoutes";
import { activeViewerNotesControlSignature, sameFrozenViewerNotesVersion, viewerNotesSnapshotSignature } from "./viewerNotesPolicy";
import { fieldGuideSnapshotSignature } from "./fieldGuidePolicy";
import { researchProtocolLabel, researchProtocolViewerCalls, resolveResearchProtocol, type ResearchProtocolResource } from "./protocolPolicy";

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
  const modelMap = new Map(inventory.models.map((model) => [modelRouteKey(model.providerConfigId, model.modelId), model]));
  let protocol: ResearchProtocolResource | undefined;
  try {
    protocol = resolveResearchProtocol(config.protocol, config.sessionLanguage);
    checks.push(pass("protocol", `${researchProtocolLabel(config.protocol)} is available and frozen for this Research project`));
  } catch (cause) {
    checks.push(fail("protocol", cause instanceof Error ? cause.message : String(cause)));
  }

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
  const systemPromptHashes = new Set<string>();
  const systemPromptContents = new Set<string>();
  const conditionInstructionHashes = new Set<string>();
  const conditionInstructionContents = new Set<string>();
  const profileIds = new Set(config.conditions.map((condition) => condition.profileId));
  const providerIds = new Set(config.conditions.map((condition) => condition.providerConfigId));
  const modelIds = new Set(config.conditions.map((condition) => condition.modelId));
  const reasoningValues = new Set(config.conditions.map((condition) => condition.requestedSettings.reasoningEffort ?? "__provider_default__"));
  const temperatureValues = new Set(config.conditions.map((condition) => condition.requestedSettings.temperature ?? "__provider_default__"));
  const outputValues = new Set(config.conditions.map((condition) => condition.requestedSettings.maxOutputTokens ?? "__provider_default__"));
  const viewerNotesControls = new Set(config.conditions.map((condition) => activeViewerNotesControlSignature(condition.viewerNotes)));
  const fieldGuideControls = new Set(config.conditions.map((condition) => fieldGuideSnapshotSignature(condition.fieldGuide)));
  const comparedViewerIdentities = new Set(config.conditions.map((condition) => `${condition.profileId}\u0000${condition.providerConfigId}\u0000${condition.modelId}`));
  const identityVariesByDesign = (config.templateType === "profile" || config.templateType === "model")
    && comparedViewerIdentities.size === config.conditions.length;
  for (const condition of config.conditions) {
    const profile = profileMap.get(condition.profileId);
    const provider = providerMap.get(condition.providerConfigId);
    const model = modelMap.get(modelRouteKey(condition.providerConfigId, condition.modelId));
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
    if (config.sessionPolicy?.maxSessionCostUsd && config.sessionPolicy.maxSessionCostUsd > 0) {
      const hasPricing = model.pricing.promptPerToken !== undefined && model.pricing.completionPerToken !== undefined;
      checks.push(hasPricing
        ? pass(`${prefix}:hard_cost`, `${condition.label}: cached pricing supports hard session cost enforcement`)
        : fail(`${prefix}:hard_cost`, `${condition.label}: hard session cost limit requires cached input/output pricing`));
    }
    const effective = resolveGenerationSettings(model.capabilities, condition.requestedSettings);
    checks.push(effective.omitted.length ? fail(`${prefix}:settings`, `${condition.label}: unsupported setting(s): ${effective.omitted.join(", ")}`) : pass(`${prefix}:settings`, `${condition.label}: requested settings are supported`));
    checks.push(condition.capabilitySnapshot && condition.effectiveSettings ? pass(`${prefix}:snapshot`, `${condition.label}: capability + requested/effective settings snapshot is present`) : fail(`${prefix}:snapshot`, `${condition.label}: Research capability snapshot is missing`));
    const signature = JSON.stringify(effective.effective);
    effectiveSignatures.set(signature, [...(effectiveSignatures.get(signature) ?? []), condition.key]);
    if (condition.systemPrompt?.contentSha256) systemPromptHashes.add(condition.systemPrompt.contentSha256);
    if (condition.systemPrompt?.content.trim()) systemPromptContents.add(condition.systemPrompt.content.trim());
    if (condition.conditionInstruction?.contentSha256) conditionInstructionHashes.add(condition.conditionInstruction.contentSha256);
    if (condition.conditionInstruction?.content.trim()) conditionInstructionContents.add(condition.conditionInstruction.content.trim());

    if (protocol) {
      const roughInputTokens = Math.ceil((protocol.content.length + (condition.systemPrompt?.content.length ?? 0) + (condition.viewerNotes?.content.length ?? 0) + (condition.conditionInstruction?.content.length ?? 0)) / 3.5);
      if (model.capabilities.contextTokens && roughInputTokens >= model.capabilities.contextTokens) checks.push(fail(`${prefix}:context`, `${condition.label}: estimated protocol context exceeds the advertised context window`));
      else if (model.capabilities.contextTokens) checks.push(pass(`${prefix}:context`, `${condition.label}: advertised context window is sufficient for protocol preflight`));
      else checks.push(warn(`${prefix}:context`, `${condition.label}: provider did not advertise a context limit`));
    }
  }
  if ((config.templateType === "reasoning" || config.templateType === "temperature") && [...effectiveSignatures.values()].some((keys) => keys.length > 1)) {
    checks.push(fail("condition_distinguishability", "Two or more tested conditions resolve to the same effective generation settings"));
  } else {
    checks.push(pass("condition_distinguishability", "Tested conditions remain distinguishable at the known capability layer"));
  }
  const confoundedControls: string[] = [];
  if (config.templateType !== "profile" && profileIds.size !== 1) confoundedControls.push("Profile/API identity");
  if (config.templateType !== "profile" && providerIds.size !== 1) confoundedControls.push("provider connection");
  if (config.templateType !== "model" && modelIds.size !== 1) confoundedControls.push("Viewer model");
  if (config.templateType !== "reasoning" && reasoningValues.size !== 1) confoundedControls.push("reasoning");
  if (config.templateType !== "temperature" && temperatureValues.size !== 1) confoundedControls.push("temperature");
  if (outputValues.size !== 1) confoundedControls.push("maximum output tokens");
  if (config.templateType !== "viewer_notes" && viewerNotesControls.size !== 1) confoundedControls.push("Viewer Notes");
  const fieldGuideIsTestedVariable = config.templateType === "system_prompt" && config.promptResearchSource === "field_guide_history";
  if (!fieldGuideIsTestedVariable && !identityVariesByDesign && fieldGuideControls.size !== 1) confoundedControls.push("Field Guide");
  checks.push(confoundedControls.length
    ? fail("controlled_variables", `More than one research variable changes: ${confoundedControls.join(", ")}`)
    : pass("controlled_variables", "All non-tested Viewer controls are identical across conditions"));

  if (config.viewerControl) {
    const lockIssues: string[] = [];
    const expectedModelMode = config.templateType === "model" ? "condition_variable" : "fixed";
    const expectedPromptMode = config.templateType === "system_prompt" ? "condition_variable" : "fixed";
    const expectedReasoningMode = config.templateType === "reasoning" ? "condition_variable" : config.viewerControl.reasoning.value ? "fixed" : "provider_default";
    const expectedTemperatureMode = config.templateType === "temperature" ? "condition_variable" : config.viewerControl.temperature.value !== undefined ? "fixed" : "provider_default";
    if (config.viewerControl.model.mode !== expectedModelMode) lockIssues.push("model mode");
    if (config.viewerControl.systemPrompt.mode !== expectedPromptMode) lockIssues.push("System Prompt mode");
    if (config.viewerControl.reasoning.mode !== expectedReasoningMode) lockIssues.push("reasoning mode");
    if (config.viewerControl.temperature.mode !== expectedTemperatureMode) lockIssues.push("temperature mode");
    if (config.viewerControl.model.mode === "fixed" && (modelIds.size !== 1 || !modelIds.has(config.viewerControl.model.modelId ?? ""))) lockIssues.push("fixed model");
    if (config.viewerControl.systemPrompt.mode === "fixed") {
      const perIdentityFieldGuidePrompt = identityVariesByDesign && config.viewerControl.systemPrompt.source === "field_guide_current";
      if (!perIdentityFieldGuidePrompt && (systemPromptHashes.size !== 1 || !systemPromptHashes.has(config.viewerControl.systemPrompt.contentSha256 ?? ""))) lockIssues.push("fixed Viewer prompt hash");
    }
    if (config.viewerControl.reasoning.mode === "fixed" && (!config.viewerControl.reasoning.value || reasoningValues.size !== 1 || !reasoningValues.has(config.viewerControl.reasoning.value))) lockIssues.push("fixed reasoning");
    if (config.viewerControl.reasoning.mode === "provider_default" && !reasoningValues.has("__provider_default__")) lockIssues.push("provider-default reasoning");
    if (config.viewerControl.temperature.mode === "fixed" && (temperatureValues.size !== 1 || !temperatureValues.has(config.viewerControl.temperature.value ?? Number.NaN))) lockIssues.push("fixed temperature");
    if (config.viewerControl.temperature.mode === "provider_default" && !temperatureValues.has("__provider_default__")) lockIssues.push("provider-default temperature");
    if (outputValues.size !== 1 || !outputValues.has(config.viewerControl.maxOutputTokens)) lockIssues.push("maximum output tokens");
    checks.push(lockIssues.length
      ? fail("viewer_control_lock", `Study-wide Viewer control does not match its conditions: ${lockIssues.join(", ")}`)
      : pass("viewer_control_lock", "Study-wide Viewer model, prompt and generation controls are captured in Experiment Lock"));
  } else {
    checks.push(warn("viewer_control_lock", "Legacy Research configuration has no explicit study-wide Viewer-control record"));
  }
  if (config.templateType === "system_prompt") {
    const isFieldGuideHistory = config.promptResearchSource === "field_guide_history";
    checks.push(systemPromptHashes.size === config.conditions.length && systemPromptContents.size === config.conditions.length && config.conditions.every((condition) => Boolean(condition.systemPrompt?.content.trim()))
      ? pass("system_prompt_design", isFieldGuideHistory
        ? "Every selected Field Guide version produces a distinct frozen Viewer prompt composition while locked blocks remain fixed"
        : "Every tested manual Research prompt has a distinct frozen content hash")
      : fail("system_prompt_design", isFieldGuideHistory
        ? "Field Guide history comparison requires a distinct frozen Viewer prompt composition for every selected version"
        : "Manual Prompt Research requires a distinct frozen prompt for every condition"));
  } else {
    const perIdentityFieldGuidePrompt = identityVariesByDesign && config.fieldGuideControl?.mode === "current";
    const promptControlValid = perIdentityFieldGuidePrompt
      ? config.conditions.every((condition) => Boolean(condition.systemPrompt?.content.trim()) && Boolean(condition.fieldGuide))
      : systemPromptHashes.size === 1 && systemPromptContents.size === 1 && config.conditions.every((condition) => Boolean(condition.systemPrompt?.content.trim()));
    checks.push(promptControlValid
      ? pass("system_prompt_constant", perIdentityFieldGuidePrompt ? "Each compared Viewer identity uses its own frozen current Field Guide with the same locked Core Identity and Base Vocabulary versions" : "One identical Viewer prompt composition is frozen across all conditions")
      : fail("system_prompt_constant", "A controlled frozen Viewer prompt composition is required across every Research condition"));
    if (config.templateType === "custom") {
      checks.push(conditionInstructionHashes.size === config.conditions.length && conditionInstructionContents.size === config.conditions.length && config.conditions.every((condition) => Boolean(condition.conditionInstruction?.content.trim()))
        ? pass("custom_condition_design", "Every Custom Variable condition has a distinct frozen instruction")
        : fail("custom_condition_design", "Custom Variable requires a distinct frozen instruction for every condition"));
    }
  }

  if (config.templateType === "viewer_notes") {
    const without = config.conditions.find((condition) => condition.key === "no_notes");
    const frozen = config.conditions.find((condition) => condition.key === "frozen_notes");
    const designIsValid = config.conditions.length === 2
      && without?.viewerNotes?.enabled === false
      && without.viewerNotes.content === ""
      && without.viewerNotes.estimatedTokens === 0
      && frozen?.viewerNotes?.enabled === true
      && Boolean(frozen.viewerNotes.versionId)
      && frozen.viewerNotes.versionNumber !== undefined
      && Boolean(frozen.viewerNotes.content.trim())
      && Boolean(frozen.viewerNotes.contentSha256)
      && sameFrozenViewerNotesVersion(frozen.viewerNotes, without.viewerNotes);
    checks.push(designIsValid
      ? pass("viewer_notes_design", "No Notes and the same immutable current Viewer Notes snapshot are locked for one exact Viewer identity")
      : fail("viewer_notes_design", "Viewer Notes Impact requires exactly No Notes versus one non-empty frozen current snapshot for the same Viewer identity"));
  } else {
    const activeSnapshots = config.conditions.map((condition) => condition.viewerNotes).filter((snapshot) => snapshot?.enabled);
    if (!activeSnapshots.length) {
      checks.push(config.conditions.every((condition) => !condition.viewerNotes?.enabled)
        ? pass("viewer_notes_control", "Viewer Notes are disabled consistently across every condition")
        : fail("viewer_notes_control", "Viewer Notes disabled mode must not contain an active snapshot"));
    } else {
      const signatures = new Set(activeSnapshots.map((snapshot) => viewerNotesSnapshotSignature(snapshot)));
      const snapshotsAreComplete = activeSnapshots.length === config.conditions.length
        && activeSnapshots.every((snapshot) => Boolean(snapshot?.versionId) && snapshot?.versionNumber !== undefined && Boolean(snapshot?.content.trim()) && Boolean(snapshot?.contentSha256));
      const snapshotsMatchRoutes = config.conditions.every((condition) => {
        const route = modelMap.get(modelRouteKey(condition.providerConfigId, condition.modelId))?.route;
        return Boolean(route && condition.viewerNotes?.modelRoute === route);
      });
      const validViewerNotesControl = snapshotsAreComplete
        && (identityVariesByDesign ? snapshotsMatchRoutes : signatures.size === 1);
      checks.push(validViewerNotesControl
        ? pass("viewer_notes_control", identityVariesByDesign
          ? "Each compared Viewer identity uses its own non-empty current Viewer Notes snapshot"
          : "One identical non-empty Viewer Notes snapshot is frozen across every condition")
        : fail("viewer_notes_control", identityVariesByDesign
          ? "Every compared Viewer identity must use its own non-empty current Viewer Notes snapshot"
          : "Viewer Notes must be either disabled everywhere or use one identical non-empty frozen snapshot in every condition"));
    }
  }
  if (config.viewerNotesControl) {
    const expectedViewerNotesMode = config.templateType === "viewer_notes"
      ? "experiment"
      : config.conditions.some((condition) => condition.viewerNotes?.enabled) ? "current" : "off";
    checks.push(config.viewerNotesControl.mode === expectedViewerNotesMode
      ? pass("viewer_notes_mode_lock", `Viewer Notes mode ${config.viewerNotesControl.mode.toUpperCase()} is frozen consistently with the Research conditions`)
      : fail("viewer_notes_mode_lock", "Frozen Viewer Notes mode does not match the Research condition snapshots"));
  } else {
    checks.push(warn("viewer_notes_mode_lock", "Legacy Research configuration has no explicit Viewer Notes mode record"));
  }

  if (config.fieldGuideControl) {
    const sourceMatchesMode = (config.fieldGuideControl.mode === "off" && config.fieldGuideControl.source === "none")
      || (config.fieldGuideControl.mode === "current" && config.fieldGuideControl.source === "active")
      || (config.fieldGuideControl.mode === "history" && config.fieldGuideControl.source === "history");
    const lockedVersionsValid = config.fieldGuideControl.lockedCoreIdentityVersion === LOCKED_IDENTITY_VERSION
      && config.fieldGuideControl.lockedBaseVocabularyVersion === LOCKED_BASE_VOCABULARY_VERSION
      && config.fieldGuideControl.language === config.sessionLanguage
      && sourceMatchesMode;
    checks.push(lockedVersionsValid
      ? pass("field_guide_locked_blocks", "Locked Core Identity and Locked Base Vocabulary versions are frozen with the Research config")
      : fail("field_guide_locked_blocks", "Research Field Guide control must freeze the current locked Core Identity, Base Vocabulary and session language"));

    const lockedPrefix = buildEffectiveViewerPrompt(config.sessionLanguage, "");
    const promptsKeepLockedBlocks = config.conditions.every((condition) => condition.systemPrompt?.content.startsWith(lockedPrefix));
    const manualPromptExperiment = config.templateType === "system_prompt" && config.promptResearchSource === "manual";
    if (config.fieldGuideControl.mode === "off") {
      const validOff = config.conditions.every((condition) => !condition.fieldGuide) && (manualPromptExperiment || promptsKeepLockedBlocks);
      checks.push(validOff
        ? pass("field_guide_control", manualPromptExperiment
          ? "Manual Prompt Research remains a standalone experimental prompt source and does not create a Field Guide version"
          : "Trained Field Guide is OFF while locked Viewer blocks remain present")
        : fail("field_guide_control", "Field Guide OFF must remove only the trainable Field Guide and preserve locked Viewer blocks outside standalone Manual Prompt Research"));
    } else {
      const snapshots = config.conditions.map((condition) => condition.fieldGuide);
      const complete = config.conditions.every((condition) => {
        const snapshot = condition.fieldGuide;
        const route = modelMap.get(modelRouteKey(condition.providerConfigId, condition.modelId))?.route;
        return Boolean(snapshot?.versionId
          && snapshot.contentSha256
          && snapshot.content.trim()
          && snapshot.language === config.sessionLanguage
          && snapshot.identity.aiIdentityId === snapshot.aiIdentityId
          && snapshot.identity.profileId === condition.profileId
          && snapshot.identity.providerConfigId === condition.providerConfigId
          && snapshot.identity.modelId === condition.modelId
          && snapshot.identity.modelRoute === snapshot.modelRoute
          && snapshot.modelRoute === route
          && [2048, 4096, 8192].includes(snapshot.capacityTokens)
          && [2048, 4096, 8192].includes(snapshot.capacityTokensAtCreation)
          && snapshot.sourceSnapshot.schemaVersion === 1);
      });
      const promptsMatchSnapshots = config.conditions.every((condition) => condition.fieldGuide
        && condition.systemPrompt?.fieldGuide?.versionId === condition.fieldGuide.versionId
        && condition.systemPrompt.fieldGuide.contentSha256 === condition.fieldGuide.contentSha256
        && condition.systemPrompt.content === buildEffectiveViewerPrompt(config.sessionLanguage, condition.fieldGuide.content)
        && (condition.promptSource === "active_field_guide" || condition.promptSource === "historical_field_guide"));
      if (config.fieldGuideControl.mode === "history") {
        const selected = config.fieldGuideControl.selectedVersionIds ?? [];
        const identities = new Set(snapshots.map((snapshot) => snapshot?.aiIdentityId));
        const languages = new Set(snapshots.map((snapshot) => snapshot?.language));
        const versionIds = new Set(snapshots.map((snapshot) => snapshot?.versionId));
        const historyValid = config.templateType === "system_prompt"
          && config.promptResearchSource === "field_guide_history"
          && config.conditions.length >= 2 && config.conditions.length <= 4
          && selected.length === config.conditions.length && new Set(selected).size === selected.length
          && versionIds.size === config.conditions.length
          && selected.every((id) => versionIds.has(id))
          && identities.size === 1 && identities.has(config.fieldGuideControl.identityId)
          && languages.size === 1 && languages.has(config.sessionLanguage)
          && complete && promptsMatchSnapshots && promptsKeepLockedBlocks;
        checks.push(historyValid
          ? pass("field_guide_history_design", "2–4 manually selected historical Field Guide snapshots are frozen; only the trainable Field Guide version changes")
          : fail("field_guide_history_design", "Field Guide history comparison requires 2–4 selected versions from one exact Viewer identity/language with matching frozen snapshots"));
      } else {
        const validCurrent = complete && promptsMatchSnapshots && promptsKeepLockedBlocks
          && (identityVariesByDesign ? config.conditions.every((condition) => condition.fieldGuide?.modelRoute === modelMap.get(modelRouteKey(condition.providerConfigId, condition.modelId))?.route) : fieldGuideControls.size === 1);
        checks.push(validCurrent
          ? pass("field_guide_control", identityVariesByDesign ? "Each compared Viewer identity has its own frozen active Field Guide snapshot" : "One exact active Field Guide snapshot is frozen across every condition")
          : fail("field_guide_control", "Current Field Guide mode requires complete frozen snapshots that match the locked Viewer route"));
      }
    }
    checks.push(pass("field_guide_feedback", "Research uses Field Guide snapshots read-only and never creates or updates a Field Guide version"));
  } else {
    checks.push(warn("field_guide_control", "Legacy Research configuration has no explicit Field Guide control; historical behavior is preserved"));
  }

  checks.push(pass("viewer_notes_feedback", "Research uses Viewer Notes read-only; Research sessions never update Viewer Notes"));

  if (config.judges.length === 0) {
    checks.push(config.evaluationMode === "save_only"
      ? pass("judge_mode", "Save-only mode: no AI Judge calls; anonymous evidence can be exported for external evaluation")
      : fail("judge_mode", "No Judge route is configured and Save-only mode is not explicit"));
  }
  for (let index = 0; index < config.judges.length; index += 1) {
    const judge = config.judges[index];
    const provider = providerMap.get(judge.providerConfigId);
    const model = modelMap.get(modelRouteKey(judge.providerConfigId, judge.modelId));
    checks.push(provider?.lastStatus === "ok" ? pass(`judge:${index}:provider`, `Judge ${index + 1}: provider connection tested`) : fail(`judge:${index}:provider`, `Judge ${index + 1}: provider connection must be tested`));
    checks.push(model ? pass(`judge:${index}:model`, `Judge ${index + 1}: model route found`) : fail(`judge:${index}:model`, `Judge ${index + 1}: model route missing`));
    if (requiresVision) checks.push(model?.capabilities.supportsVision && model.capabilities.inputModalities.includes("image") ? pass(`judge:${index}:vision`, `Judge ${index + 1}: target image input is supported`) : fail(`judge:${index}:vision`, `Judge ${index + 1}: selected targets require image input support`));
  }
  checks.push(pass("secrets", "Judge/export design uses identifiers only; raw API keys are not part of Research config"));

  const sessionCount = config.targetIds.length * config.repetitions * config.conditions.length;
  const estimatedViewerCalls = sessionCount * researchProtocolViewerCalls(config.protocol);
  const estimatedJudgeCalls = sessionCount * config.judges.length;
  const estimatedCostUsd = estimateViewerCost(config, modelMap);
  if (estimatedCostUsd === undefined) checks.push(warn("cost", "Exact preflight cost is unavailable because one or more routes lack pricing metadata"));
  else checks.push(pass("cost", `Provider-derived rough Viewer estimate: $${estimatedCostUsd.toFixed(4)} (Judge cost depends on generated evidence length)`));
  return { ok: checks.every((check) => check.level !== "fail"), checks, estimatedCostUsd, estimatedViewerCalls, estimatedJudgeCalls };
}

function estimateViewerCost(config: ResearchConfig, models: Map<string, ProviderModel>): number | undefined {
  let protocol: ResearchProtocolResource;
  try {
    protocol = resolveResearchProtocol(config.protocol, config.sessionLanguage);
  } catch {
    return undefined;
  }
  const viewerCalls = researchProtocolViewerCalls(config.protocol);
  let total = 0;
  for (const condition of config.conditions) {
    const model = models.get(modelRouteKey(condition.providerConfigId, condition.modelId));
    if (model?.pricing.promptPerToken === undefined || model.pricing.completionPerToken === undefined) return undefined;
    const inputTokens = Math.ceil((protocol.content.length + (condition.systemPrompt?.content.length ?? 0) + (condition.viewerNotes?.content.length ?? 0) + (condition.conditionInstruction?.content.length ?? 0)) / 3.5);
    const outputTokens = Math.min(condition.requestedSettings.maxOutputTokens ?? 2048, model.capabilities.maxOutputTokens ?? 2048);
    const sessions = config.targetIds.length * config.repetitions;
    total += sessions * viewerCalls * ((inputTokens * model.pricing.promptPerToken) + (outputTokens * model.pricing.completionPerToken));
  }
  return Math.round(total * 1_000_000) / 1_000_000;
}

const pass = (id: string, message: string): PreflightCheck => ({ id, level: "pass", message });
const warn = (id: string, message: string): PreflightCheck => ({ id, level: "warning", message });
const fail = (id: string, message: string): PreflightCheck => ({ id, level: "fail", message });
