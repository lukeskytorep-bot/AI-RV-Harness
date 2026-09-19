import { describe, expect, it } from "vitest";

import bundled from "./targets/bundled.ts?raw";
import localizationPack from "./targets/bundledLocalization.ts?raw";
import targetTypes from "./targets/types.ts?raw";
import sqliteTargets from "./storage/sqlite/targetsRepository.ts?raw";
import writeRegistry from "./storage/databaseWriteOperations.ts?raw";
import nativeDatabase from "../src-tauri/src/database.rs?raw";
import sessionTypes from "./sessions/types.ts?raw";
import rvSessionsPanel from "./features/rvSessions/RvSessionPanel.tsx?raw";

const polishResources = import.meta.glob<string>("./resources/training-targets-localized/pl/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
});

describe("TARGET-REVEAL-LOCALIZATION-INTEGRATION-1 boundaries", () => {
  it("activates exactly 84 accepted Polish resources through the existing factory IDs", () => {
    expect(Object.keys(polishResources)).toHaveLength(84);
    expect(localizationPack).toContain('factory-training-target-localization-pl');
    expect(localizationPack).toContain('factory_training_${match[1]}');
    expect(bundled).toContain('polishTranslationStatus: "accepted"');
    expect(bundled).toContain('languages: ["en", "pl"]');
    expect(bundled).toContain("updateBundledTargetLocalization");
  });

  it("keeps the data sync metadata-only and constrained to active Training targets", () => {
    expect(targetTypes).toContain("BundledTargetLocalizationInput");
    const sql = "UPDATE targets SET source_metadata_json = $1 WHERE id = $2 AND collection = 'training' AND archived_at IS NULL";
    expect(sqliteTargets).toContain(sql);
    expect(writeRegistry).toContain(sql);
    expect(nativeDatabase).toContain(sql);
    expect(sql).not.toContain("reveal_text");
    expect(sql).not.toContain("title =");
  });

  it("freezes automatic Reveal identity by hash and protects legacy Resume behavior", () => {
    expect(sessionTypes).toContain("automaticRevealHash?: string");
    expect(rvSessionsPanel).toContain("capturedAutomaticReveal.hash !== snapshot.automaticRevealHash");
    expect(rvSessionsPanel).toContain("Resume was stopped to avoid replacing the target content.");
    expect(rvSessionsPanel).toContain("sourceMetadata: {}");
  });
});
