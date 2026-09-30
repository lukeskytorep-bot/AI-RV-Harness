import { describe, expect, it } from "vitest";

const sourceFiles = import.meta.glob<string>("./**/*.{ts,tsx}", {
  eager: true,
  import: "default",
  query: "?raw",
});

const protectedProductionFiles = [
  "./App.tsx",
  "./features/profiles/ProfileDialogs.tsx",
  "./features/rvSessions/RvSessionPanel.tsx",
  "./features/training/TrainingScreen.tsx",
  "./features/judge/JudgeEvaluation.tsx",
  "./features/research/ResearchBuilder.tsx",
  "./research/engine.ts",
  "./research/preflight.ts",
];

describe("model route architecture", () => {
  it("keeps providerConfigId::modelId construction in the canonical modelRoutes helper", () => {
    const offenders = protectedProductionFiles.filter((path) => {
      const content = sourceFiles[path] ?? "";
      return /providerConfigId[^\n]{0,80}::|::[^\n]{0,80}modelId/.test(content)
        || /function\s+(?:modelKey|routeKey)\s*\(/.test(content)
        || /const\s+(?:modelKey|routeKey|keyFor)\s*=/.test(content);
    });
    expect(offenders).toEqual([]);
  });

  it("uses the shared ModelRouteSelect in every role/model UI that stores a route key", () => {
    for (const path of [
      "./App.tsx",
      "./features/profiles/ProfileDialogs.tsx",
      "./features/rvSessions/RvSessionPanel.tsx",
      "./features/training/TrainingScreen.tsx",
      "./features/judge/JudgeEvaluation.tsx",
      "./features/research/ResearchBuilder.tsx",
    ]) {
      expect(sourceFiles[path], `${path} must use ModelRouteSelect`).toContain("ModelRouteSelect");
    }
  });
});
