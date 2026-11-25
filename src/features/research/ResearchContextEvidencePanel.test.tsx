// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import type { SessionEventRecord } from "../../sessions/types";
import type { AppRepository } from "../../storage/repository";
import { ResearchContextEvidencePanel } from "./ResearchContextEvidencePanel";

const evidence = (content: string) => JSON.stringify({
  version: 1,
  requestedMaxOutputTokens: 16000,
  effectiveMaxOutputTokens: 32000,
  messagesSha256: "a".repeat(64),
  messages: [{ index: 0, role: "system", content, sha256: "b".repeat(64) }],
});

describe("ResearchContextEvidencePanel", () => {
  it("shows physical retries, recovery and exact request message text for a selected session", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const repository: Pick<AppRepository, "listSessionEvents"> = {
      listSessionEvents: async () => [
        { id: "e1", sessionId: "s", sequenceNumber: 1, createdAt: "now", eventType: "RESEARCH_CONTEXT_REQUEST_EVIDENCE_V1", role: "controller", content: evidence("  exact text\nline two  "), metadata: { logicalRequestId: "l1", physicalAttempt: 1, physicalAttemptId: "l1:1", stepId: "lite:1", recoveryLevel: 0, semanticAttempt: 1 } },
        { id: "e2", sessionId: "s", sequenceNumber: 2, createdAt: "now", eventType: "RESEARCH_CONTEXT_REQUEST_EVIDENCE_V1", role: "controller", content: evidence("  exact text\nline two  "), metadata: { logicalRequestId: "l1", physicalAttempt: 2, physicalAttemptId: "l1:2", stepId: "lite:1", recoveryLevel: 0, semanticAttempt: 1 } },
        { id: "e3", sessionId: "s", sequenceNumber: 3, createdAt: "now", eventType: "RESEARCH_CONTEXT_REQUEST_EVIDENCE_V1", role: "controller", content: evidence("recovery"), metadata: { logicalRequestId: "l2", physicalAttempt: 1, physicalAttemptId: "l2:1", stepId: "lite:1", recoveryLevel: 1, semanticAttempt: 2 } },
      ],
    };
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    try {
      await act(async () => { root.render(<ResearchContextEvidencePanel repository={repository} sessionId="s" pl={false} />); await Promise.resolve(); });
      expect(host.textContent).toContain("3 physical attempts");
      expect(host.textContent).toContain("Transport retries1");
      expect(host.textContent).toContain("Recovery attempts1");
      const pre = host.querySelector("pre");
      expect(pre?.textContent).toBe("  exact text\nline two  ");
      expect(host.textContent).toContain("Requested output token limit16000");
      expect(host.textContent).toContain("Effective output token limit32000");
      expect(host.textContent).toContain("a".repeat(64));
      await act(async () => { root.render(<ResearchContextEvidencePanel repository={repository} sessionId="s" pl />); });
      expect(host.textContent).toContain("Żądany limit tokenów wyjścia16000");
      expect(host.textContent).not.toContain("Physical attempt ID");
      expect(host.querySelector("pre")?.textContent).toBe("  exact text\nline two  ");
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});


describe("Evidence loading diagnostics", () => {
  it.each([true, false])("separates pending, empty, malformed and failed reads (pl=%s)", async (pl) => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const pending = new Map<string, { resolve: (events: SessionEventRecord[]) => void; reject: (reason: Error) => void }>();
    const listSessionEvents: AppRepository["listSessionEvents"] = (id) => new Promise<SessionEventRecord[]>((resolve, reject) => { pending.set(id, { resolve, reject }); });
    const repository: Pick<AppRepository, "listSessionEvents"> = { listSessionEvents };
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    const render = (id: string) => act(async () => { root.render(<ResearchContextEvidencePanel repository={repository} sessionId={id} pl={pl} />); });
    const event: SessionEventRecord = { id: "e", sessionId: "a", sequenceNumber: 1, createdAt: "now", eventType: "RESEARCH_CONTEXT_REQUEST_EVIDENCE_V1", content: evidence("session A only") };
    try {
      await render("a");
      expect(host.textContent).toContain(pl ? "Wczytywanie dowodów" : "Loading request evidence");
      expect(host.textContent).not.toContain(pl ? "Brak zapisanych" : "No request evidence records");
      await act(async () => { pending.get("a")!.resolve([event]); });
      expect(host.textContent).toContain("session A only");
      await render("b");
      expect(host.textContent).not.toContain("session A only");
      await render("c");
      await act(async () => { pending.get("b")!.resolve([{ ...event, sessionId: "b", content: evidence("late B") }]); });
      expect(host.textContent).not.toContain("late B");
      await act(async () => { pending.get("c")!.resolve([event, { ...event, id: "bad", sessionId: "c", content: "invalid JSON" }]); });
      expect(host.textContent).toContain(pl ? "Brak czytelnych dowodów dla tej sesji. Pominięto 2 zapisów." : "No readable evidence for this session. 2 records omitted.");
      expect(host.textContent).not.toContain(pl ? "Brak zapisanych" : "No request evidence records");
      expect(host.querySelector("pre")).toBeNull();
      await render("empty");
      await act(async () => { pending.get("empty")!.resolve([]); });
      expect(host.textContent).toContain(pl ? "Brak zapisanych" : "No request evidence records");
      await render("d");
      await act(async () => { pending.get("d")!.reject(new Error("raw failure")); });
      expect(host.querySelector('[role="alert"]')?.textContent).toContain("raw failure");
      expect(host.textContent).not.toContain(pl ? "Brak zapisanych" : "No request evidence records");
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});


describe("Evidence refresh and repository identity", () => {
  it("refreshes the same session and ignores a late response from another repository", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const event: SessionEventRecord = { id: "e", sessionId: "s", sequenceNumber: 1, createdAt: "now", eventType: "RESEARCH_CONTEXT_REQUEST_EVIDENCE_V1", content: evidence("initial") };
    let calls = 0;
    let resolveLate: (events: SessionEventRecord[]) => void = () => { throw new Error("not started"); };
    const first: Pick<AppRepository, "listSessionEvents"> = { listSessionEvents: async () => {
      calls += 1;
      if (calls === 1) return [event];
      if (calls === 2) return [event, { ...event, id: "e2", sequenceNumber: 2, content: evidence("new record") }];
      return new Promise<SessionEventRecord[]>((resolve) => { resolveLate = resolve; });
    } };
    const second: Pick<AppRepository, "listSessionEvents"> = { listSessionEvents: async () => [{ ...event, content: evidence("other repository") }] };
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    try {
      await act(async () => { root.render(<ResearchContextEvidencePanel repository={first} sessionId="s" pl={false} />); });
      expect(host.textContent).toContain("initial");
      await act(async () => { host.querySelector("button")!.click(); });
      expect(calls).toBe(2);
      expect(host.textContent).toContain("new record");
      await act(async () => { host.querySelector("button")!.click(); });
      expect(host.textContent).toContain("Loading request evidence");
      expect(host.textContent).not.toContain("new record");
      await act(async () => { root.render(<ResearchContextEvidencePanel repository={second} sessionId="s" pl={false} />); });
      expect(host.textContent).toContain("other repository");
      await act(async () => { resolveLate([{ ...event, content: evidence("stale record") }]); });
      expect(host.textContent).not.toContain("stale record");
      expect(host.textContent).toContain("other repository");
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});
