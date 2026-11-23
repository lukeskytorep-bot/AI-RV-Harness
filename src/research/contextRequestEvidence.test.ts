import { describe, expect, it } from "vitest";
import { buildResearchContextRequestEvidence, parseResearchContextRequestEvidenceEvents, summarizeResearchContextRequestEvidence, RESEARCH_CONTEXT_REQUEST_EVIDENCE_EVENT } from "./contextRequestEvidence";
import type { SessionEventRecord } from "../sessions/types";

const settings = {
  requested: { maxOutputTokens: 1000 },
  effective: { maxOutputTokens: 900 },
  omitted: [],
} as never;

describe("Context & Instructions request evidence", () => {
  it("preserves exact message order, roles, text and hashes", async () => {
    const evidence = await buildResearchContextRequestEvidence([
      { role: "system", content: "  protocol\n" },
      { role: "system", content: "replace all  " },
      { role: "user", content: "Step" },
    ], settings);
    expect(evidence.messages.map((message) => [message.index, message.role, message.content])).toEqual([
      [0, "system", "  protocol\n"],
      [1, "system", "replace all  "],
      [2, "user", "Step"],
    ]);
    expect(evidence.messages.every((message) => /^[a-f0-9]{64}$/.test(message.sha256))).toBe(true);
    expect(evidence.messagesSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(evidence.requestedMaxOutputTokens).toBe(1000);
    expect(evidence.effectiveMaxOutputTokens).toBe(900);
  });

  it("changes the aggregate hash when message order changes", async () => {
    const a = await buildResearchContextRequestEvidence([{ role: "system", content: "a" }, { role: "user", content: "b" }], settings);
    const b = await buildResearchContextRequestEvidence([{ role: "user", content: "b" }, { role: "system", content: "a" }], settings);
    expect(a.messagesSha256).not.toBe(b.messagesSha256);
  });
});


function evidenceEvent(sequenceNumber: number, metadata: Record<string, unknown>, content = "alpha"): SessionEventRecord {
  return {
    id: `e${sequenceNumber}`,
    sessionId: "s",
    sequenceNumber,
    createdAt: "now",
    eventType: RESEARCH_CONTEXT_REQUEST_EVIDENCE_EVENT,
    role: "controller",
    content: JSON.stringify({ version: 1, messagesSha256: `hash-${sequenceNumber}`, messages: [{ index: 0, role: "system", content, sha256: `message-${sequenceNumber}` }] }),
    metadata,
  };
}

describe("research context request evidence event parsing", () => {
  it("summarizes logical calls, physical retries and recovery attempts without losing exact message text", () => {
    const records = parseResearchContextRequestEvidenceEvents([
      evidenceEvent(2, { logicalRequestId: "l1", physicalAttempt: 2, physicalAttemptId: "l1:2", stepId: "step-1", recoveryLevel: 0, semanticAttempt: 1 }, "  retry text\n"),
      evidenceEvent(1, { logicalRequestId: "l1", physicalAttempt: 1, physicalAttemptId: "l1:1", stepId: "step-1", recoveryLevel: 0, semanticAttempt: 1 }, "  retry text\n"),
      evidenceEvent(3, { logicalRequestId: "l2", physicalAttempt: 1, physicalAttemptId: "l2:1", stepId: "step-1", recoveryLevel: 1, semanticAttempt: 2 }, "recovery"),
    ]);
    expect(records.map((record) => record.sequenceNumber)).toEqual([1, 2, 3]);
    expect(records[0].evidence.messages[0].content).toBe("  retry text\n");
    expect(summarizeResearchContextRequestEvidence(records)).toEqual({ physicalAttempts: 3, logicalRequests: 2, transportRetries: 1, recoveryAttempts: 1 });
  });

  it("ignores malformed or unrelated events instead of inventing evidence", () => {
    const records = parseResearchContextRequestEvidenceEvents([
      { ...evidenceEvent(1, {}), eventType: "OTHER" },
      { ...evidenceEvent(2, {}), content: "not json" },
      { ...evidenceEvent(3, {}), content: JSON.stringify({ version: 1, messagesSha256: "hash", messages: [{ role: "system" }] }) },
    ]);
    expect(records).toEqual([]);
  });
});
