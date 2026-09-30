/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { en, getCopy } from "./i18n";

const domains = ["core", "workspace", "sessions", "research", "targets", "settings"] as const;

describe("Etap 7 i18n boundaries", () => {
  it("keeps Polish and English key sets exactly aligned", () => {
    const enKeys = Object.keys(en).sort();
    const plKeys = Object.keys(getCopy("pl")).sort();
    expect(plKeys).toEqual(enKeys);
    expect(enKeys.length).toBeGreaterThan(500);
  });

  it("keeps translations split into explicit domain modules", () => {
    const root = path.resolve(process.cwd(), "src/i18n");
    for (const domain of domains) {
      const source = fs.readFileSync(path.join(root, `${domain}.ts`), "utf8");
      expect(source).toContain("export const en = {");
      expect(source).toContain("export const pl = {");
    }
    const facade = fs.readFileSync(path.resolve(process.cwd(), "src/i18n.ts"), "utf8");
    for (const domain of domains) expect(facade).toContain(`./i18n/${domain}`);
  });
});
