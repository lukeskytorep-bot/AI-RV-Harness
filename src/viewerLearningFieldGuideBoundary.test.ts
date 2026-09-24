import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import aiCenter from "./features/aiCenter/AiCenterScreen.tsx?raw";
import appSource from "./App.tsx?raw";
import chatPanel from "./features/conversations/ChatPanel.tsx?raw";
import fieldGuideTypes from "./aiCenter/fieldGuideTypes.ts?raw";
import browserFieldGuideRepository from "./storage/browser/fieldGuideRepository.ts?raw";
import sqliteFieldGuideRepository from "./storage/sqlite/fieldGuideRepository.ts?raw";
import profileControls from "./features/profiles/ProfileViewerControls.tsx?raw";
import profileDialogs from "./features/profiles/ProfileDialogs.tsx?raw";
import profileAiConfiguration from "./features/profiles/profileAiConfiguration.ts?raw";
import profileSetupController from "./features/profiles/useProfileSetupController.ts?raw";
import rvSessions from "./features/rvSessions/RvSessionPanel.tsx?raw";
import training from "./features/training/TrainingScreen.tsx?raw";
import trainingExecution from "./features/training/trainingExecution.ts?raw";
import researchBuilder from "./features/research/ResearchBuilder.tsx?raw";
import researchEngine from "./research/engine.ts?raw";
import researchFieldGuidePolicy from "./research/fieldGuidePolicy.ts?raw";
import postReveal from "./sessions/postReveal.ts?raw";
import judgePrompt from "./judge/prompt.ts?raw";
import judgeEngine from "./judge/engine.ts?raw";
import monitorPrompt from "./monitor/prompt.ts?raw";
import monitorEngine from "./monitor/engine.ts?raw";
import providerRetry from "./providers/retry.ts?raw";
import operationResourceProfiles from "./providers/operationResourceProfiles.ts?raw";
import migration023 from "../src-tauri/migrations/023_controlled_purge.sql?raw";
import migration024 from "../src-tauri/migrations/024_viewer_learning_field_guide.sql?raw";
import browserControlledPurge from "./storage/browser/controlledPurge.ts?raw";
import sqliteControlledPurge from "./storage/sqlite/controlledPurge.ts?raw";
import nativeCompatibility from "../src-tauri/src/ux_data_compatibility.rs?raw";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const normalizeS2MonitorStreamingWiring = (value: string) => value
  .replace(', ProviderStreamEvent } from "../providers/types";', ' } from "../providers/types";')
  .replace('import type { StreamWorkflowContext } from "../providers/streamPresentation";\n', "")
  .replace('  streamWorkflowContext?: StreamWorkflowContext;\n  onStreamEvent?: (event: ProviderStreamEvent) => void;\n', "")
  .replace('; signal?: AbortSignal; onStreamEvent?: (event: ProviderStreamEvent) => void }) => Promise<ProviderChatResponse>;', ' }) => Promise<ProviderChatResponse>;')
  .replace(', streamWorkflowContext: input.streamWorkflowContext, onStreamEvent: input.onStreamEvent, attempt:', ', attempt:');

