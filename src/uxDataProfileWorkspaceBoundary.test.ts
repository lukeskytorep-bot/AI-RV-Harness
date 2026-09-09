/// <reference types="node" />

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");

describe("UX-DATA-4 Profile + Workspace boundaries", () => {
  it("routes product-level Profile creation through the initial-Workspace use case", () => {
    const app = source("src/App.tsx");
    expect(app).toContain("createProfileWithInitialWorkspace");
    const productionRoots = ["src/App.tsx", "src/features"];
    const offenders: string[] = [];
    const visit = (target: string) => {
      const stat = fs.statSync(target);
      if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(target)) visit(path.join(target, entry));
        return;
      }
      if (!/\.tsx?$/.test(target) || target.includes(".test.")) return;
      if (/\.createProfile\s*\(/.test(fs.readFileSync(target, "utf8"))) offenders.push(path.relative(process.cwd(), target));
    };
    for (const relative of productionRoots) visit(path.join(process.cwd(), relative));
    expect(offenders).toEqual([]);
  });

  it("keeps the Workspace and Training directories bounded/scrollable", () => {
    const css = source("src/styles/app.css");
    expect(css).toMatch(/\.workspace-list\s*\{[^}]*max-height:[^}]*overflow:\s*auto/s);
    expect(css).toMatch(/\.training-run-list\s*\{[^}]*max-height:[^}]*overflow:\s*auto/s);
    expect(css).toContain("workspace-directory-tile");
  });

  it("keeps last-Workspace protection in both persistence adapters", () => {
    expect(source("src/storage/browser/workspacesConversationsRepository.ts")).toContain("A Profile must keep at least one active Workspace.");
    expect(source("src/storage/sqlite/workspacesConversationsRepository.ts")).toContain("A Profile must keep at least one active Workspace.");
  });
});
