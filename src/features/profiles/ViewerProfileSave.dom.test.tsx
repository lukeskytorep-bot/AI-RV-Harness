// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { getCopy } from "../../i18n";
import type { AppRepository } from "../../storage/repository";
import type { ProfileSetupController } from "./useProfileSetupController";
import { useProfileSetupController } from "./useProfileSetupController";
import { ViewerRouteError } from "../../aiCenter/viewerIdentityRoute";
import { ViewerProfileSaveError } from "../../application/viewerProfileSave";
import { CreateProfileDialog } from "./ProfileDialogs";
vi.mock("./useProfileSetupController", async () => ({ ...await vi.importActual("./useProfileSetupController"), useProfileSetupController: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { document.body.innerHTML = ""; });
for (const language of ["pl", "en"] as const) it(`${language}: save failure stays visible and the same form permits retry`, async () => {
  const provider = { id: "pc", credentialId: "key", provider: "custom_openai", label: "Custom", enabled: true };
  const model = { providerConfigId: "pc", provider: "custom_openai", modelId: "gemma", route: "custom:gemma", displayName: "Gemma", capabilities: { reasoning: { supported: false, efforts: [] }, temperature: { supported: true } } };
  vi.mocked(useProfileSetupController).mockReturnValue({
    providers: [provider], models: [model], connectionChoice: "pc", selectedProvider: provider, viewerModel: model,
    providerModels: [model], visibleViewerModels: [model], providerKinds: ["custom_openai"], providerKind: "custom_openai",
    viewerModelId: "gemma", viewerReasoning: "", viewerTemperature: "0.7", viewerSystemPrompt: "", monitorModelKey: "", judgeModelKey: "", desktop: true, busy: false,
    buildAiConfiguration: () => ({ credentialId: "key", defaultViewerModelId: "gemma" }),
  } as unknown as ProfileSetupController);
  const onCreate = vi.fn().mockRejectedValueOnce(new ViewerProfileSaveError("saved-profile", new ViewerRouteError("fingerprint_unavailable"))).mockResolvedValue(undefined);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<CreateProfileDialog copy={getCopy(language)} repository={{} as AppRepository} onCreate={onCreate} onCancel={vi.fn()} />));
    const form = host.querySelector("form")!;
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(language === "pl" ? "częściowo" : "partially saved");
    expect(host.textContent).not.toContain("native-hmac");
    expect(host.querySelector<HTMLButtonElement>('button.primary-button')?.disabled).toBe(false);
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(onCreate).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  } finally { await act(async () => root.unmount()); }
});
