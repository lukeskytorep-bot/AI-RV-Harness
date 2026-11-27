import { ResearchContextConditionsEditor } from "./ResearchContextDesignBuilder";
import { createContextEditorCondition } from "../../research/contextDesignDraft";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProviderConfig, ProviderModel } from "../../providers/types";
import { resolveGenerationSettings } from "../../providers/capabilities";
import type { AppRepository } from "../../storage/repository";
import { getCopy } from "../../i18n";
import { createDefaultSettings } from "../../startupDefaults";
import type { Profile, Workspace } from "../../types";
import { captureCurrentViewerNotes, reconcileResearchBaseModelKey, ResearchConfigBuilder, ResearchResultsView, DryRunPanel, researchBaseModelInventorySignature, researchCustomReasoningModeForProfile, researchPreflightSignature, researchTemperatureConditionSettings, researchTemperatureExperimentSupportsModel } from "./ResearchBuilder";
import type { ResearchConfig, ResearchResults, ResearchTemplateType } from "../../research/types";
import { createResearchProtocolSelection } from "../../research/protocolPolicy";
import researchBuilderSource from "./ResearchBuilder.tsx?raw";

const now = "2026-09-15T12:00:00.000Z";
const profile: Profile = { id: "profile-a", name: "Orion", credentialId: "cred-a", createdAt: now, updatedAt: now };
const workspace: Workspace = { id: "workspace-a", profileId: profile.id, name: "Workspace 1", kind: "rv", createdAt: now, updatedAt: now, lastOpenedAt: now };
const provider: ProviderConfig = { id: "pc-a", provider: "openrouter", label: "OpenRouter", credentialId: "cred-a", credentialFingerprint: "fingerprint", enabled: true, lastStatus: "ok", createdAt: now, updatedAt: now };
const model: ProviderModel = {
  providerConfigId: provider.id, provider: "openrouter", modelId: "model-a", displayName: "Model A", route: "openrouter:model-a",
  capabilities: { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: false, confidence: "unknown" }, supportedParameters: [], contextTokens: 100000, maxOutputTokens: 4096, source: "provider", capturedAt: now },
  pricing: {}, recommended: true, rawMetadata: {}, refreshedAt: now,
};

const repository = {} as AppRepository;
const noop = vi.fn(async () => undefined);

function renderBuilder(template: ResearchTemplateType, uiLanguage: "pl" | "en" = "en") {
  return renderToStaticMarkup(<ResearchConfigBuilder
    copy={getCopy(uiLanguage)}
    settings={createDefaultSettings()}
    repository={repository}
    profiles={[profile]}
    workspaces={[workspace]}
    providers={[provider]}
    models={[model]}
    targets={[]}
    usage={[]}
    template={template}
    onBack={() => undefined}
    onLocked={noop}
  />);
}

