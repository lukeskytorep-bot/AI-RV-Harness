// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TelepathicHistory } from "./TelepathicHistory";

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const items = [
  { id: "active", name: "Active series", status: "paused", updatedAt: "2026-10-12T12:00:00Z" },
  { id: "archive", name: "Archived series", status: "blocked", updatedAt: "2026-10-11T12:00:00Z", archivedAt: "2026-10-11T12:00:00Z" },
];

for (const pl of [false, true]) for (const sessionKind of ["training", "exchange"] as const) {
  it(`shows all entries, preserves cards when collapsed and keeps actions distinct: ${sessionKind}/${pl ? "PL" : "EN"}`, async () => {
    const onOpen = vi.fn(), onSave = vi.fn(), onArchive = vi.fn();
    await act(async () => root.render(<TelepathicHistory {...{ pl, sessionKind, items, onOpen, onSave, onArchive }} busy={false} />));
    expect(host.querySelector('input[type="checkbox"]')).toBeNull();
    const cards = host.querySelectorAll("article"); expect(cards).toHaveLength(2);
    expect(cards[1].textContent).toContain(pl ? "Zarchiwizowano" : "Archived");
    expect(cards[0].querySelector(".training-history-title")?.textContent).toBe("Active series");
    const buttons = cards[1].querySelectorAll<HTMLButtonElement>(".training-run-header button"); expect(buttons).toHaveLength(3);
    await act(async () => { buttons[0].focus(); });
    expect(document.body.querySelector('[role="tooltip"]')?.textContent).toBe(buttons[0].getAttribute("aria-label"));
    await act(async () => { buttons[0].click(); buttons[1].click(); buttons[2].click(); });
    expect(onOpen).toHaveBeenCalledWith("archive"); expect(onSave).toHaveBeenCalledWith("archive"); expect(onArchive).toHaveBeenCalledWith("archive", false);
    const toggle = host.querySelector<HTMLButtonElement>(".training-history-toggle")!;
    const panel = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(panel).toBe(host.querySelector("aside")); expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await act(async () => toggle.click()); expect(panel.hidden).toBe(true); expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await act(async () => toggle.click()); expect(panel.hidden).toBe(false); expect(host.querySelectorAll("article")[1]).toBe(cards[1]);
  });
}
it("disables history mutations during a request while retaining local collapse", async () => {
  const onOpen = vi.fn(), onSave = vi.fn(), onArchive = vi.fn();
  await act(async () => root.render(<TelepathicHistory {...{ items, onOpen, onSave, onArchive }} pl={false} busy />));
  const actions = host.querySelectorAll<HTMLButtonElement>("article button"); expect([...actions].every(b => b.disabled)).toBe(true);
  await act(async () => { actions.forEach(b => b.click()); host.querySelector<HTMLButtonElement>(".training-history-toggle")!.click(); });
  expect(onOpen).not.toHaveBeenCalled(); expect(onSave).not.toHaveBeenCalled(); expect(onArchive).not.toHaveBeenCalled();
  expect(host.querySelector("aside")?.hidden).toBe(true);
});
it("keeps collapse local and accessible IDs distinct when both histories are mounted", async () => {
  const props = { items, pl: false, busy: false, onOpen() {}, onSave() {}, onArchive() {} };
  await act(async () => root.render(<><TelepathicHistory {...props} /><TelepathicHistory {...props} sessionKind="exchange" /></>));
  const toggles = host.querySelectorAll<HTMLButtonElement>(".training-history-toggle");
  expect(toggles[0].getAttribute("aria-controls")).not.toBe(toggles[1].getAttribute("aria-controls"));
  await act(async () => toggles[0].click()); expect(toggles[1].getAttribute("aria-expanded")).toBe("true");
});
