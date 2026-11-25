// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { ResearchConfigBuilder } from "./ResearchBuilder";
import { getCopy } from "../../i18n";
import { createDefaultSettings } from "../../startupDefaults";
import type { AppRepository } from "../../storage/repository";
import type { ProviderConfig, ProviderModel } from "../../providers/types";
import type { Profile, Workspace } from "../../types";
import type { TargetRecord } from "../../targets/types";

const now = "2026-09-15T12:00:00.000Z";
const profile: Profile = { id: "profile-a", name: "Orion", credentialId: "cred-a", createdAt: now, updatedAt: now };
const workspace: Workspace = { id: "workspace-a", profileId: profile.id, name: "Workspace 1", kind: "rv", createdAt: now, updatedAt: now, lastOpenedAt: now };

function fixtures(providerKind: "custom_openai" | "openrouter") {
  const provider: ProviderConfig = {
    id: "pc-a", provider: providerKind, label: providerKind, credentialId: "cred-a",
    credentialFingerprint: "fingerprint", enabled: true, lastStatus: "ok", createdAt: now, updatedAt: now,
  };
  const model: ProviderModel = {
    providerConfigId: provider.id, provider: providerKind, modelId: "model-a", displayName: "Model A", route: `${providerKind}:model-a`,
    capabilities: {
      inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true,
      reasoning: { supported: false, efforts: [], confidence: "unknown" },
      temperature: { supported: false, confidence: "unknown" }, supportedParameters: [], contextTokens: 100000,
      maxOutputTokens: 4096, source: "provider", capturedAt: now,
    },
    pricing: {}, recommended: true, rawMetadata: {}, refreshedAt: now,
  };
  return { provider, model };
}

const target: TargetRecord = { id: "target-a", collection: "training", title: "Target", revealText: "A mountain", tags: [], sourceMetadata: {}, createdAt: now, updatedAt: now };

async function withBuilder(language: "en" | "pl", targets: TargetRecord[], test: (host: HTMLDivElement, copy: ReturnType<typeof getCopy>, onLocked: () => Promise<void>) => Promise<void>) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("crypto", webcrypto);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const { provider, model } = fixtures("openrouter");
  const copy = getCopy(language);
  const onLocked = vi.fn(async () => undefined);
  try {
    await act(async () => {
      root.render(<ResearchConfigBuilder copy={copy} settings={{ ...createDefaultSettings(), interfaceLanguage: language }}
        repository={{} as AppRepository} profiles={[profile]} workspaces={[workspace]} providers={[provider]} models={[model]}
        targets={targets} usage={[]} template="practice" onBack={() => undefined} onLocked={onLocked} />);
    });
    await test(host, copy, onLocked);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
}

function button(host: HTMLElement, text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.textContent?.trim() === text && !element.closest("[hidden]"));
  if (!found) throw new Error(`Missing visible button: ${text}`);
  return found;
}

async function click(element: HTMLElement) {
  await act(async () => { element.click(); });
}

async function waitForStage(host: HTMLElement, index: number) {
  await vi.waitFor(async () => {
    await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 5)); });
    expect(host.querySelectorAll(".research-builder-steps button")[index].getAttribute("aria-current")).toBe("step");
  });
}

describe("Research preparation stages", () => {
  it.each(["en", "pl"] as const)("separates stages and preserves the editable draft (%s)", async (language) => {
    await withBuilder(language, [target], async (host, copy, onLocked) => {
      const form = host.querySelector<HTMLElement>(".research-form-panel")!;
      const notesOff = form.querySelector<HTMLInputElement>('input[name="research-viewer-notes"]')!;
      const guideOff = form.querySelector<HTMLInputElement>('input[name="research-field-guide"]')!;
      expect(form.hidden).toBe(false);
      expect(host.querySelector(".research-review-panel")).toBeNull();
      expect([...host.querySelectorAll("button")].some((element) => element.textContent?.trim() === copy.experimentLock)).toBe(false);
      await click(notesOff);
      await click(guideOff);
      await click(button(host, copy.researchStagePreview));
      await waitForStage(host, 1);
      expect(form.hidden).toBe(true);
      expect(host.querySelector(".research-review-panel")).not.toBeNull();
      expect(host.querySelector(".preflight-list")).toBeNull();
      await click(button(host, copy.runPreflight));
      await waitForStage(host, 2);
      expect(host.querySelector(".preflight-list")).not.toBeNull();
      expect(button(host, copy.experimentLock).disabled).toBe(false);
      await click(button(host, copy.researchEditConfiguration));
      await waitForStage(host, 0);
      expect(form.hidden).toBe(false);
      expect(notesOff.checked).toBe(true);
      expect(guideOff.checked).toBe(true);
      expect(host.querySelector(".research-review-panel")).toBeNull();
      expect([...host.querySelectorAll<HTMLButtonElement>(".research-builder-steps button")].slice(1).every((element) => element.disabled)).toBe(true);
      expect(onLocked).not.toHaveBeenCalled();
    });
  });

  it("keeps a failed preview in the configuration stage without enabling Preflight", async () => {
    await withBuilder("en", [], async (host, copy, onLocked) => {
      await click(button(host, copy.researchStagePreview));
      await vi.waitFor(() => expect(host.querySelector('[role="alert"]')).not.toBeNull());
      await waitForStage(host, 0);
      expect(host.querySelector(".research-review-panel")).toBeNull();
      expect([...host.querySelectorAll<HTMLButtonElement>(".research-builder-steps button")].slice(1).every((element) => element.disabled)).toBe(true);
      expect(onLocked).not.toHaveBeenCalled();
    });
  });
});
