import { describe, expect, it } from "vitest";

import bundled from "./targets/bundled.ts?raw";
import localization from "./targets/localization.ts?raw";
import localizationPack from "./targets/bundledLocalization.ts?raw";
import repositoryContract from "./storage/repository.ts?raw";
import sqliteTargets from "./storage/sqlite/targetsRepository.ts?raw";
import writeRegistry from "./storage/databaseWriteOperations.ts?raw";
import nativeDatabase from "../src-tauri/src/database.rs?raw";
import sessionTypes from "./sessions/types.ts?raw";
import targetService from "./targets/service.ts?raw";
import rvSessionsPanel from "./features/rvSessions/RvSessionPanel.tsx?raw";

const polishResources = import.meta.glob<string>("./resources/training-targets-localized/pl/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
});

describe("FACTORY-TARGET-LOCALIZATION-COMPAT-1 boundaries", () => {
  it("keeps startup factory seeding insert-only for existing immutable target rows", () => {
    expect(Object.keys(polishResources)).toHaveLength(84);
    expect(localizationPack).toContain("factory-training-target-localization-pl");
    expect(bundled).toContain('Pick<AppRepository, "listTargets" | "createTarget">');
    expect(bundled).not.toContain("updateBundledTargetLocalization");
    expect(repositoryContract).not.toContain("updateBundledTargetLocalization");
    expect(sqliteTargets).not.toContain("UPDATE targets SET source_metadata_json");
    expect(writeRegistry).not.toContain("targets_update_targets_04");
    expect(nativeDatabase).not.toContain("TargetsUpdateTargets04");
  });

  it("uses bundled Polish resources only as a read-time fallback and preserves persisted localization", () => {
    expect(localization).toContain('metadataText(target, "titlePl")');
    expect(localization).toContain("bundledFactoryPolish(target)?.titlePl");
    expect(localization).toContain('metadataText(target, "revealTextPl")');
    expect(localization).toContain("bundledFactoryPolish(target)?.revealTextPl");
    expect(localization).toContain("getBundledTrainingLocalizationPl(target.id)");
  });

  it("freezes automatic Reveal identity by hash and allows only the legacy canonical factory Reveal fallback", () => {
    expect(sessionTypes).toContain("automaticRevealHash?: string");
    expect(targetService).toContain("resolveAutomaticTargetRevealForResume");
    expect(targetService).toContain("const legacy = await buildAutomaticTargetReveal({ ...target, sourceMetadata: {} }, language)");
    expect(rvSessionsPanel).toContain("resolveAutomaticTargetRevealForResume(capturedTarget, snapshot.sessionLanguage, snapshot.automaticRevealHash)");
    expect(rvSessionsPanel).toContain("Resume was stopped to avoid replacing the target content.");
  });
});
