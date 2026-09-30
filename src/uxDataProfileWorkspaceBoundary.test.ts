/// <reference types="node" />

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");

const readOpenedSource = (target: string) => {
  const descriptor = fs.openSync(target, "r");
  try {
    return fs.readFileSync(descriptor, "utf8");
  } finally {
    fs.closeSync(descriptor);
  }
};

const inspectProductionFile = (target: string, offenders: string[]) => {
  if (!/\.tsx?$/.test(target) || target.includes(".test.")) return;
  if (/\.createProfile\s*\(/.test(readOpenedSource(target))) {
    offenders.push(path.relative(process.cwd(), target));
  }
};

const visitProductionDirectory = (directory: string, offenders: string[]) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      visitProductionDirectory(target, offenders);
    } else if (entry.isFile()) {
      inspectProductionFile(target, offenders);
    }
  }
};

describe("UX-DATA-4 Profile + Workspace boundaries", () => {
  it("routes product-level Profile creation through the initial-Workspace use case", () => {
    const app = source("src/App.tsx");
    expect(app).toContain("createProfileWithInitialWorkspaces");
    const offenders: string[] = [];
    inspectProductionFile(path.join(process.cwd(), "src/App.tsx"), offenders);
    visitProductionDirectory(path.join(process.cwd(), "src/features"), offenders);
    expect(offenders).toEqual([]);
  });

  it("keeps the Workspace and Training directories bounded/scrollable", () => {
    const css = ["base.css", "shared.css", "conversations.css", "sessions.css", "settings.css", "monitor.css", "training-research.css", "ai-center.css"]
      .map((file) => source(`src/styles/${file}`))
      .join("\n");
    expect(css).toMatch(/\.workspace-list\s*\{[^}]*max-height:[^}]*overflow:\s*auto/s);
    expect(css).toMatch(/\.training-run-list\s*\{[^}]*max-height:[^}]*overflow:\s*auto/s);
    expect(css).toContain("workspace-directory-tile");
  });

  it("keeps last-Workspace protection in both persistence adapters", () => {
    expect(source("src/storage/browser/workspacesConversationsRepository.ts")).toContain("A Profile must keep at least one active compatible Workspace of each required type.");
    expect(source("src/storage/sqlite/workspacesConversationsRepository.ts")).toContain("A Profile must keep at least one active compatible Workspace of each required type.");
  });
});
