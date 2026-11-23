// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { workflowTestRepository } from "../../testing/workflowRepository";
import type { AppRepository } from "../../storage/repository";
import { ResearchContextEvidencePanel } from "./ResearchContextEvidencePanel";

const evidence = (content: string) => JSON.stringify({
  version: 1,
  messagesSha256: "a".repeat(64),
  messages: [{ index: 0, role: "system", content, sha256: "b".repeat(64) }],
});

describe("ResearchContextEvidencePanel", () => {
  it("shows physical retries, recovery and exact request message text for a selected session", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const repository = workflowTestRepository({
      listSessionEvents: async () => [
        { id: "e1", sessionId: "s", sequenceNumber: 1, createdAt: "now", eventType: "RESEARCH_CONTEXT_REQUEST_EVIDENCE_V1", role: "controller", content: evidence("  exact text\nline two  "), metadata: { logicalRequestId: "l1", physicalAttempt: 1, physicalAttemptId: "l1:1", stepId: "lite:1", recoveryLevel: 0, semanticAttempt: 1 } },
        { id: "e2", sessionId: "s", sequenceNumber: 2, createdAt: "now", eventType: "RESEARCH_CONTEXT_REQUEST_EVIDENCE_V1", role: "controller", content: evidence("  exact text\nline two  "), metadata: { logicalRequestId: "l1", physicalAttempt: 2, physicalAttemptId: "l1:2", stepId: "lite:1", recoveryLevel: 0, semanticAttempt: 1 } },
        { id: "e3", sessionId: "s", sequenceNumber: 3, createdAt: "now", eventType: "RESEARCH_CONTEXT_REQUEST_EVIDENCE_V1", role: "controller", content: evidence("recovery"), metadata: { logicalRequestId: "l2", physicalAttempt: 1, physicalAttemptId: "l2:1", stepId: "lite:1", recoveryLevel: 1, semanticAttempt: 2 } },
      ],
    } as unknown as AppRepository);
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    try {
      await act(async () => { root.render(<ResearchContextEvidencePanel repository={repository} sessionId="s" pl={false} />); await Promise.resolve(); });
      expect(host.textContent).toContain("3 physical attempts");
      expect(host.textContent).toContain("Transport retries1");
      expect(host.textContent).toContain("Recovery attempts1");
      const pre = host.querySelector("pre");
      expect(pre?.textContent).toBe("  exact text\nline two  ");
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});
