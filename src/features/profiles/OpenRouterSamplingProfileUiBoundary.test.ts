import { describe, expect, it } from "vitest";

import appSource from "../../App.tsx?raw";
import dialogsSource from "./ProfileDialogs.tsx?raw";
import controlsSource from "./ProfileViewerControls.tsx?raw";
import controllerSource from "./useProfileSetupController.ts?raw";

describe("OR-SAMPLING-3 profile UI boundaries", () => {
  it("uses the shared sampling controls in First Run, Create Profile and Edit Profile", () => {
    expect(appSource).toContain("sampling={{ enabled: setup.viewerSamplingEnabled");
    expect(dialogsSource.match(/sampling=\{\{/g)?.length).toBe(2);
    expect(controlsSource).toContain('providerKind === "openrouter"');
    expect(controlsSource).toContain("<OpenRouterSamplingControls");
  });

  it("keeps temperature outside the additional sampling contract", () => {
    expect(controlsSource).toContain("copy.viewerTemperature");
    expect(controlsSource).toContain("copy.additionalSamplingParameters");
    expect(controllerSource).toContain("viewerTemperature");
    expect(controllerSource).toContain("viewerSamplingEnabled");
  });

  it("persists sampling through the shared profile configuration builder only for OpenRouter", () => {
    expect(controllerSource).toContain('selectedProvider?.provider === "openrouter"');
    expect(controllerSource).toContain("parseOpenRouterAdditionalSamplingInputs");
    expect(dialogsSource).toContain('provider?.provider === "openrouter" ? parseOpenRouterAdditionalSamplingInputs');
  });
});
