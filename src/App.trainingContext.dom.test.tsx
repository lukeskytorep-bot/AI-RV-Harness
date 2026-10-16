// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import App from "./App";
import { AppDialogProvider } from "./components/AppDialogProvider";
import { BrowserSessionsRepository } from "./storage/browser/sessionsRepository";
import { getCopy } from "./i18n";
import { createDefaultSettings } from "./startupDefaults";

for (const language of ["en", "pl"] as const) it(`T5 ${language}: navigating the real App to Training removes the unrelated Conversation breadcrumb`, async () => {
 const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
 const previous = environment.IS_REACT_ACT_ENVIRONMENT; environment.IS_REACT_ACT_ENVIRONMENT = true;
 localStorage.clear();
 const profile = { id: "p", name: "Global Conversation Profile", credentialId: "key", defaultViewerModelId: "model", createdAt: "2026-10-16", updatedAt: "2026-10-16" };
 localStorage.setItem("rvh.dev.profiles", JSON.stringify([profile]));
 localStorage.setItem("rvh.dev.workspaces", JSON.stringify([{ id: "cw", profileId: "p", kind: "conversation", name: "Unrelated Conversation Workspace", createdAt: "2026-10-16", updatedAt: "2026-10-16", lastOpenedAt: "2026-10-16" }]));
 localStorage.setItem("rvh.dev.settings", JSON.stringify({ ...createDefaultSettings(), interfaceLanguage: language, activeConversationWorkspaceId: "cw" }));
 let loaded!: () => void; const ready = new Promise<void>(resolve => { loaded = resolve; });
 const original = BrowserSessionsRepository.prototype.listRecentRvSessions;
 const loadedSpy = vi.spyOn(BrowserSessionsRepository.prototype, "listRecentRvSessions").mockImplementation(async function(this: BrowserSessionsRepository, workspaceIds, limit) { const result = await original.call(this, workspaceIds, limit); loaded(); return result; });
 const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
 try {
  await act(async () => root.render(<AppDialogProvider><App /></AppDialogProvider>));
  await act(async () => { await ready; });
  expect(host.querySelector(".topbar .crumbs")?.textContent).toContain("Unrelated Conversation Workspace");
  const nav = host.querySelector(`.side-nav button[aria-label="${getCopy(language).training}"]`) as HTMLButtonElement | null;
  expect(nav).not.toBeNull();
  await act(async () => nav!.click());
  const crumbs = host.querySelector(".topbar .crumbs")!.textContent;
  expect(crumbs).toBe(getCopy(language).training);
  expect(crumbs).not.toContain("Global Conversation Profile"); expect(crumbs).not.toContain("Unrelated Conversation Workspace");
  expect(host.querySelector(".training-config")?.textContent).toContain(language === "pl" ? "Ustawienia nowego treningu" : "New training settings");
 } finally { await act(async () => root.unmount()); host.remove(); loadedSpy.mockRestore(); localStorage.clear(); environment.IS_REACT_ACT_ENVIRONMENT = previous; }
});
