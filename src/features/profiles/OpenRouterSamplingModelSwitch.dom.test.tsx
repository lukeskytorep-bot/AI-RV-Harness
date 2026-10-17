// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getCopy } from "../../i18n";
import type { ProviderConfig, ProviderModel } from "../../providers/types";
import type { Profile, ProfileAiConfigurationInput } from "../../types";
import { EditProfileDialog } from "./ProfileDialogs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { document.body.innerHTML = ""; });

const now = "2026-10-17T18:00:00.000Z";
const provider: ProviderConfig = {
  id: "openrouter-1",
  provider: "openrouter",
  label: "OpenRouter",
  credentialId: "credential-1",
  enabled: true,
  createdAt: now,
  updatedAt: now,
};

function samplingModel(modelId: string, state: "supported" | "unsupported" | "unknown"): ProviderModel {
  const supported = state === "supported" ? ["temperature", "top_p", "top_k", "seed"] : ["temperature"];
  return {
    providerConfigId: provider.id,
    provider: "openrouter",
    modelId,
    displayName: modelId,
    route: modelId,
    capabilities: {
      inputModalities: ["text"],
      outputModalities: ["text"],
      supportsVision: false,
      supportsStreaming: true,
      reasoning: { supported: false, efforts: [], confidence: "provider_metadata", registryStatus: "unknown" },
      temperature: { supported: true, min: 0, max: 2, default: 0.7, confidence: "provider_metadata" },
      supportedParameters: state === "supported" ? supported : ["temperature"],
      source: "provider",
      capturedAt: now,
    },
    pricing: {},
    recommended: false,
    rawMetadata: state === "unknown" ? {} : { supported_parameters: supported },
    refreshedAt: now,
  };
}

const profile: Profile = {
  id: "profile-1",
  name: "Viewer",
  credentialId: provider.credentialId,
  credentialProvider: "openrouter",
  defaultViewerModelId: "supported-a",
  defaultViewerTemperature: 0.7,
  defaultViewerOpenRouterSampling: { enabled: true, topP: 0.04, topK: 0, seed: 42 },
  createdAt: now,
  updatedAt: now,
};

function viewerModelSelect(host: HTMLElement): HTMLSelectElement {
  const select = Array.from(host.querySelectorAll("select")).find((candidate) =>
    Array.from(candidate.options).some((option) => option.value === "unsupported")
  );
  if (!select) throw new Error("Viewer model selector not found");
  return select;
}

async function changeSelect(select: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function submit(host: HTMLElement): Promise<void> {
  await act(async () => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("OpenRouter sampling model changes", () => {
  it("preserves manual values across Supported → Unsupported/Unknown → Supported and blocks incompatible saves", async () => {
    const models = [
      samplingModel("supported-a", "supported"),
      samplingModel("unsupported", "unsupported"),
      samplingModel("unknown", "unknown"),
      samplingModel("supported-b", "supported"),
    ];
    const onSave = vi.fn(async (_name: string, _humanName: string | undefined, _note?: string, _ai?: ProfileAiConfigurationInput) => undefined);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<EditProfileDialog copy={getCopy("en")} profile={profile} providers={[provider]} models={models} onCancel={vi.fn()} onSave={onSave} />));
      const select = viewerModelSelect(host);

      expect(host.querySelector<HTMLInputElement>('input[aria-label="Top P value"]')?.value).toBe("0.04");
      expect(host.querySelector<HTMLInputElement>('input[aria-label="Top K value"]')?.value).toBe("0");
      expect(host.querySelector<HTMLInputElement>('input[aria-label="Seed value"]')?.value).toBe("42");

      await changeSelect(select, "unsupported");
      expect(host.querySelector<HTMLInputElement>('input[aria-label="Top P value"]')?.value).toBe("0.04");
      expect(host.querySelector<HTMLInputElement>('input[aria-label="Top P value"]')?.disabled).toBe(true);
      await submit(host);
      expect(onSave).not.toHaveBeenCalled();
      expect(host.querySelector(".provider-error")?.textContent).toContain(`Top P: ${getCopy("en").samplingUnsupported}`);

      await changeSelect(select, "unknown");
      expect(host.querySelector<HTMLInputElement>('input[aria-label="Top K value"]')?.value).toBe("0");
      await submit(host);
      expect(onSave).not.toHaveBeenCalled();
      expect(host.querySelector(".provider-error")?.textContent).toContain(`Top P: ${getCopy("en").samplingUnknown}`);

      await changeSelect(select, "supported-b");
      expect(host.querySelector<HTMLInputElement>('input[aria-label="Top P value"]')?.value).toBe("0.04");
      expect(host.querySelector<HTMLInputElement>('input[aria-label="Top K value"]')?.value).toBe("0");
      expect(host.querySelector<HTMLInputElement>('input[aria-label="Seed value"]')?.value).toBe("42");
      expect(host.querySelector<HTMLInputElement>('input[aria-label="Top P value"]')?.disabled).toBe(false);
      await submit(host);
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave.mock.calls[0][3]?.defaultViewerOpenRouterSampling).toEqual({ enabled: true, topP: 0.04, topK: 0, seed: 42 });
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("lets the user explicitly return an incompatible manual parameter to Auto", async () => {
    const models = [samplingModel("supported-a", "supported"), samplingModel("unsupported", "unsupported")];
    const topPOnlyProfile: Profile = { ...profile, defaultViewerOpenRouterSampling: { enabled: true, topP: 0.04 } };
    const onSave = vi.fn(async (_name: string, _humanName: string | undefined, _note?: string, _ai?: ProfileAiConfigurationInput) => undefined);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<EditProfileDialog copy={getCopy("en")} profile={topPOnlyProfile} providers={[provider]} models={models} onCancel={vi.fn()} onSave={onSave} />));
      await changeSelect(viewerModelSelect(host), "unsupported");
      const autoButton = host.querySelector<HTMLButtonElement>('button[aria-label="Set Auto: Top P"]')!;
      expect(autoButton).not.toBeNull();
      await act(async () => { autoButton.click(); });
      expect(host.querySelector<HTMLInputElement>('input[aria-label="Top P value"]')?.value).toBe("");
      expect(host.textContent).toContain(getCopy("en").samplingAutoInactive);
      await submit(host);
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave.mock.calls[0][3]?.defaultViewerOpenRouterSampling).toEqual({ enabled: true });
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("allows save on an unsupported model when the section is disabled without deleting remembered values", async () => {
    const models = [samplingModel("supported-a", "supported"), samplingModel("unsupported", "unsupported")];
    const onSave = vi.fn(async (_name: string, _humanName: string | undefined, _note?: string, _ai?: ProfileAiConfigurationInput) => undefined);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<EditProfileDialog copy={getCopy("en")} profile={profile} providers={[provider]} models={models} onCancel={vi.fn()} onSave={onSave} />));
      await changeSelect(viewerModelSelect(host), "unsupported");
      const checkbox = host.querySelector<HTMLInputElement>('.sampling-enable-row input[type="checkbox"]')!;
      await act(async () => { checkbox.click(); });
      expect(checkbox.checked).toBe(false);
      await submit(host);
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave.mock.calls[0][3]?.defaultViewerOpenRouterSampling).toEqual({ enabled: false, topP: 0.04, topK: 0, seed: 42 });
    } finally {
      await act(async () => root.unmount());
    }
  });
});