describe("VIEWER-LEARNING-1 Field Guide boundaries", () => {
  it("allows intentional ORP1 Post-Reveal/Judge resource wiring while keeping protected prompts, Monitor, retry and purge invariants", () => {
    expect(postReveal).toContain('operationKind: "post_reveal_viewer"');
    expect(postReveal).toContain('operationKind: "post_reveal_monitor"');
    expect(judgeEngine).toContain('operationKind: "judge"');
    expect(judgeEngine).toContain("recordFrozenJudgeResult");
    expect(sha256(judgePrompt)).toBe("dc2af6fe6b478360cab414c4e4d9bc3f3a4d9fae95819f8420f116c8652df492");
    expect(sha256(monitorPrompt)).toBe("3eda515707b2a6e356e49b3b04d191397a760de248a0ba0c46391e950609dc85");
    // S2 may add only the normalized streaming wiring; all other Monitor execution bytes remain protected.
    expect(monitorEngine).toContain('"monitor.evaluate"');
    expect(monitorEngine).toContain('"monitor.output-recovery"');
    expect(operationResourceProfiles).toContain('if (id.startsWith("monitor.")) return "live_monitor";');
    expect(monitorEngine).toContain("onStreamEvent: input.onStreamEvent");
    expect(sha256(normalizeS2MonitorStreamingWiring(monitorEngine))).toBe("73d2f461bca2a2ef7e07e0013c742f86f5bc5d14f4aec77510977c70e8b86065");
    // Provider transport evolves intentionally in E1/S1. Protect retry semantics rather than byte identity.
    expect(providerRetry).toContain('if (details.semanticOutputStarted) return "never"');
    expect(providerRetry).toContain('details.code === "response_body_too_large"');
    expect(providerRetry).toContain('return category === "standard" ? configured : category === "single_recovery" ? 1 : 0');
    expect(sha256(browserControlledPurge)).toBe("502b94e42f6707537fe7f38309fa253a95f088c5e64223b28ea5ccf8375f1b6a");
    expect(sha256(sqliteControlledPurge)).toBe("5ed7115da8cc2bc36ddc06170c766783f19186bf4cd8672396c291ae26cfcfc4");
    expect(sha256(migration023)).toBe("1a9d300daa180a4507c01497b52deaf84722bd710ed4617f84058932dc7838a4");
  });

  it("keeps Research Field Guide usage read-only and Training Reflection free of direct repository mutation", () => {
    expect(researchBuilder).not.toContain("prepareFieldGuideForSession");
    expect(researchBuilder).not.toContain("createFieldGuideVersion");
    expect(researchBuilder).toContain("captureCurrentResearchFieldGuide");
    expect(researchFieldGuidePolicy).toContain("getExistingFieldGuideBundle");
    expect(researchFieldGuidePolicy).not.toContain("createFieldGuideVersion");
    expect(researchFieldGuidePolicy).not.toContain("restoreFieldGuideVersion");
    expect(researchEngine).toContain("fieldGuideSnapshotSignature");
    expect(researchEngine).not.toContain("runFieldGuideUpdate");
    expect(trainingExecution).not.toContain("FieldGuideReflection");
    expect(trainingExecution).not.toContain("createFieldGuideVersion");
    expect(trainingExecution).not.toContain("restoreFieldGuideVersion");
  });

  it("injects the active Field Guide into Manual RV while freezing retry on the exact pending prompt", () => {
    expect(chatPanel).toContain("prepareFieldGuideForSession");
    expect(chatPanel).toContain("viewerSystemPromptSnapshotFromFieldGuide");
    expect(chatPanel).toContain("effectiveRvSystemPrompt = promptSnapshot.content");
    expect(chatPanel).toContain("pendingRetry.rvSystemPrompt");
  });

  it("freezes Field Guide in new RV and per-target Training snapshots and reuses the stored snapshot on RV Resume", () => {
    expect(rvSessions).toContain("prepareFieldGuideForSession");
    expect(rvSessions).toContain("viewerSystemPromptSnapshotFromFieldGuide");
    expect(rvSessions).toContain("snapshot.rvSystemPrompt.fullContent");
    expect(rvSessions).toContain("snapshot.rvSystemPrompt.fieldGuide");
    const resumePrompt = rvSessions.indexOf("const viewerPrompt = snapshot.rvSystemPrompt");
    const protocolDispatch = rvSessions.indexOf("runAutomaticRvLiteSession", resumePrompt);
    expect(resumePrompt).toBeGreaterThan(-1);
    expect(protocolDispatch).toBeGreaterThan(resumePrompt);

    expect(training).toContain("executionSnapshot:");
    expect(trainingExecution).toContain("prepareFieldGuideForSession");
    expect(trainingExecution).toContain("viewerSystemPromptSnapshotFromFieldGuide");
    expect(trainingExecution).toContain("rvSystemPrompt,");
  });

  it("treats the Profile prompt column as legacy-only after schema 024", () => {
    const createStart = profileDialogs.indexOf("export function CreateProfileDialog");
    const editStart = profileDialogs.indexOf("export interface EditProfileDialogProps");
    const createSource = profileDialogs.slice(createStart, editStart);
    expect(createSource).not.toContain("defaultViewerSystemPrompt");
    expect(profileDialogs).toContain("profile.defaultViewerSystemPrompt ?? \"\"");
    expect(profileAiConfiguration).toContain("defaultViewerSystemPrompt: systemPrompt.trim()");
    expect(profileControls).not.toContain("onSystemPrompt");
    expect(profileSetupController).toContain("existingProfile?.defaultViewerSystemPrompt ?? \"\"");
    expect(appSource).not.toContain("...(viewerSystemPrompt.trim() ? { defaultViewerSystemPrompt");
  });

  it("keeps Field Guide content read-only and separates it from Viewer Notes in Viewer Learning", () => {
    expect(aiCenter).toContain('"viewer-learning"');
    expect(aiCenter).toContain("Przewodnik Pola");
    expect(aiCenter).toContain("Field Guide");
    expect(aiCenter).toContain("Viewer Notes");
    expect(aiCenter).toContain('aria-readonly="true"');
    expect(aiCenter).not.toContain("setFieldGuideContent");
    expect(profileControls).toContain("viewer-field-guide-readonly");
    expect(profileControls).not.toContain("onSystemPrompt(");
  });


  it("does not allow version creation to choose or auto-increase Field Guide capacity", () => {
    const createInputStart = fieldGuideTypes.indexOf("export interface CreateFieldGuideVersionInput");
    const resolveInputStart = fieldGuideTypes.indexOf("export interface ResolveLegacyFieldGuideBaselineInput");
    const createInput = fieldGuideTypes.slice(createInputStart, resolveInputStart);
    expect(createInput).not.toContain("capacityTokens");
    expect(browserFieldGuideRepository).toContain("const settings = this.ensureSettings(input.aiIdentityId, input.language)");
    expect(sqliteFieldGuideRepository).toContain("const settings = await this.ensureSettings(input.aiIdentityId, input.language)");
    expect(browserFieldGuideRepository).not.toContain("input.capacityTokens");
    expect(sqliteFieldGuideRepository).not.toContain("input.capacityTokens");
    expect(aiCenter).toContain("setFieldGuideCapacity");
  });

  it("keeps migration 024 immutable inside the current epoch while later migrations extend the exact-green chain", () => {
    expect(migration024).toContain("CREATE TABLE field_guide_versions");
    expect(migration024).toContain("field_guide_versions_append_only_delete");
    expect(migration024).toContain("controlled_purge_context");
    expect(nativeCompatibility).toContain("exact_green_v23_to_v24_preserves_existing_data_and_provenance");
    expect(nativeCompatibility).not.toContain("legacy_fixture_manual_chain_through_024");
    expect(nativeCompatibility).toContain("MIGRATION_SPECS[..23]");
    expect(nativeCompatibility).toContain("MIGRATION_SPECS[23].sql");
    expect(nativeCompatibility).toContain("exact_green_v24_to_v25_adds_provider_state_storage_without_mutating_existing_data");
    expect(nativeCompatibility).toContain("MIGRATION_SPECS[24].sql");
  });
});
