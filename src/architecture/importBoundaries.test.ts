import { describe, expect, it } from "vitest";

const LOW_LEVEL_PROVIDER_SYMBOL = "providerChatAttempt";
const ALLOWED_FILES = new Set([
  "providers/native.ts",
  "providers/requestExecutor.ts",
]);
const sourceFiles = import.meta.glob<string>("../**/*.{ts,tsx}", {
  eager: true,
  import: "default",
  query: "?raw",
});

describe("architecture import boundaries", () => {
  it("keeps the one-attempt provider transport private to the provider executor", () => {
    const offenders = Object.entries(sourceFiles)
      .map(([path, content]) => ({ content, projectPath: path.replace(/^\.\.\//, "") }))
      .filter(({ projectPath }) => !/\.(?:test|spec)\.tsx?$/.test(projectPath))
      .filter(({ projectPath }) => !ALLOWED_FILES.has(projectPath))
      .filter(({ content }) => content.includes(LOW_LEVEL_PROVIDER_SYMBOL))
      .map(({ projectPath }) => projectPath);

    expect(offenders, `${LOW_LEVEL_PROVIDER_SYMBOL} must only be used by requestExecutor.ts`).toEqual([]);
  });
});
