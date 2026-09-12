/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const srcRoot = path.resolve(process.cwd(), "src");
const read = (relative: string) => fs.readFileSync(path.join(srcRoot, relative), "utf8");

describe("STAGE-7B shared component boundaries", () => {
  it("requires Settings to use the canonical PageHeader and forbids a local PageHeader implementation", () => {
    const settings = read("features/settings/SettingsScreen.tsx");

    expect(settings).toMatch(/from\s+["']\.\.\/\.\.\/components\/PageHeader["']/);
    expect(settings).toContain("<PageHeader");
    expect(settings).not.toMatch(/function\s+PageHeader\s*\(/);
    expect(settings).not.toMatch(/const\s+PageHeader\s*=/);
  });

  it("requires Training to use the canonical PageHeader instead of recreating its markup", () => {
    const training = read("features/training/TrainingScreen.tsx");

    expect(training).toMatch(/from\s+["']\.\.\/\.\.\/components\/PageHeader["']/);
    expect(training).toContain("<PageHeader");
    expect(training).not.toMatch(/<header\s+className=["']page-header["']/);
  });

  it("allows AI Center to retain its specialized header contract", () => {
    const aiCenter = read("features/aiCenter/AiCenterScreen.tsx");

    expect(aiCenter).toContain('className="page-header ai-center-header"');
    expect(aiCenter).toContain('className="eyebrow"');
    expect(aiCenter).toContain("<select");
  });

  it("keeps shared UI component implementations inside src/components", () => {
    for (const component of ["PageHeader", "EmptyState", "FormDialog", "ModelRouteSelect", "JudgeResults", "ProtocolDialog", "SafeMarkdown", "ResourceViewerDialogShell"]) {
      expect(fs.existsSync(path.join(srcRoot, "components", `${component}.tsx`)), `${component} must live in src/components`).toBe(true);
    }
  });

  it("uses the resource-viewer shell only for the compatible resource dialogs", () => {
    const settings = read("features/settings/SettingsScreen.tsx");
    const protocolDialog = read("components/ProtocolDialog.tsx");
    const shell = read("components/ResourceViewerDialogShell.tsx");

    expect(settings).toContain('from "../../components/ResourceViewerDialogShell"');
    expect(settings.match(/<ResourceViewerDialogShell/g)?.length).toBe(2);
    expect(protocolDialog).toContain('from "./ResourceViewerDialogShell"');
    expect(protocolDialog).toContain("<ResourceViewerDialogShell");
    expect(shell).toContain('className="modal-backdrop"');
    expect(shell).toContain('role="dialog"');
    expect(shell).toContain('aria-modal="true"');
  });
});
