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

  it("uses the public Training feature entry point and keeps its implementation out of shared components", () => {
    const appSource = sourceFiles["../App.tsx"];
    const deepImportOffenders = Object.entries(sourceFiles)
      .map(([path, content]) => ({ content, projectPath: path.replace(/^\.\.\//, "") }))
      .filter(({ projectPath }) => !/\.(?:test|spec)\.tsx?$/.test(projectPath))
      .filter(({ projectPath }) => !projectPath.startsWith("features/training/"))
      .filter(({ content }) => /from\s+["'][^"']*features\/training\//.test(content))
      .map(({ projectPath }) => projectPath);

    expect(appSource).toContain('from "./features/training"');
    expect(appSource).not.toContain('from "./components/TrainingScreen"');
    expect(sourceFiles["../components/TrainingScreen.tsx"]).toBeUndefined();
    expect(deepImportOffenders, "Training consumers must import the public feature entry point").toEqual([]);
  });

  it("uses the public Workspaces feature entry point and keeps its screens out of App", () => {
    const appSource = sourceFiles["../App.tsx"];
    const deepImportOffenders = Object.entries(sourceFiles)
      .map(([path, content]) => ({ content, projectPath: path.replace(/^\.\.\//, "") }))
      .filter(({ projectPath }) => !/\.(?:test|spec)\.tsx?$/.test(projectPath))
      .filter(({ projectPath }) => !projectPath.startsWith("features/workspaces/"))
      .filter(({ content }) => /from\s+["'][^"']*features\/workspaces\//.test(content))
      .map(({ projectPath }) => projectPath);

    expect(appSource).toContain('from "./features/workspaces"');
    expect(appSource).not.toContain("function WorkspacesScreen(");
    expect(appSource).not.toContain("function WorkspaceDirectoryList(");
    expect(appSource).not.toContain("function WorkspaceSwitcherDialog(");
    expect(deepImportOffenders, "Workspaces consumers must import the public feature entry point").toEqual([]);
  });

  it("uses the public Conversations feature entry point and keeps ChatPanel out of App", () => {
    const appSource = sourceFiles["../App.tsx"];
    const deepImportOffenders = Object.entries(sourceFiles)
      .map(([path, content]) => ({ content, projectPath: path.replace(/^\.\.\//, "") }))
      .filter(({ projectPath }) => !/\.(?:test|spec)\.tsx?$/.test(projectPath))
      .filter(({ projectPath }) => !projectPath.startsWith("features/conversations/"))
      .filter(({ content }) => /from\s+["'][^"']*features\/conversations\//.test(content))
      .map(({ projectPath }) => projectPath);

    expect(appSource).toContain('from "./features/conversations"');
    expect(appSource).not.toContain("function ChatPanel(");
    expect(deepImportOffenders, "Conversations consumers must import the public feature entry point").toEqual([]);
  });

  it("uses the public Judge feature entry point and keeps Judge UI out of App", () => {
    const appSource = sourceFiles["../App.tsx"];
    const deepImportOffenders = Object.entries(sourceFiles)
      .map(([path, content]) => ({ content, projectPath: path.replace(/^\.\.\//, "") }))
      .filter(({ projectPath }) => !/\.(?:test|spec)\.tsx?$/.test(projectPath))
      .filter(({ projectPath }) => !projectPath.startsWith("features/judge/"))
      .filter(({ content }) => /from\s+["'][^"']*features\/judge\//.test(content))
      .map(({ projectPath }) => projectPath);

    expect(appSource).toContain('from "./features/judge"');
    expect(appSource).not.toContain("function JudgeEvaluation(");
    expect(appSource).not.toContain("function BatchEvaluation(");
    expect(appSource).not.toContain("function JudgeNarrativeRow(");
    expect(sourceFiles["../components/SessionInspection.tsx"]).toContain("<JudgeResults");
    expect(deepImportOffenders, "Judge consumers must import the public feature entry point").toEqual([]);
  });

  it("keeps complete session and Judge Markdown formatting centralized", () => {
    const sessionExport = sourceFiles["../exports/session.ts"];
    const trainingExport = sourceFiles["../training/export.ts"];
    const researchExport = sourceFiles["../exports/research.ts"];

    for (const consumer of [sessionExport, trainingExport, researchExport]) {
      expect(consumer).toContain("renderCompleteSessionMarkdown");
      expect(consumer).not.toContain("score.narrative.strongestMatches");
      expect(consumer).not.toContain("score.narrative.confabulationObservations");
    }
  });
});
