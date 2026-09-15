/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const files = [
  "base.css",
  "shared.css",
  "conversations.css",
  "sessions.css",
  "settings.css",
  "monitor.css",
  "training-research.css",
  "ai-center.css",
] as const;

const normalizeLineEndings = (value: string): string =>
  value.split(String.fromCharCode(13)).join("");

describe("Etap 7 style boundaries", () => {
  it("keeps app.css as the ordered style entry point", () => {
    const appCss = normalizeLineEndings(
      fs.readFileSync(
        path.resolve(process.cwd(), "src/styles/app.css"),
        "utf8",
      ),
    );

    const expected =
      files.map((file) => `@import "./${file}";`).join("\n") + "\n";

    expect(appCss).toBe(expected);
  });

  it("keeps each style area in an explicit module", () => {
    const root = path.resolve(process.cwd(), "src/styles");

    for (const file of files) {
      expect(fs.existsSync(path.join(root, file))).toBe(true);
      expect(
        fs.readFileSync(path.join(root, file), "utf8").trim().length,
      ).toBeGreaterThan(0);
    }
  });
});
