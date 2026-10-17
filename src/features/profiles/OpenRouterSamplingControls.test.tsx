import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { getCopy } from "../../i18n";
import type { ProviderModel } from "../../providers/types";
import { OpenRouterSamplingControls } from "./OpenRouterSamplingControls";

const model = (supported: string[] | undefined): ProviderModel => ({
  providerConfigId: "openrouter",
  provider: "openrouter",
  modelId: "model",
  displayName: "Model",
  route: "model",
  capabilities: {
    inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true,
    reasoning: { supported: false, efforts: [], confidence: "unknown" },
    temperature: { supported: true, confidence: "provider_metadata" },
    supportedParameters: supported ?? [], source: "provider", capturedAt: "now",
  },
  pricing: {}, recommended: false,
  rawMetadata: supported === undefined ? {} : { supported_parameters: supported },
  refreshedAt: "now",
});

function render(supported: string[] | undefined, enabled = true) {
  return renderToStaticMarkup(<OpenRouterSamplingControls
    copy={getCopy("en")} model={model(supported)} enabled={enabled} topP="0.04" topK="0" seed="42"
    onEnabled={vi.fn()} onTopP={vi.fn()} onTopK={vi.fn()} onSeed={vi.fn()}
  />);
}

describe("OpenRouter sampling controls", () => {
  it("shows confirmed parameters as editable while preserving zero as a manual value", () => {
    const html = render(["temperature", "top_p", "top_k", "seed"]);
    expect(html).toContain("Additional Sampling Parameters");
    expect(html).toContain('value="0.04"');
    expect(html).toContain('value="0"');
    expect(html).toContain('value="42"');
    expect(html).toContain("Supported");
  });

  it("disables unsupported manual controls instead of deleting stored values", () => {
    const html = render(["temperature"]);
    expect(html).toContain("Unsupported");
    expect(html).toContain('value="42"');
    expect(html).toContain("disabled");
  });

  it("labels missing provider metadata as unknown", () => {
    expect(render(undefined)).toContain("Unknown");
  });
});
