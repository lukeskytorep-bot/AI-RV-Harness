import { describe, expect, it } from "vitest";

const sourceFiles = import.meta.glob<string>("./**/*.{ts,tsx}", {
  eager: true,
  import: "default",
  query: "?raw",
});

const SHARED_DIALOG_FILE = "./components/AppDialogProvider.tsx";

describe("application dialog architecture", () => {
  it("keeps browser-native confirm/prompt/alert calls inside the shared dialog provider only", () => {
    const offenders = Object.entries(sourceFiles)
      .filter(([path]) => !/\.(?:test|spec)\.tsx?$/.test(path))
      .filter(([path]) => path !== SHARED_DIALOG_FILE)
      .filter(([, source]) => /(?:window|globalThis)\.(?:confirm|prompt|alert)\s*\(/.test(source))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("mounts one AppDialogProvider around the application root", () => {
    const main = sourceFiles["./main.tsx"] ?? "";
    expect(main).toContain("<AppDialogProvider>");
    expect(main).toContain("</AppDialogProvider>");
    expect(main).toContain("<App />");
  });

  it("uses the shared dialog hook in every migrated native-dialog consumer", () => {
    for (const path of [
      "./components/ProviderSettings.tsx",
      "./features/profiles/ProfilesScreen.tsx",
      "./features/workspaces/WorkspacesScreen.tsx",
      "./features/conversations/ChatPanel.tsx",
      "./features/targets/TargetsScreen.tsx",
      "./features/settings/SettingsScreen.tsx",
      "./features/aiCenter/AiCenterScreen.tsx",
      "./features/research/ResearchBuilder.tsx",
    ]) {
      expect(sourceFiles[path], `${path} must use the shared app dialog hook`).toContain("useAppDialogs");
    }
  });
});
