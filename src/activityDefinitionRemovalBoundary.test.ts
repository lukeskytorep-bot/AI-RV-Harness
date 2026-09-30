/// <reference types="node" />

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");

describe("Activity definition removal boundary", () => {
  it("keeps the removed locked activity symbols and UI blocks out of production prompt paths", () => {
    const files = [
      "src/resources/systemPrompts.ts",
      "src/features/profiles/ProfileViewerControls.tsx",
      "src/features/monitor/MonitorPanel.tsx",
      "src/sessions/controller.ts",
      "src/sessions/telepathicController.ts",
      "src/sessions/customController.ts",
      "src/sessions/rvLiteController.ts",
    ];
    const production = files.map(source).join("\n");

    expect(production).not.toContain("ACTIVITY_DEFINITION");
    expect(production).not.toContain("LOCKED_ACTIVITY_VERSION");
    expect(production).not.toContain("lockedActivityDefinition");
    expect(production).not.toContain('id: "locked-activity-definition"');
    expect(production).not.toContain("Activity definition — locked");
    expect(production).not.toContain("Definicja aktywności — zablokowana");
  });
});
