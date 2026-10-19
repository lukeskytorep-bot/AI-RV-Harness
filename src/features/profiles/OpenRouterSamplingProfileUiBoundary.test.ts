import { describe, expect, it } from "vitest";

import appSource from "../../App.tsx?raw";
import dialogsSource from "./ProfileDialogs.tsx?raw";
import controlsSource from "./ProfileViewerControls.tsx?raw";
import samplingControlsSource from "./OpenRouterSamplingControls.tsx?raw";
import controllerSource from "./useProfileSetupController.ts?raw";

describe("OR-SAMPLING-3 profile UI boundaries", () => {
  it("uses the shared sampling controls in First Run, Create Profile and Edit Profile", () => {
    expect(appSource).toContain("sampling={{ enabled: setup.viewerSamplingEnabled");
    expect(dialogsSource.match(/sampling=\{\{/g)?.length).toBe(2);
    expect(controlsSource).toContain('providerKind === "openrouter" || providerKind === "custom_openai" || providerKind === "mistral"');
    expect(controlsSource).toContain("<OpenRouterSamplingControls");
  });

  it("keeps temperature outside the additional sampling contract", () => {
    expect(controlsSource).toContain("copy.viewerTemperature");
    expect(controlsSource).toContain("<OpenRouterSamplingControls");
    expect(samplingControlsSource).toContain("copy.additionalSamplingParameters");
    expect(samplingControlsSource).not.toContain("copy.viewerTemperature");
    expect(controllerSource).toContain("viewerTemperature");
    expect(controllerSource).toContain("viewerSamplingEnabled");
  });

  it("persists sampling through the shared profile configuration builder for OpenRouter, Custom and Mistral", () => {
    expect(controllerSource).toContain('selectedProvider?.provider === "openrouter" || selectedProvider?.provider === "custom_openai" || selectedProvider?.provider === "mistral"');
    expect(controllerSource).toContain("parseOpenRouterAdditionalSamplingInputs");
    expect(dialogsSource).toContain('provider?.provider === "openrouter" || provider?.provider === "custom_openai" || provider?.provider === "mistral"');
  });
});
