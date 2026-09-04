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

  it("uses the public Settings feature entry point and keeps its implementation out of App", () => {
    const appSource = sourceFiles["../App.tsx"];
    const deepImportOffenders = Object.entries(sourceFiles)
      .map(([path, content]) => ({ content, projectPath: path.replace(/^\.\.\//, "") }))
      .filter(({ projectPath }) => !/\.(?:test|spec)\.tsx?$/.test(projectPath))
      .filter(({ content }) => /from\s+["'][^"']*features\/settings\//.test(content))
      .map(({ projectPath }) => projectPath);

    expect(appSource).toContain('from "./features/settings"');
    expect(appSource).not.toContain("function SettingsScreen(");
    expect(deepImportOffenders, "Settings consumers must import the public feature entry point").toEqual([]);
  });

  it("uses the public Profiles feature entry point and keeps its implementation out of App", () => {
    const appSource = sourceFiles["../App.tsx"];
    const deepImportOffenders = Object.entries(sourceFiles)
      .map(([path, content]) => ({ content, projectPath: path.replace(/^\.\.\//, "") }))
      .filter(({ projectPath }) => !/\.(?:test|spec)\.tsx?$/.test(projectPath))
      .filter(({ content }) => /from\s+["'][^"']*features\/profiles\//.test(content))
      .map(({ projectPath }) => projectPath);

    expect(appSource).toContain('from "./features/profiles"');
    expect(appSource).not.toContain("function ProfilesScreen(");
    expect(appSource).not.toContain("function CreateProfileDialog(");
    expect(appSource).not.toContain("function EditProfileDialog(");
    expect(deepImportOffenders, "Profiles consumers must import the public feature entry point").toEqual([]);
  });

  it("uses the public Targets feature entry point and keeps its implementation out of App", () => {
    const appSource = sourceFiles["../App.tsx"];
    const deepImportOffenders = Object.entries(sourceFiles)
      .map(([path, content]) => ({ content, projectPath: path.replace(/^\.\.\//, "") }))
      .filter(({ projectPath }) => !/\.(?:test|spec)\.tsx?$/.test(projectPath))
      .filter(({ content }) => /from\s+["'][^"']*features\/targets\//.test(content))
      .map(({ projectPath }) => projectPath);

    expect(appSource).toContain('from "./features/targets"');
    expect(appSource).not.toContain("function TargetsScreen(");
    expect(appSource).not.toContain("function CreateTargetDialog(");
    expect(appSource).not.toContain("function EditTargetDialog(");
    expect(deepImportOffenders, "Targets consumers must import the public feature entry point").toEqual([]);
  });

  it("uses the public AI Center feature entry point and keeps its implementation out of shared components", () => {
    const appSource = sourceFiles["../App.tsx"];
    const deepImportOffenders = Object.entries(sourceFiles)
      .map(([path, content]) => ({ content, projectPath: path.replace(/^\.\.\//, "") }))
      .filter(({ projectPath }) => !/\.(?:test|spec)\.tsx?$/.test(projectPath))
      .filter(({ content }) => /from\s+["'][^"']*features\/aiCenter\//.test(content))
      .map(({ projectPath }) => projectPath);

    expect(appSource).toContain('from "./features/aiCenter"');
    expect(appSource).not.toContain('from "./components/AiCenterScreen"');
    expect(sourceFiles["../components/AiCenterScreen.tsx"]).toBeUndefined();
    expect(deepImportOffenders, "AI Center consumers must import the public feature entry point").toEqual([]);
  });

  it("uses the public Research feature entry point and keeps its implementation out of App and shared components", () => {
    const appSource = sourceFiles["../App.tsx"];
    const deepImportOffenders = Object.entries(sourceFiles)
      .map(([path, content]) => ({ content, projectPath: path.replace(/^\.\.\//, "") }))
      .filter(({ projectPath }) => !/\.(?:test|spec)\.tsx?$/.test(projectPath))
      .filter(({ content }) => /from\s+["'][^"']*features\/research\//.test(content))
      .map(({ projectPath }) => projectPath);

    expect(appSource).toContain('from "./features/research"');
    expect(appSource).not.toContain("function ResearchScreen(");
    expect(appSource).not.toContain('from "./components/ResearchBuilder"');
    expect(sourceFiles["../components/ResearchBuilder.tsx"]).toBeUndefined();
    expect(deepImportOffenders, "Research consumers must import the public feature entry point").toEqual([]);
  });
});