describe("Research Builder Training/Research UX step", () => {
  it.each(["reasoning", "temperature", "profile", "model", "practice", "system_prompt", "viewer_notes", "context_instructions", "sampling", "target_code", "custom"] as const)("starts %s on the configuration stage", (template) => {
    for (const language of ["en", "pl"] as const) {
      const html = renderBuilder(template, language);
      const copy = getCopy(language);
      expect(html).toContain('aria-current="step"');
      expect(html).toContain(copy.researchPreparationSteps);
      expect(html).toContain(copy.researchStagePreview);
      expect(html).not.toContain('class="panel research-review-panel"');
      expect(html).not.toContain('class="preflight-list"');
    }
  });


  it("allows Temperature Research for Custom OpenAI even when discovery does not advertise temperature", () => {
    const customProvider = { ...provider, provider: "custom_openai" as const };
    const customModel = { ...model, provider: "custom_openai" as const, providerConfigId: customProvider.id, route: "custom_openai:model-a" };
    expect(customModel.capabilities.temperature.supported).toBe(false);
    expect(researchTemperatureExperimentSupportsModel(customModel)).toBe(true);
    expect(researchTemperatureExperimentSupportsModel(model)).toBe(false);
    const requested = researchTemperatureConditionSettings({ maxOutputTokens: 4096 }, customModel, 0.7);
    expect(requested).toMatchObject({ temperature: 0.7, customTemperatureMode: "manual", maxOutputTokens: 4096 });
    const resolved = resolveGenerationSettings(customModel.capabilities, requested, { provider: customModel.provider });
    expect(resolved.effective.temperature).toBe(0.7);
    expect(resolved.omitted).toEqual([]);
    const directRequested = researchTemperatureConditionSettings({ maxOutputTokens: 4096 }, model, 0.7);
    expect(directRequested).toEqual({ temperature: 0.7, maxOutputTokens: 4096 });
  });

  it("freezes the selected Custom reasoning switch for ordinary Research but not reasoning-effort experiments", () => {
    const customProvider = { ...provider, provider: "custom_openai" as const };
    const customModel = { ...model, provider: "custom_openai" as const, providerConfigId: customProvider.id, route: "custom_openai:model-a" };
    const customProfile = { ...profile, defaultViewerCustomReasoningMode: "off" as const };
    expect(researchCustomReasoningModeForProfile(customProfile, customModel, "model")).toBe("off");
    expect(researchCustomReasoningModeForProfile(customProfile, customModel, "reasoning")).toBeUndefined();
    expect(researchCustomReasoningModeForProfile(customProfile, model, "model")).toBeUndefined();
  });
  it("locks the target-code template to RV Lite and previews both four-prompt variants", () => {
    const html = renderBuilder("target_code");
    expect(html).toContain('disabled=""><option value="full-rcp"');
    expect(html).toContain('<option value="rv-lite" selected="">');
    expect(html).toContain("Target code: with / without");
    expect(html).toContain("The target has been selected. Begin the session.");
    expect(html.match(/Prompt [1-4]/g)).toHaveLength(8);
    expect(html).not.toContain("Custom variable values");
  });

  it("offers exactly Full RCP and RV Lite as Research-wide protocol choices", () => {
    const html = renderBuilder("model");
    expect(html).toContain("Full RCP · 1.5a");
    expect(html).toContain("RV Lite · 1.1.0");
    expect(html).not.toContain("Core · 1.1.0");
  });

  it("replaces the Research Workspace selector with direct AI Profile and ordinary Viewer Notes controls", () => {
    const html = renderBuilder("model");
    expect(html).toContain("AI Profile / AI IS-BE");
    expect(html).toContain("Do not use");
    expect(html).toContain("Use current Viewer Notes");
    expect(html).not.toContain("Research workspace");
  });

  it("defaults ordinary Research to current Viewer Notes and current Field Guide while keeping OFF available", () => {
    const html = renderBuilder("model");
    expect(html).toContain('<input type="radio" name="research-viewer-notes" checked=""/><span>Use current Viewer Notes</span>');
    expect(html).toContain('<input type="radio" name="research-field-guide" checked=""/><span>Use current Field Guide</span>');
    expect(html).toContain('<input type="radio" name="research-viewer-notes"/><span>Do not use</span>');
    expect(html).toContain('<input type="radio" name="research-field-guide"/><span>Do not use trained Field Guide</span>');
  });

  it("shows a controlled Research error when the selected Profile has no active technical Workspace", () => {
    const html = renderToStaticMarkup(<ResearchConfigBuilder
      copy={getCopy("en")} settings={createDefaultSettings()} repository={repository}
      profiles={[profile]} workspaces={[]} providers={[provider]} models={[model]} targets={[]} usage={[]} template="model"
      onBack={() => undefined} onLocked={noop}
    />);
    expect(html).toContain("The selected Profile has no active RV Workspace or legacy combined Workspace");
    expect(html).not.toContain("Research workspace");
  });

  it("keeps Viewer Notes Impact automatic and exposes no historical version selector", () => {
    const html = renderBuilder("viewer_notes");
    expect(html).toContain("Current Viewer Notes at Experiment Lock");
    expect(html).toContain("Historical versions are not selected manually");
    expect(html).not.toContain("Select a version");
    expect(html).not.toContain("Use current Viewer Notes");
  });

  it("shows independent current/off Field Guide controls in ordinary Research", () => {
    const html = renderBuilder("model");
    expect(html).toContain("Do not use trained Field Guide");
    expect(html).toContain("Use current Field Guide");
    expect(html).toContain("Locked Core Identity");
    expect(html).toContain("Locked Base Vocabulary");
  });

  it("keeps one common Field Guide control around the Viewer Notes Impact experiment", () => {
    const html = renderBuilder("viewer_notes");
    expect(html).toContain("Do not use trained Field Guide");
    expect(html).toContain("Use current Field Guide");
    expect(html).toContain("NO NOTES");
    expect(html).toContain("FROZEN CURRENT NOTES");
  });

  it("keeps manual Prompt Research and exposes explicit Field Guide history as a separate source", () => {
    const html = renderBuilder("system_prompt");
    expect(html).toContain("Manual prompt variants");
    expect(html).toContain("Trained Field Guide history");
    expect(html).toContain("standalone experimental prompt");
    expect(html).not.toContain("latest three");
  });


  it("resets Base Viewer on Profile change, watches the actual inventory, and freezes the final selected route", () => {
    expect(researchBuilderSource).toContain('setBaseProfileId(event.target.value); setBaseModelKey("");');
    expect(researchBuilderSource).toContain("researchBaseModelInventorySignature(baseModels)");
    expect(researchBuilderSource).not.toContain("baseModels.length]");
    expect(researchBuilderSource).toContain('{ mode: "fixed", modelId: baseModel.modelId }');
  });

  it("uses the new Profile default after Profile reset even when the previous model is still valid", () => {
    const profileB: Profile = { ...profile, id: "profile-b", name: "Lyra", defaultViewerModelId: "model-b" };
    const modelB: ProviderModel = { ...model, modelId: "model-b", displayName: "Model B", route: "openrouter:model-b" };
    const models = [model, modelB];

    expect(reconcileResearchBaseModelKey(profileB, models, "")).toBe("pc-a::model-b");
  });

  it("preserves a valid manual Base Viewer override after Profile synchronization", () => {
    const profileB: Profile = { ...profile, id: "profile-b", name: "Lyra", defaultViewerModelId: "model-b" };
    const modelB: ProviderModel = { ...model, modelId: "model-b", displayName: "Model B", route: "openrouter:model-b" };
    const modelC: ProviderModel = { ...model, modelId: "model-c", displayName: "Model C", route: "openrouter:model-c" };

    expect(reconcileResearchBaseModelKey(profileB, [model, modelB, modelC], "pc-a::model-c")).toBe("pc-a::model-c");
  });

  it("detects a same-count model inventory replacement and re-resolves an invalid stale route", () => {
    const profileB: Profile = { ...profile, id: "profile-b", name: "Lyra", defaultViewerModelId: "model-b" };
    const modelB: ProviderModel = { ...model, modelId: "model-b", displayName: "Model B", route: "openrouter:model-b" };
    const modelC: ProviderModel = { ...model, modelId: "model-c", displayName: "Model C", route: "openrouter:model-c" };
    const before = [model, modelB];
    const after = [modelB, modelC];

    expect(before).toHaveLength(after.length);
    expect(researchBaseModelInventorySignature(before)).not.toBe(researchBaseModelInventorySignature(after));
    expect(reconcileResearchBaseModelKey(profileB, after, "pc-a::model-a")).toBe("pc-a::model-b");
  });



  it("uses the shared Research builder for Context & Instructions with C3 execution enabled", () => {
    const html = renderBuilder("context_instructions");
    expect(html).toContain("Context conditions");
    expect(html).toContain("Tabula Rasa");
    expect(html).toContain("Experiment Lock");
    expect(researchBuilderSource).not.toContain('contextRuntimePending = project.templateType === "context_instructions"');
    expect(researchBuilderSource).toContain('const sessionsReady = !termination');
  });


  it("localizes context editor independently of session language", () => {
    const html = renderBuilder("context_instructions", "pl");
    expect(html).toContain("Warunki kontekstu");
    expect(html).toContain("Czysta karta");
    expect(html).not.toContain("Context conditions");
    expect(html).not.toContain("Replace All");
  });

  it("shows exact non-empty Replace All message content in Dry Run", () => {
    const content = "  first line\nsecond line  ";
    const frozen = { content: "", sha256: "0".repeat(64), enabled: false, source: "test", availability: "disabled" as const };
    const config = {
      schemaVersion: 1, name: "Context preview", workspaceId: workspace.id, templateType: "context_instructions" as const, sessionLanguage: "en" as const,
      protocol: createResearchProtocolSelection("rv-lite", "en"), targetIds: ["t"], repetitions: 1, requireUnusedTargets: false,
      conditions: [{ key: "replace", label: "Replace", profileId: profile.id, providerConfigId: provider.id, modelId: model.modelId, requestedSettings: {}, contextComposition: {
        version: 1 as const, design: { version: 1 as const, mode: "replace_all" as const, content },
        baseBlocks: { system_prompt: frozen, viewer_notes: frozen, viewer_identity: frozen, base_vocabulary: frozen },
        effectiveBlocks: { system_prompt: frozen, viewer_notes: frozen, viewer_identity: frozen, base_vocabulary: frozen },
        applicationMessages: [{ role: "system" as const, origin: "replace_all" as const, content, sha256: "a".repeat(64) }],
        compositionSha256: "b".repeat(64),
      }}],
      judges: [], randomization: { matchedTargets: true, randomizedExecution: true, randomizedJudgeOrder: true },
      contextPreparation: {} as ResearchConfig["contextPreparation"],
    } as ResearchConfig;
    const html = renderToStaticMarkup(<DryRunPanel copy={getCopy("en")} config={config} />);
    expect(html).toContain(`<pre>${content}</pre>`);
    const polish = renderToStaticMarkup(<DryRunPanel copy={getCopy("pl")} config={config} />);
    expect(polish).toContain("Podgląd zamrożonego kontekstu");
    expect(polish).toContain(`<pre>${content}</pre>`);
    expect(polish).not.toContain("LOGICAL SYSTEM BLOCK");
  });

  it("exposes the Sampling configurations form only through the Research builder contract", () => {
    const html = renderBuilder("sampling");
    expect(html).toContain("Sampling configurations");
    expect(html).toContain("top_p");
    expect(html).toContain("top_k");
    expect(html).toContain("seed");
    expect(html).toContain("At least one parameter must be compared");
    expect(researchBuilderSource).toContain('"viewer_notes"');
    expect(researchBuilderSource).toContain('"context_instructions"');
    expect(researchBuilderSource).toContain('"sampling"');
    expect(researchBuilderSource).toContain('buildResearchSamplingConditions(base("sampling_base", "Sampling"), samplingDesign!)');
    expect(researchBuilderSource).toContain('source: "research", profileId: baseProfile.id, mode: "condition_variable"');
  });

  it("captures the currently active Viewer Notes version for the exact base Viewer identity", async () => {
    const activeVersion = {
      id: "version-7", aiIdentityId: "identity-a", versionNumber: 7, content: "current active notes", contentSha256: "c".repeat(64), estimatedTokens: 6, estimatorVersion: "conservative-char-v1" as const, capacityTokensAtCreation: 2048 as const, sourceSnapshot: { schemaVersion: 1, sessionId: "s", sessionCode: "RV-1", workspaceId: workspace.id, profileId: profile.id, protocolId: "full-rcp", protocolVersion: "1.5a", sessionRunType: "training", capturedAt: now }, protocolId: "full-rcp", sessionRunType: "training", changeSummary: "update", reflectionRunId: "rr", reflectionPacketSha256: "d".repeat(64), modelRouteSnapshot: model.route, generationSettingsSnapshot: { requested: {}, effective: {}, omitted: [] }, createdAt: now,
    };
    const repo = {
      ensureAiIdentity: vi.fn().mockResolvedValue({ id: "identity-a" }),
      getViewerNoteBundle: vi.fn().mockResolvedValue({ settings: { capacityTokens: 2048 }, activeVersion }),
    } as unknown as AppRepository;
    const snapshot = await captureCurrentViewerNotes(repo, profile.id, provider, model, "missing notes");
    expect(snapshot).toEqual(expect.objectContaining({ enabled: true, aiIdentityId: "identity-a", versionId: "version-7", versionNumber: 7, content: "current active notes", capacityTokens: 2048, modelRoute: model.route }));
    expect(repo.ensureAiIdentity).toHaveBeenCalledWith(expect.objectContaining({ profileId: profile.id, providerConfigId: provider.id, modelId: model.modelId, role: "viewer" }));
  });

  it("fails current-notes capture when the exact Viewer identity has no active notes", async () => {
    const repo = {
      ensureAiIdentity: vi.fn().mockResolvedValue({ id: "identity-a" }),
      getViewerNoteBundle: vi.fn().mockResolvedValue(null),
    } as unknown as AppRepository;
    await expect(captureCurrentViewerNotes(repo, profile.id, provider, model, "missing notes")).rejects.toThrow("missing notes");
  });

  it("ignores only capture time between Preflight and Lock, but detects a changed frozen version", () => {
    const snapshot = { enabled: true, aiIdentityId: "identity-a", noteType: "viewer_self_notes" as const, versionId: "v1", versionNumber: 1, content: "notes", contentSha256: "a".repeat(64), estimatedTokens: 2, estimatorVersion: "conservative-char-v1" as const, capacityTokens: 1024 as const, modelRoute: model.route, capturedAt: "before" };
    const base: ResearchConfig = {
      schemaVersion: 1, name: "R", workspaceId: workspace.id, templateType: "model", sessionLanguage: "en", protocol: { id: "full-rcp", version: "1.5a" }, targetIds: ["t"], repetitions: 1, requireUnusedTargets: false,
      conditions: [
        { key: "a", label: "A", profileId: profile.id, providerConfigId: provider.id, modelId: model.modelId, requestedSettings: {}, viewerNotes: snapshot },
        { key: "b", label: "B", profileId: profile.id, providerConfigId: provider.id, modelId: model.modelId, requestedSettings: {}, viewerNotes: structuredClone(snapshot) },
      ], judges: [{ providerConfigId: provider.id, modelId: model.modelId }], randomization: { matchedTargets: true, randomizedExecution: true, randomizedJudgeOrder: true },
    };
    const later = structuredClone(base);
    later.conditions.forEach((condition) => { condition.viewerNotes!.capturedAt = "at-lock"; });
    expect(researchPreflightSignature(later)).toBe(researchPreflightSignature(base));
    later.conditions.forEach((condition) => { condition.viewerNotes!.versionId = "v2"; condition.viewerNotes!.versionNumber = 2; });
    expect(researchPreflightSignature(later)).not.toBe(researchPreflightSignature(base));
  });
});


