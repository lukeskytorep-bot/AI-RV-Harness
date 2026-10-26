// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import App from "./App";
import { AppDialogProvider } from "./components/AppDialogProvider";
import { createDefaultSettings } from "./startupDefaults";

it("App startup persists the 16K Conversation and RV Sessions floors even when the old Conversation marker is already current", async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  localStorage.setItem("rvh.dev.settings", JSON.stringify({
    ...createDefaultSettings(),
    conversationOutputBudgetVersion: 1,
    conversationMaxOutputTokens: 8192,
    rvSessionMaxOutputTokens: 8192,
  }));
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<AppDialogProvider><App /></AppDialogProvider>));
    await vi.waitFor(() => {
      const stored = JSON.parse(localStorage.getItem("rvh.dev.settings") ?? "{}") as Record<string, unknown>;
      expect(stored.conversationMaxOutputTokens).toBe(16384);
      expect(stored.rvSessionMaxOutputTokens).toBe(16384);
      expect(stored.defaultMaxOutputTokens).toBe(8192);
    }, { timeout: 5000 });
  } finally { await act(async () => root.unmount()); host.remove(); localStorage.clear(); }
});
