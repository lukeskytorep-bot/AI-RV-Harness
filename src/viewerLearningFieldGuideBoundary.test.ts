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
import rvSessions from "./features/rvSessions/RvSessionPanel.tsx?raw";
import training from "./features/training/TrainingScreen.tsx?raw";
import trainingExecution from "./features/training/trainingExecution.ts?raw";
import researchBuilder from "./features/research/ResearchBuilder.tsx?raw";
import researchEngine from "./research/engine.ts?raw";
import postReveal from "./sessions/postReveal.ts?raw";
import viewerNotes from "./aiCenter/viewerNotes.ts?raw";
import judgePrompt from "./judge/prompt.ts?raw";
import judgeEngine from "./judge/engine.ts?raw";
import monitorPrompt from "./monitor/prompt.ts?raw";
import monitorEngine from "./monitor/engine.ts?raw";
import providerRetry from "./providers/retry.ts?raw";
import migration023 from "../src-tauri/migrations/023_controlled_purge.sql?raw";
import migration024 from "../src-tauri/migrations/024_viewer_learning_field_guide.sql?raw";
import nativeCompatibility from "../src-tauri/src/ux_data_compatibility.rs?raw";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

describe("VIEWER-LEARNING-1 Field Guide boundaries", () => {
  it("keeps protected Post-Reveal, Viewer Notes, Judge, Monitor, Research, retry and controlled-purge sources byte-identical", () => {
    expect(sha256(postReveal)).toBe("5386dfbf512c691dffb66a57b88fb023075aacee452de86daaf4aba89b405e6d");
    expect(sha256(viewerNotes)).toBe("4ef47c1c22e44f8299d0404e88ec2779f33505d358d0fb6434bd0edf94f0b120");
    expect(sha256(judgePrompt)).toBe("dc2af6fe6b478360cab414c4e4d9bc3f3a4d9fae95819f8420f116c8652df492");
    expect(sha256(judgeEngine)).toBe("df0f40bb7747f36f184f89211c170b2edef2484a8b07b0920390c1dd8dfa8b7d");
    expect(sha256(monitorPrompt)).toBe("3eda515707b2a6e356e49b3b04d191397a760de248a0ba0c46391e950609dc85");
    expect(sha256(monitorEngine)).toBe("73d2f461bca2a2ef7e07e0013c742f86f5bc5d14f4aec77510977c70e8b86065");
    expect(sha256(researchEngine)).toBe("df9b6394fc9945a5a9cb71f543f5c2a3e54f7a751a3e32d4466a2b0f27d14fa2");
    expect(sha256(researchBuilder)).toBe("2aa976813a81b9b0190a8bbfa05b135d3d20963144e8f03bc638be491f4bbf0e");
    expect(sha256(providerRetry)).toBe("1af935d6d31e52f39e0b9595d291e58711c5002c973e4a9293d756e0db83c7cd");
    expect(sha256(migration023)).toBe("1a9d300daa180a4507c01497b52deaf84722bd710ed4617f84058932dc7838a4");
  });

  it("does not add Field Guide learning or mutation to Research or Training Reflection", () => {
    expect(researchBuilder).not.toContain("prepareFieldGuideForSession");
    expect(researchEngine).not.toContain("FieldGuide");
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

  it("freezes Field Guide in new RV and Training snapshots and reuses the stored snapshot on RV Resume", () => {
    expect(rvSessions).toContain("prepareFieldGuideForSession");
    expect(rvSessions).toContain("viewerSystemPromptSnapshotFromFieldGuide");
    expect(rvSessions).toContain("snapshot.rvSystemPrompt.fullContent");
    expect(rvSessions).toContain("snapshot.rvSystemPrompt.fieldGuide");
    const resumePrompt = rvSessions.indexOf("const viewerPrompt = snapshot.rvSystemPrompt");
    const protocolDispatch = rvSessions.indexOf("runAutomaticRvLiteSession", resumePrompt);
    expect(resumePrompt).toBeGreaterThan(-1);
    expect(protocolDispatch).toBeGreaterThan(resumePrompt);

    expect(training).toContain("prepareFieldGuideForSession");
    expect(training).toContain("viewerSystemPromptSnapshotFromFieldGuide");
    expect(training).toContain("executionSnapshot:");
    expect(training).toContain("...(rvSystemPrompt ? { rvSystemPrompt } : {})");
    expect(training).toContain("initial.executionSnapshot?.rvSystemPrompt");
  });

  it("treats the Profile prompt column as legacy-only after schema 024", () => {
    const createStart = profileDialogs.indexOf("export function CreateProfileDialog");
    const editStart = profileDialogs.indexOf("export interface EditProfileDialogProps");
    const createSource = profileDialogs.slice(createStart, editStart);
    expect(createSource).not.toContain("defaultViewerSystemPrompt");
    expect(profileDialogs).toContain("profile.defaultViewerSystemPrompt ?? \"\"");
    expect(profileDialogs).toContain("defaultViewerSystemPrompt: systemPrompt.trim()");
    expect(profileControls).not.toContain("onSystemPrompt");
    expect(appSource).toContain("existingProfile?.defaultViewerSystemPrompt?.trim()");
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

  it("keeps migration 024 inside the current epoch and only tests the accepted green v23 -> v24 upgrade", () => {
    expect(migration024).toContain("CREATE TABLE field_guide_versions");
    expect(migration024).toContain("field_guide_versions_append_only_delete");
    expect(migration024).toContain("controlled_purge_context");
    expect(nativeCompatibility).toContain("exact_green_v23_to_v24_preserves_existing_data_and_provenance");
    expect(nativeCompatibility).not.toContain("legacy_fixture_manual_chain_through_024");
    expect(nativeCompatibility).toContain("MIGRATION_SPECS[..23]");
    expect(nativeCompatibility).toContain("MIGRATION_SPECS[23].sql");
  });
});