it("renders Context & Instructions result provenance and completeness", () => {
  const results: ResearchResults = {
    schemaVersion: 1, projectId: "ctx", templateType: "context_instructions", computedAt: "now", pairwise: [],
    conditions: [{ conditionKey: "a", label: "Add notes", contextMode: "add_to_selected", contextAdditionTargets: ["viewer_notes"], compositionSha256: "c".repeat(64), logicalContextMessages: 1, logicalContextCharacters: 17, plannedN: 4, completionRate: 75, n: 3, meanTotal: 7, medianTotal: 7, stdDevTotal: 0.5, minTotal: 6, maxTotal: 8, meanComponents: { gestalt: 2, verifiableFeatures: 2, activityFunctionEvent: 2, confabulationControl: 1 } }],
    sessions: [{ anonymousSessionId: "BlindSession_A", sessionId: "s", targetId: "t", pairKey: "p", conditionKey: "a", conditionLabel: "Add notes", total: 7, judgeCount: 1, judgeTotalRange: 0, judgeTotalStdDev: 0, gestalt: 2, verifiableFeatures: 2, activityFunctionEvent: 2, confabulationControl: 1, contextAudit: { mode: "add_to_selected", additionTargets: ["viewer_notes"], compositionSha256: "c".repeat(64), logicalContextMessages: 1, logicalContextCharacters: 17, requestEvidence: { physicalAttempts: 5, logicalRequests: 4, transportRetries: 1, recoveryAttempts: 0, requestHashes: ["r".repeat(64)] } } }],
  };
  const html = renderToStaticMarkup(<ResearchResultsView copy={getCopy("en")} results={results} repository={repository} />);
  expect(html).toContain("Context &amp; Instructions — condition comparison");
  expect(html).toContain("Add to Selected");
  expect(html).toContain("Viewer Notes");
  expect(html).toContain("3/4 · 75.00%");
  expect(html).toContain("1 msg · 17 chars");
  expect(html).toContain("attempts: 5 · retries 1 · recovery 0");
  const polish = renderToStaticMarkup(<ResearchResultsView copy={getCopy("pl")} results={results} repository={repository} />);
  expect(polish).toContain("Kontekst i instrukcje: porównanie warunków");
  expect(polish).toContain("Dodaj do wybranych");
  expect(polish).toContain("Add notes");
  expect(polish).not.toContain("Add to Selected");
  const selection = structuredClone(results);
  selection.conditions.push(
    { ...selection.conditions[0], conditionKey: "selected", contextMode: "selected_only", contextAdditionTargets: [], contextSelectedBlocks: ["system_prompt", "viewer_notes"] },
    { ...selection.conditions[0], conditionKey: "empty", contextMode: "selected_only", contextAdditionTargets: [], contextSelectedBlocks: [] },
    { ...selection.conditions[0], conditionKey: "mismatch", contextMode: "selected_only", contextSelectedBlocksMismatch: true },
  );
  const selectedHtml = renderToStaticMarkup(<ResearchResultsView copy={getCopy("en")} results={selection} repository={repository} />);
  expect(selectedHtml).toContain(`<td>Selected Blocks Only</td><td>${getCopy("en").contextSystem}, Viewer Notes</td>`);
  expect(selectedHtml).toContain(`<td>Selected Blocks Only</td><td>${getCopy("en").contextEmpty}</td>`);
  expect(selectedHtml).toContain("<td>Inconsistent with Experiment Lock</td>");
  const legacy = structuredClone(results);
  delete legacy.conditions[0].logicalContextMessages;
  delete legacy.conditions[0].logicalContextCharacters;
  delete legacy.conditions[0].plannedN;
  delete legacy.conditions[0].completionRate;
  const legacyHtml = renderToStaticMarkup(<ResearchResultsView copy={getCopy("en")} results={legacy} repository={repository} />);
  expect(legacyHtml).toContain("— msg · — chars");
  expect(legacyHtml).toContain("3/—");
  const empty = structuredClone(legacy);
  empty.conditions[0].logicalContextMessages = 0;
  empty.conditions[0].logicalContextCharacters = 0;
  expect(renderToStaticMarkup(<ResearchResultsView copy={getCopy("en")} results={empty} repository={repository} />)).toContain("0 msg · 0 chars");
});

