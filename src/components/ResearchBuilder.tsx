import { Check, ChevronRight, CircleStop, FlaskConical, LockKeyhole, Play, RotateCcw, Search, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { getCopy } from "../i18n";
import type { ProviderConfig, ProviderModel, ReasoningEffort } from "../providers/types";
import type { JudgeScoreRecord } from "../judge/types";
import { resolveGenerationSettings } from "../providers/capabilities";
import { createAndLockResearch, executeResearchSessions, judgeResearch, prepareInterruptedResearchRetry, unblindAndComputeResearch } from "../research/engine";
import { stableStringify } from "../research/planner";
import { runResearchPreflight, type ResearchPreflightInventory } from "../research/preflight";
import type { ResearchAssignmentRecord, ResearchConditionDefinition, ResearchConfig, ResearchPreflightResult, ResearchProjectRecord, ResearchResults, ResearchTemplateType, ResearchViewerControl } from "../research/types";
import { isTauriRuntime } from "../storage";
import type { AppRepository } from "../storage/repository";
import type { TargetRecord, TargetUsageRecord } from "../targets/types";
import { targetHasSupportedReveal } from "../targets/service";
import { localizedTargetTitle } from "../targets/localization";
import type { AppSettings, InterfaceLanguage, Profile, Workspace } from "../types";
import { resolveSessionLanguage } from "../domain/localization";
import { exportResearchPackage } from "../exports/research";
import { sampleResearchTargetIds, type ResearchTargetSelectionMode, type ResearchTargetSource } from "../research/targetSelection";
import { customSystemPromptSnapshot, profileGenerationDefaults, profileSystemPromptSnapshot } from "../profileViewerDefaults";
import { sharedResearchCapabilities, type SharedResearchCapabilities } from "../research/studyControls";
import { reasoningOptions } from "../providers/modelReasoningRegistry";
import { chooseDirectory } from "../storage/native";
import { SessionInspection } from "./SessionInspection";

type Copy = ReturnType<typeof getCopy>;

function researchReasoningLabel(copy: Copy, model: ProviderModel | null, effort: ReasoningEffort): string {
  const option = model ? reasoningOptions(model.capabilities.reasoning).find((item) => item.value === effort) : undefined;
  if (!option) return effort.toUpperCase();
  return option.verification === "unverified" ? `${option.label} · ${copy.unverified}` : option.label;
}

const TEMPLATE_ORDER: ResearchTemplateType[] = ["reasoning", "temperature", "profile", "model", "practice", "system_prompt", "custom"];

export function ResearchBuilder({ copy, settings, profiles, workspaces, repository }: { copy: Copy; settings: AppSettings; profiles: Profile[]; workspaces: Workspace[]; repository: AppRepository | null }) {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [targets, setTargets] = useState<TargetRecord[]>([]);
  const [usage, setUsage] = useState<TargetUsageRecord[]>([]);
  const [projects, setProjects] = useState<ResearchProjectRecord[]>([]);
  const [template, setTemplate] = useState<ResearchTemplateType | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    if (!repository) return;
    const [nextProviders, nextModels, nextTargets, nextUsage, nextProjects] = await Promise.all([
      repository.listProviderConfigs(), repository.listProviderModels(), repository.listTargets(), repository.listTargetUsage(), repository.listResearchProjects(),
    ]);
    setProviders(nextProviders); setModels(nextModels); setTargets(nextTargets); setUsage(nextUsage); setProjects(nextProjects);
  };

  useEffect(() => {
    let cancelled = false;
    if (!repository) { setLoading(false); return; }
    void refresh().finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [repository]);

  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  if (loading) return <div className="research-builder-loading">…</div>;
  if (activeProject && repository) return <ResearchProjectView copy={copy} repository={repository} project={activeProject} onRefresh={refresh} onBack={() => setActiveProjectId(null)} />;
  if (template && repository) return <ResearchConfigBuilder copy={copy} settings={settings} repository={repository} profiles={profiles} workspaces={workspaces} providers={providers} models={models} targets={targets} usage={usage} template={template} onBack={() => setTemplate(null)} onLocked={async (project) => { await refresh(); setTemplate(null); setActiveProjectId(project.id); }} />;

  return <div className="research-hub">
    <section className="panel research-projects-panel"><div className="research-section-head"><div><strong>{copy.existingResearch}</strong><small>{projects.length}</small></div></div>{projects.length ? <div className="research-project-list">{projects.map((project) => <button key={project.id} onClick={() => setActiveProjectId(project.id)}><span><strong>{project.name}</strong><small>{templateName(copy, project.templateType)} · {project.state}</small></span><ChevronRight size={15} /></button>)}</div> : <p className="research-empty">{copy.noResearchProjects}</p>}</section>
    <div className="template-grid">{TEMPLATE_ORDER.map((type, index) => <button className="template-card research-template-button" key={type} onClick={() => setTemplate(type)}><span className="template-number">{String(index + 1).padStart(2, "0")}</span><FlaskConical size={22} /><h3>{templateName(copy, type)}</h3><p>{templateMeta(copy, type)}</p><span className="status-chip ready"><Check size={12} />{copy.newResearch}</span></button>)}</div>
  </div>;
}

function ResearchConfigBuilder({ copy, settings, repository, profiles, workspaces, providers, models, targets, usage, template, onBack, onLocked }: { copy: Copy; settings: AppSettings; repository: AppRepository; profiles: Profile[]; workspaces: Workspace[]; providers: ProviderConfig[]; models: ProviderModel[]; targets: TargetRecord[]; usage: TargetUsageRecord[]; template: ResearchTemplateType; onBack: () => void; onLocked: (project: ResearchProjectRecord) => Promise<void> }) {
  const [name, setName] = useState(`${templateName(copy, template)} · ${new Date().toLocaleDateString()}`);
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const [language, setLanguage] = useState<InterfaceLanguage>(resolveSessionLanguage(settings.interfaceLanguage, settings.sessionLanguage));
  const [baseModelKey, setBaseModelKey] = useState("");
  const [fixedReasoning, setFixedReasoning] = useState<"" | ReasoningEffort>("");
  const [fixedTemperature, setFixedTemperature] = useState("");
  const [researchMaxOutputTokens, setResearchMaxOutputTokens] = useState(String(settings.defaultMaxOutputTokens));
  const [reasoningLevels, setReasoningLevels] = useState<ReasoningEffort[]>([]);
  const [temperatureValues, setTemperatureValues] = useState("0.7, 1.1, 1.5");
  const [profileIds, setProfileIds] = useState<string[]>([]);
  const [modelKeys, setModelKeys] = useState<string[]>([]);
  const [variants, setVariants] = useState(["", ""]);
  const [systemPromptSource, setSystemPromptSource] = useState<"profile" | "custom">("profile");
  const [customResearchSystemPrompt, setCustomResearchSystemPrompt] = useState("");
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [targetSource, setTargetSource] = useState<ResearchTargetSource>("training");
  const [targetSelectionMode, setTargetSelectionMode] = useState<ResearchTargetSelectionMode>("random");
  const [targetSearch, setTargetSearch] = useState("");
  const [randomTargetCount, setRandomTargetCount] = useState(6);
  const [repetitions, setRepetitions] = useState(1);
  const [unusedOnly, setUnusedOnly] = useState(true);
  const [evaluationMode, setEvaluationMode] = useState<"save_only" | "ai_judges">("save_only");
  const [judgeCount, setJudgeCount] = useState(1);
  const [judgeKeys, setJudgeKeys] = useState(["", "", ""]);
  const [preflight, setPreflight] = useState<ResearchPreflightResult | null>(null);
  const [preflightConfig, setPreflightConfig] = useState<ResearchConfig | null>(null);
  const [dryRun, setDryRun] = useState<ResearchConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workspace = workspaces.find((item) => item.id === workspaceId) ?? null;
  const baseProfile = profiles.find((profile) => profile.id === workspace?.profileId) ?? null;
  const baseProvider = providers.find((provider) => provider.credentialId === baseProfile?.credentialId) ?? null;
  const baseModels = models.filter((model) => model.providerConfigId === baseProvider?.id);
  const baseModel = baseModels.find((model) => modelKey(model) === baseModelKey) ?? null;
  const profileComparisonModels = template === "profile" ? profileIds.flatMap((profileId) => {
    const profile = profiles.find((item) => item.id === profileId);
    const provider = providers.find((item) => item.credentialId === profile?.credentialId);
    const matched = models.find((item) => item.providerConfigId === provider?.id && item.modelId === baseModel?.modelId);
    return matched ? [matched] : [];
  }) : [];
  const modelComparisonModels = template === "model" ? modelKeys.flatMap((key) => {
    const selected = models.find((item) => modelKey(item) === key && item.providerConfigId === baseProvider?.id);
    return selected ? [selected] : [];
  }) : [];
  const controlModels = template === "profile" && profileComparisonModels.length
    ? profileComparisonModels
    : template === "model" && modelComparisonModels.length
      ? modelComparisonModels
      : baseModel ? [baseModel] : [];
  const sharedCapabilities = sharedResearchCapabilities(controlModels);
  const participatingProfileIds = new Set(template === "profile" ? profileIds : baseProfile ? [baseProfile.id] : []);
  const usedByParticipants = new Set(usage.filter((item) => !item.profileId || participatingProfileIds.has(item.profileId)).map((item) => item.targetId));
  const eligibleTargets = targets
    .filter(targetHasSupportedReveal)
    .filter((target) => targetSource === "all" || target.collection === targetSource)
    .filter((target) => !unusedOnly || !usedByParticipants.has(target.id));
  const targetPoolSignature = eligibleTargets.map((target) => target.id).sort().join("|");
  const normalizedSearch = targetSearch.trim().toLowerCase();
  const visibleManualTargets = normalizedSearch
    ? eligibleTargets.filter((target) => `${localizedTargetTitle(target, settings.interfaceLanguage)} ${target.tags.join(" ")}`.toLowerCase().includes(normalizedSearch))
    : eligibleTargets;

  useEffect(() => {
    if (!baseModels.some((model) => modelKey(model) === baseModelKey)) {
      const preferred = baseModels.find((model) => model.modelId === baseProfile?.defaultViewerModelId) ?? baseModels[0];
      setBaseModelKey(preferred ? modelKey(preferred) : "");
    }
  }, [workspaceId, baseProvider?.id, baseProfile?.defaultViewerModelId, baseModels.length]);
  useEffect(() => {
    const defaults = profileGenerationDefaults(baseProfile, baseModel);
    setFixedReasoning(defaults.reasoningEffort ?? "");
    setFixedTemperature(defaults.temperature === undefined ? "" : String(defaults.temperature));
    setResearchMaxOutputTokens(String(Math.min(baseModel?.capabilities.maxOutputTokens ?? settings.defaultMaxOutputTokens, settings.defaultMaxOutputTokens)));
    setReasoningLevels([]); setProfileIds(baseProfile ? [baseProfile.id] : []); setModelKeys([]); setPreflight(null); setPreflightConfig(null); setDryRun(null);
  }, [template, baseModelKey, baseProfile?.id, baseProfile?.defaultViewerReasoningEffort, baseProfile?.defaultViewerTemperature, settings.defaultMaxOutputTokens]);
  useEffect(() => {
    if (fixedReasoning && !sharedCapabilities.reasoningEfforts.includes(fixedReasoning)) setFixedReasoning("");
    if (!sharedCapabilities.temperatureSupported && fixedTemperature) setFixedTemperature("");
    if (fixedTemperature && sharedCapabilities.temperatureSupported) {
      const numeric = Number(fixedTemperature);
      if (!Number.isFinite(numeric)
        || (sharedCapabilities.temperatureMin !== undefined && numeric < sharedCapabilities.temperatureMin)
        || (sharedCapabilities.temperatureMax !== undefined && numeric > sharedCapabilities.temperatureMax)) setFixedTemperature("");
    }
    if (sharedCapabilities.maxOutputTokens) {
      setResearchMaxOutputTokens((current) => String(Math.min(Number(current) || settings.defaultMaxOutputTokens, sharedCapabilities.maxOutputTokens!)));
    }
    setPreflight(null); setPreflightConfig(null); setDryRun(null);
  }, [sharedCapabilities.reasoningEfforts.join("|"), sharedCapabilities.temperatureSupported, sharedCapabilities.temperatureMin, sharedCapabilities.temperatureMax, sharedCapabilities.maxOutputTokens]);
  useEffect(() => {
    setTargetIds([]); setPreflight(null); setPreflightConfig(null); setDryRun(null);
  }, [targetSelectionMode, targetSource, targetPoolSignature, randomTargetCount]);

  const inventory: ResearchPreflightInventory = { profiles, providerConfigs: providers, models, targets, targetUsage: usage };

  const buildConfig = async (): Promise<ResearchConfig> => {
    if (!workspace || !baseProfile || !baseProvider || !baseModel) throw new Error(copy.configureProviderFirst);
    const selectedTargetIds = targetSelectionMode === "random"
      ? targetIds.length === Math.min(randomTargetCount, eligibleTargets.length) && targetIds.every((id) => eligibleTargets.some((target) => target.id === id))
        ? targetIds
        : sampleResearchTargetIds(eligibleTargets, randomTargetCount)
      : targetIds;
    if (!selectedTargetIds.length) throw new Error(copy.researchTargets);
    if (targetSelectionMode === "random" && selectedTargetIds !== targetIds) setTargetIds(selectedTargetIds);
    const judges = evaluationMode === "save_only" ? [] : judgeKeys.slice(0, judgeCount).map((key) => {
      const model = models.find((item) => modelKey(item) === key);
      if (!model) throw new Error(copy.judgeRequiresModels);
      return { providerConfigId: model.providerConfigId, modelId: model.modelId };
    });
    const usesFixedSystemPrompt = template !== "system_prompt";
    const fixedSystemPrompt = !usesFixedSystemPrompt
      ? undefined
      : systemPromptSource === "profile"
        ? await profileSystemPromptSnapshot(baseProfile, language)
        : await customSystemPromptSnapshot(customResearchSystemPrompt, `research_fixed_prompt_${safeKey(name) || "untitled"}`, language);
    if (usesFixedSystemPrompt && !fixedSystemPrompt) throw new Error(copy.researchSystemPromptRequired);
    const maxOutputTokens = Number(researchMaxOutputTokens);
    if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || (sharedCapabilities.maxOutputTokens !== undefined && maxOutputTokens > sharedCapabilities.maxOutputTokens)) throw new Error(copy.researchOutputOutOfRange);
    if (template !== "reasoning" && fixedReasoning && !sharedCapabilities.reasoningEfforts.includes(fixedReasoning)) throw new Error(copy.researchReasoningUnavailable);
    const fixedTemperatureNumber = fixedTemperature.trim() ? Number(fixedTemperature) : undefined;
    if (template !== "temperature" && fixedTemperatureNumber !== undefined) {
      if (!sharedCapabilities.temperatureSupported
        || !Number.isFinite(fixedTemperatureNumber)
        || (sharedCapabilities.temperatureMin !== undefined && fixedTemperatureNumber < sharedCapabilities.temperatureMin)
        || (sharedCapabilities.temperatureMax !== undefined && fixedTemperatureNumber > sharedCapabilities.temperatureMax)) throw new Error(copy.researchTemperatureUnavailable);
    }
    const fixedRequestedSettings = {
      ...(template !== "reasoning" && fixedReasoning ? { reasoningEffort: fixedReasoning } : {}),
      ...(template !== "temperature" && fixedTemperatureNumber !== undefined ? { temperature: fixedTemperatureNumber } : {}),
      maxOutputTokens,
    };
    const base = (key: string, label: string, overrides: Partial<ResearchConditionDefinition> = {}): ResearchConditionDefinition => ({ key, label, profileId: baseProfile.id, providerConfigId: baseProvider.id, modelId: baseModel.modelId, requestedSettings: fixedRequestedSettings, ...(fixedSystemPrompt ? { systemPrompt: fixedSystemPrompt } : {}), ...overrides });
    let conditions: ResearchConditionDefinition[] = [];
    if (template === "reasoning") {
      conditions = reasoningLevels.map((effort) => base(`reasoning_${effort}`, researchReasoningLabel(copy, baseModel, effort), { requestedSettings: { ...fixedRequestedSettings, reasoningEffort: effort } }));
    } else if (template === "temperature") {
      const values = [...new Set(temperatureValues.split(",").map((value) => Number(value.trim())).filter(Number.isFinite))];
      conditions = values.map((temperature) => base(`temperature_${String(temperature).replace(".", "_")}`, `T=${temperature}`, { requestedSettings: { ...fixedRequestedSettings, temperature } }));
    } else if (template === "profile") {
      conditions = profileIds.flatMap((profileId) => {
        const profile = profiles.find((item) => item.id === profileId);
        const provider = providers.find((item) => item.credentialId === profile?.credentialId);
        const matchedModel = models.find((item) => item.providerConfigId === provider?.id && item.modelId === baseModel.modelId);
        if (!profile || !provider || !matchedModel) return [];
        return [base(`profile_${profile.id}`, profile.name || copy.unnamedProfile, { profileId: profile.id, providerConfigId: provider.id, modelId: matchedModel.modelId })];
      });
    } else if (template === "model") {
      conditions = modelKeys.flatMap((key) => {
        const selected = models.find((item) => modelKey(item) === key && item.providerConfigId === baseProvider.id);
        return selected ? [base(`model_${safeKey(selected.modelId)}`, selected.displayName, { modelId: selected.modelId })] : [];
      });
    } else if (template === "practice") {
      conditions = [base("first", "FIRST", { practiceOrder: "FIRST" }), base("second", "SECOND", { practiceOrder: "SECOND" })];
    } else if (template === "system_prompt") {
      const values = variants.map((value) => value.trim()).filter(Boolean).slice(0, 4);
      conditions = await Promise.all(values.map(async (content, index) => base(`prompt_${index + 1}`, `Prompt ${String.fromCharCode(65 + index)}`, { systemPrompt: { id: `research_prompt_${index + 1}`, version: "1", content, contentSha256: await sha256Text(content) } })));
    } else {
      const values = variants.map((value) => value.trim()).filter(Boolean).slice(0, 4);
      conditions = await Promise.all(values.map(async (content, index) => base(`custom_${index + 1}`, `Condition ${index + 1}`, { customValue: content, conditionInstruction: { id: `custom_condition_${index + 1}`, version: "1", content, contentSha256: await sha256Text(content) } })));
    }
    if (conditions.length < 2) throw new Error(copy.selectAtLeastTwo);
    conditions = conditions.map((condition) => {
      const conditionModel = models.find((item) => item.providerConfigId === condition.providerConfigId && item.modelId === condition.modelId);
      if (!conditionModel) return condition;
      return {
        ...condition,
        effectiveSettings: resolveGenerationSettings(conditionModel.capabilities, condition.requestedSettings),
        capabilitySnapshot: structuredClone(conditionModel.capabilities),
      };
    });
    const viewerControl: ResearchViewerControl = {
      model: template === "model" ? { mode: "condition_variable" } : { mode: "fixed", modelId: baseModel.modelId },
      systemPrompt: template === "system_prompt"
        ? { mode: "condition_variable" }
        : { mode: "fixed", source: systemPromptSource, contentSha256: fixedSystemPrompt!.contentSha256 },
      reasoning: template === "reasoning"
        ? { mode: "condition_variable" }
        : fixedReasoning ? { mode: "fixed", value: fixedReasoning } : { mode: "provider_default" },
      temperature: template === "temperature"
        ? { mode: "condition_variable" }
        : fixedTemperatureNumber !== undefined ? { mode: "fixed", value: fixedTemperatureNumber } : { mode: "provider_default" },
      maxOutputTokens,
    };
    return {
      schemaVersion: 1, name: name.trim(), workspaceId: workspace.id, templateType: template, sessionLanguage: language,
      protocol: { id: "full-rcp", version: "1.5a" }, targetIds: [...selectedTargetIds], targetSelection: { source: targetSource, mode: targetSelectionMode, ...(targetSelectionMode === "random" ? { requestedCount: randomTargetCount } : {}) }, repetitions, requireUnusedTargets: unusedOnly,
      sessionPolicy: { requestTimeoutMs: settings.requestTimeoutMs, maxRetries: settings.maxRetries, defaultMaxOutputTokens: settings.defaultMaxOutputTokens, maxSessionCostUsd: settings.maxSessionCostUsd, sessionCodePrefix: settings.sessionCodePrefix },
      viewerControl, conditions, evaluationMode, judges, randomization: { matchedTargets: true, randomizedExecution: true, randomizedJudgeOrder: true },
    };
  };

  const preview = async () => {
    setError(null);
    try { setDryRun(await buildConfig()); } catch (cause) { setError(message(cause)); }
  };
  const check = async () => {
    setError(null);
    try { const config = await buildConfig(); setPreflightConfig(config); setPreflight(runResearchPreflight(config, inventory)); } catch (cause) { setError(message(cause)); }
  };
  const lock = async () => {
    if (!preflight?.ok || !preflightConfig || busy) return;
    setBusy(true); setError(null);
    try {
      const current = await buildConfig();
      if (stableStringify(current) !== stableStringify(preflightConfig)) { setPreflightConfig(current); setPreflight(runResearchPreflight(current, inventory)); throw new Error("Configuration changed after Preflight. Review the refreshed Preflight before locking."); }
      const { project } = await createAndLockResearch(repository, current, inventory);
      await onLocked(project);
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  };
  const updateSelectedTargets = (next: string[]) => {
    setTargetIds(next); setPreflight(null); setPreflightConfig(null); setDryRun(null); setError(null);
  };

  return <div className="research-config-builder">
    <div className="research-builder-toolbar"><button className="secondary-button" onClick={onBack}>← {copy.research}</button><div><strong>{templateName(copy, template)}</strong><small>{copy.lockWarning}</small></div></div>
    <div className="research-builder-grid"><section className="panel research-form-panel"><FormRow label={copy.researchName}><input value={name} onChange={(event) => setName(event.target.value)} /></FormRow><FormRow label={copy.researchWorkspace}><select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}><option value="">—</option>{workspaces.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></FormRow><FormRow label={copy.sessionLanguage}><select value={language} onChange={(event) => setLanguage(event.target.value as InterfaceLanguage)}><option value="pl">Polski</option><option value="en">English</option></select></FormRow>
      <ResearchViewerSettings
        copy={copy}
        template={template}
        baseProfile={baseProfile}
        baseProvider={baseProvider}
        baseModels={baseModels}
        baseModelKey={baseModelKey}
        onBaseModelKey={(value) => { setBaseModelKey(value); setPreflight(null); setPreflightConfig(null); setDryRun(null); }}
        sharedCapabilities={sharedCapabilities}
        fixedReasoning={fixedReasoning}
        onFixedReasoning={(value) => { setFixedReasoning(value); setPreflight(null); setPreflightConfig(null); setDryRun(null); }}
        fixedTemperature={fixedTemperature}
        onFixedTemperature={(value) => { setFixedTemperature(value); setPreflight(null); setPreflightConfig(null); setDryRun(null); }}
        maxOutputTokens={researchMaxOutputTokens}
        onMaxOutputTokens={(value) => { setResearchMaxOutputTokens(value); setPreflight(null); setPreflightConfig(null); setDryRun(null); }}
        systemPromptSource={systemPromptSource}
        onSystemPromptSource={(value) => { setSystemPromptSource(value); setPreflight(null); setPreflightConfig(null); setDryRun(null); }}
        customSystemPrompt={customResearchSystemPrompt}
        onCustomSystemPrompt={(value) => { setCustomResearchSystemPrompt(value); setPreflight(null); setPreflightConfig(null); setDryRun(null); }}
      />
      <TemplateConditions copy={copy} template={template} baseModel={baseModel} baseProvider={baseProvider} models={models} providers={providers} profiles={profiles} reasoningLevels={reasoningLevels} setReasoningLevels={setReasoningLevels} temperatureValues={temperatureValues} setTemperatureValues={setTemperatureValues} profileIds={profileIds} setProfileIds={setProfileIds} modelKeys={modelKeys} setModelKeys={setModelKeys} variants={variants} setVariants={setVariants} />
      <div className="research-form-section research-target-selector"><div className="research-section-head"><div><strong>{copy.researchTargets}</strong><small>{targetSelectionMode === "random" ? `${randomTargetCount} · ${copy.randomSelection}` : `${targetIds.length} ${copy.selectedOf} ${eligibleTargets.length}`}</small></div></div><div className="research-target-controls"><label><span>{copy.researchTargetSource}</span><select value={targetSource} onChange={(event) => setTargetSource(event.target.value as ResearchTargetSource)}><option value="training">{copy.trainingTargets}</option><option value="user">{copy.myTargets}</option><option value="all">{copy.bothTargetPools}</option></select></label><label><span>{copy.targetSelectionMethod}</span><select value={targetSelectionMode} onChange={(event) => setTargetSelectionMode(event.target.value as ResearchTargetSelectionMode)}><option value="random">{copy.randomSelection}</option><option value="manual">{copy.manualSelection}</option></select></label></div>{targetSelectionMode === "random" ? <div className="research-random-targets"><label><span>{copy.numberOfTargets}</span><input type="number" min={1} max={Math.max(1, eligibleTargets.length)} value={randomTargetCount} onChange={(event) => setRandomTargetCount(Math.max(1, Math.min(eligibleTargets.length || 1, Number(event.target.value) || 1)))} /></label><small>{copy.randomTargetsAtPreflight}</small></div> : <><div className="research-target-search"><Search size={14} /><input value={targetSearch} onChange={(event) => setTargetSearch(event.target.value)} placeholder={copy.searchTargets} /><button className="secondary-button" type="button" disabled={!visibleManualTargets.length} onClick={() => updateSelectedTargets([...new Set([...targetIds, ...visibleManualTargets.map((target) => target.id)])])}>{copy.selectVisible}</button><button className="secondary-button" type="button" disabled={!targetIds.length} onClick={() => updateSelectedTargets([])}>{copy.clearSelection}</button></div><div className="research-check-grid target-manual-grid">{visibleManualTargets.map((target) => <label key={target.id}><input type="checkbox" checked={targetIds.includes(target.id)} onChange={() => updateSelectedTargets(toggle(targetIds, target.id))} /><span>{target.collection === "training" ? copy.trainingTargets : copy.myTargets} · {localizedTargetTitle(target, settings.interfaceLanguage)}</span></label>)}</div></>}{!eligibleTargets.length && <small>{copy.noEligibleTargets}</small>}</div>
      <FormRow label={copy.repetitions}><input type="number" min={1} max={100} value={repetitions} onChange={(event) => setRepetitions(Math.max(1, Math.min(100, Number(event.target.value) || 1)))} /></FormRow><div className="research-inline-check"><label><input type="checkbox" checked={unusedOnly} onChange={(event) => setUnusedOnly(event.target.checked)} />{copy.unusedOnly}</label></div>
      <div className="research-form-section research-evaluation-section"><div className="research-section-head"><div><strong>{copy.researchEvaluation}</strong><small>{copy.researchEvaluationLead}</small></div><select value={evaluationMode} onChange={(event) => setEvaluationMode(event.target.value as "save_only" | "ai_judges")}><option value="save_only">{copy.saveOnlyExternal}</option><option value="ai_judges">{copy.useAiJudges}</option></select></div>{evaluationMode === "save_only" ? <p className="research-evaluation-note">{copy.saveOnlyResearchLead}</p> : <><div className="research-section-head judge-count-row"><strong>{copy.judgeModels}</strong><select value={judgeCount} onChange={(event) => setJudgeCount(Number(event.target.value))}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select></div>{Array.from({ length: judgeCount }, (_, index) => <select className="research-judge-select" key={index} value={judgeKeys[index]} onChange={(event) => setJudgeKeys((current) => current.map((value, itemIndex) => itemIndex === index ? event.target.value : value))}><option value="">{copy.judgeModel} {index + 1}</option>{models.map((model) => <option key={modelKey(model)} value={modelKey(model)}>{providerLabel(providers, model.providerConfigId)} · {model.displayName}</option>)}</select>)}</>}</div>
      <div className="research-builder-actions"><button className="secondary-button" onClick={() => void preview()}>{copy.previewDryRun}</button><button className="secondary-button" onClick={() => void check()}>{copy.runPreflight}</button><button className="primary-button" disabled={!preflight?.ok || busy} onClick={() => void lock()}><LockKeyhole size={15} />{copy.experimentLock}</button></div>{error && <div className="provider-error">{error}</div>}</section>
      <aside className="research-review-column">{dryRun && <DryRunPanel copy={copy} config={dryRun} />}{preflight && <PreflightPanel copy={copy} preflight={preflight} />}</aside></div>
  </div>;
}

function ResearchViewerSettings(props: {
  copy: Copy;
  template: ResearchTemplateType;
  baseProfile: Profile | null;
  baseProvider: ProviderConfig | null;
  baseModels: ProviderModel[];
  baseModelKey: string;
  onBaseModelKey: (value: string) => void;
  sharedCapabilities: SharedResearchCapabilities;
  fixedReasoning: "" | ReasoningEffort;
  onFixedReasoning: (value: "" | ReasoningEffort) => void;
  fixedTemperature: string;
  onFixedTemperature: (value: string) => void;
  maxOutputTokens: string;
  onMaxOutputTokens: (value: string) => void;
  systemPromptSource: "profile" | "custom";
  onSystemPromptSource: (value: "profile" | "custom") => void;
  customSystemPrompt: string;
  onCustomSystemPrompt: (value: string) => void;
}) {
  const { copy, template, baseProfile, baseProvider, sharedCapabilities } = props;
  const reasoningIsVariable = template === "reasoning";
  const temperatureIsVariable = template === "temperature";
  const modelIsVariable = template === "model";
  const promptIsVariable = template === "system_prompt";
  const selectedBaseModel = props.baseModels.find((model) => modelKey(model) === props.baseModelKey) ?? null;
  return <div className="research-form-section research-viewer-control">
    <div className="research-section-head"><div><strong>{copy.researchViewerSettings}</strong><small>{copy.researchViewerSettingsLead}</small></div><span className="status-chip ready"><LockKeyhole size={12} />{copy.fixedForResearch}</span></div>
    <div className="research-control-grid">
      <label><span>{copy.baseViewerModel}</span>{modelIsVariable
        ? <input value={copy.testedVariableBelow} disabled readOnly />
        : <select value={props.baseModelKey} onChange={(event) => props.onBaseModelKey(event.target.value)} disabled={!baseProvider}><option value="">{copy.selectModel}</option>{props.baseModels.map((model) => <option key={modelKey(model)} value={modelKey(model)}>{model.displayName}</option>)}</select>}<small>{modelIsVariable ? copy.modelsToCompare : `${baseProvider?.label ?? copy.credentialPending} · ${copy.researchControlConstant}`}</small></label>
      <label><span>{copy.researchReasoning}</span>{reasoningIsVariable
        ? <input value={copy.testedVariableBelow} disabled readOnly />
        : <select value={props.fixedReasoning} onChange={(event) => props.onFixedReasoning(event.target.value as "" | ReasoningEffort)} disabled={!sharedCapabilities.reasoningEfforts.length}><option value="">{copy.autoProviderDefault}</option>{sharedCapabilities.reasoningEfforts.map((effort) => <option key={effort} value={effort}>{researchReasoningLabel(copy, selectedBaseModel, effort)}</option>)}</select>}<small>{reasoningIsVariable ? copy.reasoningLevels : selectedBaseModel?.capabilities.reasoning.mandatory ? copy.reasoningMandatory : sharedCapabilities.reasoningEfforts.length ? copy.researchControlConstant : selectedBaseModel?.capabilities.reasoning.registryStatus === "known" ? copy.reasoningAutoOnly : copy.researchReasoningUnavailable}</small></label>
      <label><span>{copy.researchTemperature}</span>{temperatureIsVariable
        ? <input value={copy.testedVariableBelow} disabled readOnly />
        : <input type="number" step="0.1" value={props.fixedTemperature} onChange={(event) => props.onFixedTemperature(event.target.value)} placeholder={copy.autoProviderDefault} disabled={!sharedCapabilities.temperatureSupported} min={sharedCapabilities.temperatureMin} max={sharedCapabilities.temperatureMax} />}<small>{temperatureIsVariable ? copy.temperatureValues : sharedCapabilities.temperatureSupported ? copy.researchControlConstant : copy.researchTemperatureUnavailable}</small></label>
      <label><span>{copy.researchMaxOutputTokens}</span><input type="number" min={1} max={sharedCapabilities.maxOutputTokens} value={props.maxOutputTokens} onChange={(event) => props.onMaxOutputTokens(event.target.value)} /><small>{copy.researchControlConstant}</small></label>
    </div>
    {promptIsVariable
      ? <div className="research-tested-variable"><strong>{copy.viewerSystemPrompt}</strong><span>{copy.testedVariableBelow}</span><small>{copy.systemPromptVariants}</small></div>
      : <div className="research-system-prompt"><div className="research-section-head"><div><strong>{copy.fixedResearchSystemPrompt}</strong><small>{copy.fixedResearchSystemPromptLead}</small></div><select value={props.systemPromptSource} onChange={(event) => props.onSystemPromptSource(event.target.value as "profile" | "custom")}><option value="profile">{copy.systemPromptFromProfile}</option><option value="custom">{copy.customResearchSystemPrompt}</option></select></div>{props.systemPromptSource === "profile" ? <div className="research-prompt-preview"><strong>{baseProfile?.name || copy.unnamedProfile}</strong><p>{baseProfile?.defaultViewerSystemPrompt || copy.noProfileSystemPrompt}</p></div> : <textarea className="system-prompt-editor" rows={12} maxLength={100000} value={props.customSystemPrompt} onChange={(event) => props.onCustomSystemPrompt(event.target.value)} placeholder={copy.viewerSystemPromptPlaceholder} />}</div>}
  </div>;
}

function TemplateConditions(props: { copy: Copy; template: ResearchTemplateType; baseModel: ProviderModel | null; baseProvider: ProviderConfig | null; models: ProviderModel[]; providers: ProviderConfig[]; profiles: Profile[]; reasoningLevels: ReasoningEffort[]; setReasoningLevels: (value: ReasoningEffort[]) => void; temperatureValues: string; setTemperatureValues: (value: string) => void; profileIds: string[]; setProfileIds: (value: string[]) => void; modelKeys: string[]; setModelKeys: (value: string[]) => void; variants: string[]; setVariants: (value: string[]) => void }) {
  const { copy, template, baseModel, baseProvider } = props;
  if (template === "practice") return <div className="research-form-section"><strong>{copy.researchConditions}</strong><div className="condition-pills"><span>FIRST</span><span>SECOND</span></div></div>;
  if (template === "reasoning") return <div className="research-form-section"><strong>{copy.reasoningLevels}</strong><div className="research-check-grid">{baseModel?.capabilities.reasoning.efforts.map((effort) => <label key={effort}><input type="checkbox" checked={props.reasoningLevels.includes(effort)} onChange={() => props.setReasoningLevels(toggle(props.reasoningLevels, effort))} /><span>{researchReasoningLabel(copy, baseModel, effort)}</span></label>)}</div>{baseModel?.capabilities.reasoning.mandatory && <small>{copy.reasoningMandatory}</small>}{!baseModel?.capabilities.reasoning.efforts.length && <small>{baseModel?.capabilities.reasoning.registryStatus === "known" ? copy.reasoningAutoOnly : copy.unknown}</small>}</div>;
  if (template === "temperature") return <FormRow label={copy.temperatureValues}><input value={props.temperatureValues} onChange={(event) => props.setTemperatureValues(event.target.value)} disabled={!baseModel?.capabilities.temperature.supported} /></FormRow>;
  if (template === "profile") return <div className="research-form-section"><strong>{copy.profilesToCompare}</strong><div className="research-check-grid">{props.profiles.map((profile) => { const provider = props.providers.find((item) => item.credentialId === profile.credentialId); const matched = props.models.some((model) => model.providerConfigId === provider?.id && model.modelId === baseModel?.modelId); return <label key={profile.id} className={!matched ? "disabled" : ""}><input type="checkbox" disabled={!matched} checked={props.profileIds.includes(profile.id)} onChange={() => props.setProfileIds(toggle(props.profileIds, profile.id))} /><span>{profile.name || copy.unnamedProfile}</span></label>; })}</div></div>;
  if (template === "model") return <div className="research-form-section"><strong>{copy.modelsToCompare}</strong><div className="research-check-grid models">{props.models.filter((model) => model.providerConfigId === baseProvider?.id).map((model) => <label key={modelKey(model)}><input type="checkbox" checked={props.modelKeys.includes(modelKey(model))} onChange={() => props.setModelKeys(toggle(props.modelKeys, modelKey(model)))} /><span>{model.displayName}</span></label>)}</div></div>;
  const label = template === "system_prompt" ? copy.systemPromptVariants : copy.customConditionInstructions;
  return <div className="research-form-section"><div className="research-section-head"><strong>{label}</strong><button className="secondary-button" disabled={props.variants.length >= 4} onClick={() => props.setVariants([...props.variants, ""])}>{copy.addVariant}</button></div><div className="research-variants">{props.variants.map((variant, index) => <div key={index}><textarea className={template === "system_prompt" ? "system-prompt-variant-editor" : undefined} rows={template === "system_prompt" ? 8 : 3} maxLength={100000} value={variant} onChange={(event) => props.setVariants(props.variants.map((value, itemIndex) => itemIndex === index ? event.target.value : value))} placeholder={`${copy.condition} ${index + 1}`} /><button className="icon-button danger" disabled={props.variants.length <= 2} onClick={() => props.setVariants(props.variants.filter((_, itemIndex) => itemIndex !== index))}><X size={14} /></button></div>)}</div></div>;
}

function DryRunPanel({ copy, config }: { copy: Copy; config: ResearchConfig }) {
  const sessions = config.targetIds.length * config.repetitions * config.conditions.length;
  const saveOnly = config.judges.length === 0;
  const control = config.viewerControl;
  return <section className="panel research-review-panel"><div className="research-review-head"><ShieldCheck size={18} /><div><strong>{copy.dryRun}</strong><small>{copy.dryRunLead}</small></div></div><dl><div><dt>{copy.plannedSessions}</dt><dd>{sessions}</dd></div><div><dt>{copy.viewerCalls}</dt><dd>{sessions * 6}</dd></div><div><dt>{copy.judgeCalls}</dt><dd>{sessions * config.judges.length}</dd></div><div><dt>{copy.sessionLanguage}</dt><dd>{config.sessionLanguage.toUpperCase()}</dd></div>{control && <><div><dt>{copy.baseViewerModel}</dt><dd>{control.model.mode === "fixed" ? control.model.modelId : copy.testedVariableBelow}</dd></div><div><dt>{copy.researchReasoning}</dt><dd>{control.reasoning.mode === "fixed" ? control.reasoning.value?.toUpperCase() : control.reasoning.mode === "provider_default" ? copy.autoProviderDefault : copy.testedVariableBelow}</dd></div><div><dt>{copy.researchTemperature}</dt><dd>{control.temperature.mode === "fixed" ? control.temperature.value : control.temperature.mode === "provider_default" ? copy.autoProviderDefault : copy.testedVariableBelow}</dd></div><div><dt>{copy.researchMaxOutputTokens}</dt><dd>{control.maxOutputTokens}</dd></div><div><dt>{copy.viewerSystemPrompt}</dt><dd>{control.systemPrompt.mode === "fixed" ? `${control.systemPrompt.contentSha256?.slice(0, 12)}…` : copy.testedVariableBelow}</dd></div></>}</dl><div className="dry-run-roles"><span>🔒 Viewer → Full RCP 1.5a × 6</span>{saveOnly ? <><span>💾 {copy.saveOnlyExternal}</span><span>📁 {copy.externalEvaluationFolder}</span></> : <><span>🔒 Judge → anonymous allowlist packet</span><span>🧊 Scores → freeze</span><span>🔓 Blinding Key → results only after freeze</span></>}</div></section>;
}

function PreflightPanel({ copy, preflight }: { copy: Copy; preflight: ResearchPreflightResult }) {
  return <section className="panel research-review-panel"><div className="research-review-head"><span className={preflight.ok ? "preflight-ok" : "preflight-fail"}>{preflight.ok ? <Check size={18} /> : <X size={18} />}</span><div><strong>{preflight.ok ? copy.preflightPassed : copy.preflightFailed}</strong><small>{copy.viewerCalls}: {preflight.estimatedViewerCalls} · {copy.judgeCalls}: {preflight.estimatedJudgeCalls}</small></div></div><div className="preflight-list">{preflight.checks.map((check) => <div key={check.id} className={check.level}><span>{check.level === "pass" ? "✓" : check.level === "warning" ? "!" : "×"}</span><p>{check.message}</p></div>)}</div></section>;
}

function ResearchProjectView({ copy, repository, project, onRefresh, onBack }: { copy: Copy; repository: AppRepository; project: ResearchProjectRecord; onRefresh: () => Promise<void>; onBack: () => void }) {
  const [busy, setBusy] = useState<"sessions" | "judging" | "unblind" | "export" | null>(null);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [currentAnonymous, setCurrentAnonymous] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ResearchResults | null>(null);
  const [exportPath, setExportPath] = useState("");
  const [recoverableCount, setRecoverableCount] = useState(0);
  const [assignments, setAssignments] = useState<ResearchAssignmentRecord[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { void repository.getResearchResults(project.id).then(setResults); }, [repository, project.id, project.state]);
  useEffect(() => { void repository.listResearchAssignments(project.id).then(setAssignments); }, [repository, project.id, project.state]);
  useEffect(() => {
    if (project.state !== "Interrupted") { setRecoverableCount(0); return; }
    void repository.listResearchAssignments(project.id).then((items) => setRecoverableCount(items.filter((item) => item.sessionId && !["SessionComplete", "Judged"].includes(item.status)).length));
  }, [repository, project.id, project.state]);
  const runSessions = async () => {
    const controller = new AbortController(); abortRef.current = controller; setBusy("sessions"); setError(null);
    try { await executeResearchSessions({ repository, projectId: project.id, signal: controller.signal, onProgress: (value) => { setProgress(value.completed); setTotal(value.total); setCurrentAnonymous(value.anonymousSessionId); } }); await onRefresh(); }
    catch (cause) { setError(message(cause)); await onRefresh(); } finally { abortRef.current = null; setBusy(null); }
  };
  const runJudging = async () => { setBusy("judging"); setError(null); try { await judgeResearch({ repository, projectId: project.id, onProgress: (value) => { setProgress(value.completed); setTotal(value.total); setCurrentAnonymous(value.anonymousSessionId); } }); await onRefresh(); } catch (cause) { setError(message(cause)); await onRefresh(); } finally { setBusy(null); } };
  const unblind = async () => { setBusy("unblind"); setError(null); try { setResults(await unblindAndComputeResearch(repository, project.id)); await onRefresh(); } catch (cause) { setError(message(cause)); } finally { setBusy(null); } };
  const exportPackage = async () => {
    const destination = await chooseDirectory(copy.researchExportChooseFolder);
    if (!destination) return;
    setBusy("export"); setError(null);
    try { const exported = await exportResearchPackage(repository, project.id, destination); setExportPath(exported.directory); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(null); }
  };
  const recover = async () => {
    if (!recoverableCount || !window.confirm(copy.researchRecoveryConfirm)) return;
    setError(null);
    try { await prepareInterruptedResearchRetry(repository, project.id); setRecoverableCount(0); await onRefresh(); } catch (cause) { setError(message(cause)); }
  };
  const sessionsReady = ["Locked", "Running", "Interrupted"].includes(project.state);
  const saveOnly = project.config.judges.length === 0;
  const judgingReady = !saveOnly && ["SessionsComplete", "Judging"].includes(project.state);
  const saveOnlyExportReady = saveOnly && project.state === "SessionsComplete";
  const completedAssignments = assignments.filter((assignment) => assignment.sessionId);
  const resultBySessionId = new Map((results?.sessions ?? []).map((session) => [session.sessionId, session]));

  return <div className="research-project-view">
    <div className="research-builder-toolbar"><button className="secondary-button" onClick={onBack}>← {copy.research}</button><div><strong>{project.name}</strong><small>{templateName(copy, project.templateType)}</small></div></div>
    <div className="research-project-grid">
      <section className="panel research-run-card">
        <div className="research-state-head"><div><small>{copy.currentState}</small><strong>{project.state}</strong></div>{project.lockedAt && <span className="status-chip ready"><LockKeyhole size={12} />{copy.configLocked}</span>}</div>
        <div className="research-run-meta"><span>{copy.plannedSessions}<strong>{project.config.targetIds.length * project.config.repetitions * project.config.conditions.length}</strong></span><span>{copy.researchConditions}<strong>{project.config.conditions.length}</strong></span><span>{copy.researchEvaluation}<strong>{saveOnly ? copy.saveOnly : `${project.config.judges.length} AI Judge`}</strong></span></div>
        {busy && <div className="research-live-progress"><span className="loader-orb" /><div><strong>{busy === "export" ? (saveOnly ? copy.exportSavedSessions : copy.exportResearchPackage) : `${copy.researchProgress} · ${progress}/${total || "…"}`}</strong><small>{currentAnonymous}</small></div>{busy === "sessions" && <button className="stop-button" onClick={() => abortRef.current?.abort()}><CircleStop size={15} />STOP</button>}</div>}
        {!busy && <div className="research-stage-actions">{recoverableCount > 0 && <button className="secondary-button recovery-button" onClick={() => void recover()}>{copy.preserveResearchRecovery} · {recoverableCount}</button>}{sessionsReady && <button className="primary-button" disabled={!isTauriRuntime() || recoverableCount > 0} onClick={() => void runSessions()}><Play size={15} />{project.state === "Locked" ? copy.startResearch : copy.resumeResearch}</button>}{saveOnlyExportReady && <button className="primary-button" disabled={!isTauriRuntime()} onClick={() => void exportPackage()}>{copy.exportSavedSessions}</button>}{judgingReady && <button className="primary-button" disabled={!isTauriRuntime()} onClick={() => void runJudging()}><ShieldCheck size={15} />{copy.runResearchJudging}</button>}{project.state === "ScoresFrozen" && <button className="primary-button unblind-button" onClick={() => void unblind()}><LockKeyhole size={15} />{copy.unblindCalculate}</button>}{project.state === "Complete" && <><button className="secondary-button" onClick={() => void repository.getResearchResults(project.id).then(setResults)}><RotateCcw size={14} />{copy.researchResults}</button><button className="primary-button" disabled={!isTauriRuntime()} onClick={() => void exportPackage()}>{copy.exportResearchPackage}</button></>}</div>}
        {saveOnlyExportReady && <p className="research-recovery-note">{copy.saveOnlyReadyLead}</p>}{recoverableCount > 0 && <p className="research-recovery-note">{copy.researchRecoveryRequired}</p>}{exportPath && <div className="export-success"><Check size={14} /><span><strong>{copy.exportComplete}</strong><small>{exportPath}</small></span></div>}{!isTauriRuntime() && (sessionsReady || saveOnlyExportReady) && <p className="research-runtime-note">{copy.researchRequiresDesktop}</p>}{error && <div className="provider-error">{error}</div>}
      </section>
      <aside className="panel research-lock-summary"><strong>{copy.experimentLock}</strong><code>{project.configHash ?? "—"}</code><p>{copy.lockWarning}</p>{project.config.viewerControl && <div className="research-lock-controls"><span><small>{copy.baseViewerModel}</small><strong>{project.config.viewerControl.model.mode === "fixed" ? project.config.viewerControl.model.modelId : copy.testedVariableBelow}</strong></span><span><small>{copy.researchReasoning}</small><strong>{project.config.viewerControl.reasoning.mode === "fixed" ? project.config.viewerControl.reasoning.value?.toUpperCase() : project.config.viewerControl.reasoning.mode === "provider_default" ? copy.autoProviderDefault : copy.testedVariableBelow}</strong></span><span><small>{copy.researchTemperature}</small><strong>{project.config.viewerControl.temperature.mode === "fixed" ? project.config.viewerControl.temperature.value : project.config.viewerControl.temperature.mode === "provider_default" ? copy.autoProviderDefault : copy.testedVariableBelow}</strong></span></div>}<ul>{project.config.conditions.map((condition) => <li key={condition.key}>{condition.label}</li>)}</ul></aside>
    </div>
    {completedAssignments.length > 0 && <section className="panel research-session-history"><div className="research-section-head"><strong>{copy.completedSessions}</strong><small>{completedAssignments.length}</small></div><div>{completedAssignments.map((assignment, index) => { const unblinded = assignment.sessionId ? resultBySessionId.get(assignment.sessionId) : undefined; return <button key={assignment.id} className={selectedSessionId === assignment.sessionId ? "active" : ""} onClick={() => setSelectedSessionId(assignment.sessionId!)}><span>{index + 1}. {assignment.anonymousSessionId} · {assignment.status}</span>{unblinded && <small>{copy.condition}: {unblinded.conditionLabel}</small>}</button>; })}</div></section>}
    {selectedSessionId && <SessionInspection repository={repository} workspaceId={project.workspaceId} sessionId={selectedSessionId} language={project.config.sessionLanguage} />}
    {results && <ResearchResultsView copy={copy} results={results} repository={repository} />}
  </div>;
}

function ResearchResultsView({ copy, results, repository }: { copy: Copy; results: ResearchResults; repository: AppRepository }) {
  const [scoresBySession, setScoresBySession] = useState<Record<string, JudgeScoreRecord[]>>({});
  useEffect(() => {
    let cancelled = false;
    void Promise.all(results.sessions.map(async (session) => [session.sessionId, await repository.listJudgeScores(session.sessionId)] as const)).then((pairs) => {
      if (!cancelled) setScoresBySession(Object.fromEntries(pairs));
    });
    return () => { cancelled = true; };
  }, [repository, results]);
  return <section className="panel research-results"><div className="research-section-head"><strong>{copy.researchResults}</strong><small>{results.sessions.length} sessions</small></div><div className="research-results-table-wrap"><table><thead><tr><th>{copy.condition}</th><th>{copy.sampleN}</th><th>{copy.mean}</th><th>{copy.median}</th><th>{copy.stdDev}</th><th>{copy.minMax}</th></tr></thead><tbody>{results.conditions.map((condition) => <tr key={condition.conditionKey}><td><strong>{condition.label}</strong></td><td>{condition.n}</td><td>{condition.meanTotal.toFixed(2)}</td><td>{condition.medianTotal.toFixed(2)}</td><td>{condition.stdDevTotal.toFixed(2)}</td><td>{condition.minTotal.toFixed(1)} / {condition.maxTotal.toFixed(1)}</td></tr>)}</tbody></table></div><div className="research-component-results"><strong>{copy.componentMeans}</strong>{results.conditions.map((condition) => <div key={condition.conditionKey}><span>{condition.label}</span><small>G {condition.meanComponents.gestalt.toFixed(2)}/3 · F {condition.meanComponents.verifiableFeatures.toFixed(2)}/3 · A {condition.meanComponents.activityFunctionEvent.toFixed(2)}/2 · C {condition.meanComponents.confabulationControl.toFixed(2)}/2</small></div>)}</div>{results.pairwise.length > 0 && <div className="pairwise-results"><strong>{copy.pairwise}</strong>{results.pairwise.map((pair) => <div key={`${pair.conditionA}-${pair.conditionB}`}><span>{pair.conditionA} ↔ {pair.conditionB}</span><small>n={pair.pairedN} · {copy.winsTiesLosses}: {pair.winsA}/{pair.ties}/{pair.winsB} · Δ={pair.meanPairedDifference.toFixed(2)}</small></div>)}</div>}<div className="research-target-results"><strong>{copy.targetComparisons}</strong><div className="research-results-table-wrap"><table><thead><tr><th>{copy.blindSession}</th><th>{copy.targetId}</th><th>{copy.condition}</th><th>{copy.mean}</th><th>{copy.scoreSpread}</th><th>{copy.judgeResults}</th></tr></thead><tbody>{results.sessions.map((session) => <tr key={session.sessionId}><td><code>{session.anonymousSessionId}</code></td><td><code>{session.targetId}</code></td><td>{session.conditionLabel}</td><td><strong>{session.total.toFixed(2)}</strong></td><td>σ {session.judgeTotalStdDev.toFixed(2)} · Δ {session.judgeTotalRange.toFixed(2)}</td><td>{(scoresBySession[session.sessionId] ?? []).map((score) => `J${score.judgeIndex} ${score.total.toFixed(1)}`).join(" · ") || "…"}</td></tr>)}</tbody></table></div></div></section>;
}

function FormRow({ label, children }: { label: string; children: ReactNode }) { return <label className="research-form-row"><span>{label}</span>{children}</label>; }
function modelKey(model: ProviderModel): string { return `${model.providerConfigId}::${model.modelId}`; }
function providerLabel(providers: ProviderConfig[], id: string): string { return providers.find((provider) => provider.id === id)?.label ?? "API"; }
function toggle<T>(values: T[], value: T): T[] { return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]; }
function safeKey(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48); }
function message(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
async function sha256Text(text: string): Promise<string> { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)); return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join(""); }

function templateName(copy: Copy, type: ResearchTemplateType): string {
  return ({ reasoning: copy.reasoningCalibration, temperature: copy.temperatureTest, profile: copy.profileComparison, model: copy.modelComparison, practice: copy.practiceEffect, system_prompt: copy.promptComparison, custom: copy.customVariable } as const)[type];
}
function templateMeta(copy: Copy, type: ResearchTemplateType): string {
  return ({ reasoning: "NONE · LOW · MEDIUM · HIGH", temperature: copy.temperature, profile: "Profile A · B", model: "Model A · B", practice: "FIRST ↔ SECOND", system_prompt: "Prompt A · B · C · D", custom: copy.researchConditions } as const)[type];
}
