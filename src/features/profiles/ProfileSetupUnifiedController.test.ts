import { describe, expect, it } from "vitest";

import appSource from "../../App.tsx?raw";
import workspaceI18n from "../../i18n/workspace.ts?raw";
import profileDialogs from "./ProfileDialogs.tsx?raw";
import profilesIndex from "./index.ts?raw";
import controllerSource from "./useProfileSetupController.ts?raw";

describe("PROFILE-SETUP-UNIFIED-CONTROLLER-1 boundaries", () => {
  it("keeps provider/model setup in the shared Profiles controller", () => {
    expect(controllerSource).toContain("export function useProfileSetupController");
    expect(controllerSource).toContain("addProvider(repository");
    expect(controllerSource).toContain("refreshProviderModels(repository, provider)");
    expect(controllerSource).toContain("buildProfileAiConfiguration(");
    expect(controllerSource).not.toContain("createProfileWithInitialWorkspace");
    expect(controllerSource).not.toContain("repository.updateProfile");
    expect(controllerSource).not.toContain("repository.setProfileAiConfiguration");
  });

  it("uses the public Profiles entry point from First Run", () => {
    expect(profilesIndex).toContain("useProfileSetupController");
    expect(appSource).toContain('from "./features/profiles"');
    expect(appSource).toContain("useProfileSetupController({ copy, repository, existingProfile })");
    expect(appSource).not.toContain('from "./features/profiles/useProfileSetupController"');
    expect(appSource).not.toContain("addProvider(repository");
    expect(appSource).not.toContain("refreshProviderModels(repository");
  });

  it("routes First Run connection changes through the shared reset invariant", () => {
    expect(appSource).toContain('onChange={(event) => setup.changeConnection(event.target.value)}');
    expect(appSource).not.toContain('setup.setConnectionChoice(');
    expect(controllerSource).toContain('changeConnection: (providerId: string) => void;');
    expect(controllerSource).toContain('const changeConnection = (providerId: string) => {');
    expect(controllerSource).toContain('resetViewerSelections();');
    expect(controllerSource).not.toContain('resetAi');
    expect(controllerSource).not.toContain('setConnectionChoice: (value: string) => void;');
    expect(controllerSource).not.toContain('    setConnectionChoice,\n');
  });

  it("keeps the existing three-step First Run surface", () => {
    expect(appSource).toContain('useState<1 | 2 | 3>(1)');
    expect(appSource).toContain("copy.setupProvider");
    expect(appSource).toContain("copy.setupViewer");
    expect(appSource).toContain("copy.setupRoles");
    expect(appSource).toContain("<ProfileViewerControls");
    expect(appSource).toContain('role="judge"');
    expect(appSource).toContain('role="monitor"');
  });

  it("adds a collapsed Advanced section to Create Profile without a second provider engine", () => {
    const createStart = profileDialogs.indexOf("export function CreateProfileDialog");
    const editStart = profileDialogs.indexOf("export interface EditProfileDialogProps");
    const createSource = profileDialogs.slice(createStart, editStart);
    expect(createSource).toContain("useProfileSetupController({ copy, repository })");
    expect(createSource).toContain("copy.advancedOptions");
    expect(createSource).toContain("copy.addConnectionApiKey");
    expect(createSource).toContain('aria-expanded={advancedOpen}');
    expect(createSource).toContain("copy.advancedOptionsConfigured");
    expect(createSource).toContain("setup.resetAdvancedOptions");
    expect(createSource).not.toContain("addProvider(");
    expect(createSource).not.toContain("refreshProviderModels(");
    expect(createSource).not.toContain("defaultViewerSystemPrompt");
  });

  it("does not roll back a consciously created global provider when Profile creation is cancelled", () => {
    expect(controllerSource).not.toContain("removeProvider(");
    expect(controllerSource).not.toContain("deleteProviderConfig(");
    expect(profileDialogs).not.toContain("removeProvider(");
  });

  it("keeps Polish and English Advanced labels paired", () => {
    for (const key of [
      "advancedOptions",
      "hideAdvancedOptions",
      "advancedOptionsConfigured",
      "advancedOptionsLead",
      "resetAdvancedOptions",
      "addConnectionApiKey",
    ]) {
      expect(workspaceI18n.match(new RegExp(`${key}:`, "g"))?.length).toBe(2);
    }
    expect(workspaceI18n).toContain('advancedOptions: "Advanced options"');
    expect(workspaceI18n).toContain('advancedOptions: "Opcje zaawansowane"');
  });
});