it.each(["pl", "en"] as const)("localizes stored practice and notes labels in results for %s UI", ui => {
  for (const templateType of ["practice", "viewer_notes"] as const) {
    const entries = templateType === "practice"
      ? [{ key: "first", label: "FIRST" }, { key: "second", label: "SECOND" }]
      : [{ key: "no_notes", label: "No Notes" }, { key: "frozen_notes", label: "Zamrożone notatki v12" }];
    const results: ResearchResults = {
      schemaVersion: 1, projectId: "localized", templateType, computedAt: "now",
      conditions: entries.map(entry => ({ conditionKey: entry.key, label: entry.label, n: 1, meanTotal: 7, medianTotal: 7, stdDevTotal: 0, minTotal: 7, maxTotal: 7, meanComponents: { gestalt: 2, verifiableFeatures: 2, activityFunctionEvent: 2, confabulationControl: 1 } })),
      sessions: entries.map(entry => ({ anonymousSessionId: `Blind_${entry.key}`, sessionId: entry.key, targetId: "t", pairKey: "p", conditionKey: entry.key, conditionLabel: entry.label, total: 7, judgeCount: 1, judgeTotalRange: 0, judgeTotalStdDev: 0, gestalt: 2, verifiableFeatures: 2, activityFunctionEvent: 2, confabulationControl: 1 })),
      pairwise: [{ conditionA: entries[0].key, conditionB: entries[1].key, pairedN: 1, winsA: 0, ties: 1, winsB: 0, meanPairedDifference: 0 }],
    };
    const before = JSON.stringify(results);
    const html = renderToStaticMarkup(<ResearchResultsView copy={getCopy(ui)} results={results} repository={repository} />);
    const expected = templateType === "practice" ? (ui === "pl" ? ["PIERWSZA", "DRUGA"] : ["FIRST", "SECOND"]) : (ui === "pl" ? ["Bez notatek", "Zamrożone notatki v12"] : ["No Notes", "Frozen Notes v12"]);
    for (const label of expected) expect(html).toContain(label);
    expect(html).toContain(`${expected[0]} ↔ ${expected[1]}`);
    expect(JSON.stringify(results)).toBe(before);
  }
});

it.each(["pl", "en"] as const)("shows four checks and no text editor for Selected Blocks Only (%s)", (language) => {
  const condition = createContextEditorCondition({
    id: "selected", label: "Guide", design: { version: 1, mode: "selected_only", blocks: ["system_prompt"] },
  });
  const html = renderToStaticMarkup(<ResearchContextConditionsEditor conditions={[condition]} onChange={() => {}} copy={getCopy(language)} />);
  expect(html).toContain(language === "pl" ? "Tylko wybrane bloki" : "Selected Blocks Only");
  expect(html.match(/type="checkbox"/g)).toHaveLength(4);
  expect(html.match(/checked=""/g)).toHaveLength(1);
  expect(html).not.toContain("<textarea");
});
