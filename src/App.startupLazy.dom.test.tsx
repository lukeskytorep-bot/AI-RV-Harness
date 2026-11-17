// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";
import { AppDialogProvider } from "./components/AppDialogProvider";
import { createDefaultSettings } from "./startupDefaults";
import { BrowserSessionsRepository } from "./storage/browser/sessionsRepository";

const loading = vi.hoisted(() => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  return { gate, release, trainingLoads: vi.fn(), conversationLoads: vi.fn(), rvLoads: vi.fn() };
});
vi.mock("./features/training", () => {
  loading.trainingLoads();
  return { TrainingScreen: ({ onOperationBusyChange }: { onOperationBusyChange: (busy: boolean) => void }) =>
    <div data-testid="training-route"><button onClick={() => onOperationBusyChange(true)}>Start operation</button><button onClick={() => onOperationBusyChange(false)}>Finish operation</button></div> };
});
vi.mock("./features/conversations", async () => {
  loading.conversationLoads();
  await loading.gate;
  return { ConversationsScreen: () => <div data-testid="conversation-route">Loaded conversation</div> };
});
vi.mock("./features/rvSessions", async () => {
  loading.rvLoads();
  throw new Error("simulated chunk download failure");
});

const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previous = environment.IS_REACT_ACT_ENVIRONMENT;
environment.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); environment.IS_REACT_ACT_ENVIRONMENT = previous; });

it("defers routes, keeps navigation during loading, preserves the busy route, and recovers navigation after an import failure", async () => {
  localStorage.clear();
  const now = "2026-11-17T12:00:00Z";
  localStorage.setItem("rvh.dev.profiles", JSON.stringify([{ id: "p", name: "Test", credentialId: "key", defaultViewerModelId: "model", createdAt: now, updatedAt: now }]));
  localStorage.setItem("rvh.dev.workspaces", JSON.stringify([
    { id: "c", profileId: "p", kind: "conversation", name: "Conversation", createdAt: now, updatedAt: now, lastOpenedAt: now },
    { id: "r", profileId: "p", kind: "rv", name: "RV", createdAt: now, updatedAt: now, lastOpenedAt: now },
  ]));
  localStorage.setItem("rvh.dev.settings", JSON.stringify({ ...createDefaultSettings(), activeConversationWorkspaceId: "c", activeRvWorkspaceId: "r" }));
  let ready!: () => void;
  const initialized = new Promise<void>((resolve) => { ready = resolve; });
  const listRecent = BrowserSessionsRepository.prototype.listRecentRvSessions;
  vi.spyOn(BrowserSessionsRepository.prototype, "listRecentRvSessions").mockImplementation(async function(this: BrowserSessionsRepository, ...args) {
    const result = await listRecent.apply(this, args); ready(); return result;
  });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const nav = (label: string) => host.querySelector<HTMLButtonElement>(`.side-nav button[aria-label="${label}"]`)!;
  const click = async (label: string) => { await act(async () => nav(label).click()); };
  try {
    await act(async () => root.render(<AppDialogProvider><App /></AppDialogProvider>));
    await act(async () => { await initialized; });
    expect(host.querySelector(".home-page")).not.toBeNull();
    expect(loading.trainingLoads).not.toHaveBeenCalled();
    expect(loading.conversationLoads).not.toHaveBeenCalled();
    expect(loading.rvLoads).not.toHaveBeenCalled();

    await click("Conversations");
    expect(host.querySelector(".route-loading-state")?.textContent).toContain("Loading module");
    expect(nav("Home")).not.toBeNull();
    await click("Home");
    expect(host.querySelector(".home-page")).not.toBeNull();
    await act(async () => { loading.release(); await import("./features/conversations"); });
    await click("Conversations");
    expect(host.querySelector('[data-testid="conversation-route"]')).not.toBeNull();

    await click("Training");
    await act(async () => { await import("./features/training"); });
    const training = host.querySelector('[data-testid="training-route"]')!;
    await act(async () => (training.querySelectorAll("button")[0] as HTMLButtonElement).click());
    await click("Home");
    expect(host.querySelector('[data-testid="training-route"]')).toBe(training);
    await act(async () => (training.querySelectorAll("button")[1] as HTMLButtonElement).click());
    await click("Home");
    expect(host.querySelector(".home-page")).not.toBeNull();

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await click("RV Sessions");
    await act(async () => { await import("./features/rvSessions").catch(() => undefined); });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("This screen could not be loaded");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Reload interface");
    await click("Home");
    expect(host.querySelector(".home-page")).not.toBeNull();
  } finally { loading.release(); await act(async () => root.unmount()); host.remove(); }
});
