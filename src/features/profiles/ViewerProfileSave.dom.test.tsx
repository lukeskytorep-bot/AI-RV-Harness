// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { getCopy } from "../../i18n";
import type { AppRepository } from "../../storage/repository";
import { BrowserRepository } from "../../storage/browserRepository";
import type { ProfileSetupController } from "./useProfileSetupController";
import { useProfileSetupController } from "./useProfileSetupController";
import { ViewerRouteError } from "../../aiCenter/viewerIdentityRoute";
import { saveViewerProfile, ViewerProfileSaveError } from "../../application/viewerProfileSave";
import { CreateProfileDialog, EditProfileDialog } from "./ProfileDialogs";
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
    const checkbox = host.querySelector<HTMLInputElement>(".profile-target-code-option input")!;
    expect(checkbox.checked).toBe(false);
    await act(async () => checkbox.click());
    expect(checkbox.checked).toBe(true);
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(language === "pl" ? "częściowo" : "partially saved");
    expect(host.textContent).not.toContain("native-hmac");
    expect(host.querySelector<HTMLButtonElement>('button.primary-button')?.disabled).toBe(false);
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(onCreate).toHaveBeenCalledTimes(2);
    expect(onCreate.mock.calls.map(call => call[4])).toEqual(["without_code", "without_code"]);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  } finally { await act(async () => root.unmount()); }
});

for (const language of ["pl", "en"] as const) it(`${language}: edit restores saved mode and submits metadata without AI configuration`, async () => {
  const copy = getCopy(language);
  localStorage.clear();
  const repository = new BrowserRepository();
  const profile = await repository.createProfile({ name: "Legacy", targetCodeMode: "without_code" });
  const onSave = vi.fn(async (name: string, humanName: string | undefined, note?: string, aiConfiguration?: import("../../types").ProfileAiConfigurationInput, targetCodeMode?: import("../../domain/targetCodeMode").TargetCodeMode) => {
    await saveViewerProfile({ repository, existingProfileId: profile.id, values: { name, humanName, note, aiConfiguration, targetCodeMode } });
  }).mockRejectedValueOnce(new ViewerProfileSaveError(undefined, new Error("disk failure"), true));
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<EditProfileDialog copy={copy} profile={profile} providers={[]} models={[]} onCancel={vi.fn()} onSave={onSave} />));
    const checkbox = host.querySelector<HTMLInputElement>(".profile-target-code-option input")!;
    expect(checkbox.checked).toBe(true);
    expect(host.textContent).toContain(copy.profileWithoutTargetCodeLead);
    await act(async () => checkbox.click());
    const submit = () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await act(async () => { submit(); });
    expect(host.querySelector(".provider-error")?.textContent).toContain(language === "pl" ? "ustawień profilu" : "Profile settings");
    expect((await new BrowserRepository().listProfiles())[0].targetCodeMode).toBe("without_code");
    expect(checkbox.checked).toBe(false);
    await act(async () => { submit(); });
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenLastCalledWith("Legacy", undefined, "", undefined, "with_code");
    expect(host.querySelector(".provider-error")).toBeNull();
    const reopened = (await new BrowserRepository().listProfiles())[0];
    expect(reopened.targetCodeMode).toBe("with_code");
    await act(async () => root.render(<EditProfileDialog key="reopened" copy={copy} profile={reopened} providers={[]} models={[]} onCancel={vi.fn()} onSave={onSave} />));
    expect(host.querySelector<HTMLInputElement>(".profile-target-code-option input")!.checked).toBe(false);
  } finally { await act(async () => root.unmount()); localStorage.clear(); }
});
