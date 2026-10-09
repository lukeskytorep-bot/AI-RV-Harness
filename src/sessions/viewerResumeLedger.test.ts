import { describe, expect, it, vi } from "vitest";
import type { SessionEventRecord } from "./types";
import { buildViewerStepId, inspectViewerResumeLedger, resolveViewerResumeStart, viewerRequestFingerprintInput } from "./viewerResumeLedger";

const event = (n: number, type: string, metadata: Record<string, unknown> = {}): SessionEventRecord => ({ id: `e${n}`, sessionId: "s", sequenceNumber: n, createdAt: "now", eventType: type, metadata });

describe("durable Viewer attempt ledger", () => {
  it("builds distinct identities for main, special-task and repeated Monitor calls", () => {
    expect(buildViewerStepId("rcp", { phase: 4 })).toBe("rcp:phase:4:viewer");
    expect(buildViewerStepId("rcp", { phase: 4, source: "special_task" })).toBe("rcp:phase:4:special_task");
    expect(buildViewerStepId("rcp", { phase: 4, source: "monitor_intervention", exchangeNumber: 2 })).toBe("rcp:phase:4:monitor_intervention:exchange:2");
  });

  it("fingerprints semantic request content without provider continuation payloads", () => {
    const plain = viewerRequestFingerprintInput([{ role: "assistant", content: "same" }]);
    const withContinuation = viewerRequestFingerprintInput([{ role: "assistant", content: "same", continuationState: { schemaVersion: 1, format: "openrouter-reasoning-details", transport: "openrouter", payload: {}, replayFingerprint: "x" } as never }]);
    expect(withContinuation).toBe(plain);
  });

  it("does not guess step identity from older incomplete records", () => {
    expect(inspectViewerResumeLedger([event(1, "VIEWER_OUTPUT_INCOMPLETE", { phase: 2, recoveryLevel: 0, reason: "output_limit" })], "rcp:phase:2:viewer")).toMatchObject({ kind: "unsafe" });
  });

  it("resumes an exact first length at recovery level one", async () => {
    const repository = { listSessionEvents: vi.fn().mockResolvedValue([event(1, "VIEWER_OUTPUT_INCOMPLETE", { stepId: "rcp:phase:2:viewer", recoveryLevel: 0, reason: "output_limit", effectiveMaxOutputTokens: 16384, requestSha256: "hash" })]) };
    await expect(resolveViewerResumeStart({ repository, sessionId: "s", stepKey: "rcp:phase:2:viewer", requestSha256: "hash" })).resolves.toEqual({ startRecoveryLevel: 1, priorEffectiveMaxOutputTokens: 16384 });
  });

  it("prohibits resetting exhausted recovery after restart", async () => {
    const repository = { listSessionEvents: vi.fn().mockResolvedValue([
      event(1, "VIEWER_OUTPUT_INCOMPLETE", { stepId: "rcp:phase:2:viewer", recoveryLevel: 0, reason: "output_limit", effectiveMaxOutputTokens: 16384, requestSha256: "hash" }),
      event(2, "VIEWER_OUTPUT_INCOMPLETE", { stepId: "rcp:phase:2:viewer", recoveryLevel: 1, reason: "output_limit", effectiveMaxOutputTokens: 32768, requestSha256: "hash" }),
    ]) };
    await expect(resolveViewerResumeStart({ repository, sessionId: "s", stepKey: "rcp:phase:2:viewer", requestSha256: "hash" })).rejects.toThrow(/already exhausted/i);
  });

  it("blocks automatic resend when an attempt start has no durable terminal event", async () => {
    const repository = { listSessionEvents: vi.fn().mockResolvedValue([
      event(1, "VIEWER_OUTPUT_INCOMPLETE", { stepId: "rcp:phase:2:viewer", recoveryLevel: 0, reason: "output_limit", effectiveMaxOutputTokens: 16384, requestSha256: "hash" }),
      event(2, "VIEWER_OUTPUT_ATTEMPT_STARTED", { stepId: "rcp:phase:2:viewer", attemptId: "attempt-2", recoveryLevel: 1, semanticAttempt: 2, effectiveMaxOutputTokens: 32768, requestSha256: "hash" }),
    ]) };
    await expect(resolveViewerResumeStart({ repository, sessionId: "s", stepKey: "rcp:phase:2:viewer", requestSha256: "hash" })).rejects.toThrow(/duplicate paid request/i);
  });

  it("does not retry a step whose accepted answer was persisted", () => {
    expect(inspectViewerResumeLedger([
      event(1, "VIEWER_OUTPUT_INCOMPLETE", { stepId: "rcp:phase:2:viewer", recoveryLevel: 0, reason: "output_limit", effectiveMaxOutputTokens: 16384 }),
      event(2, "VIEWER_RESPONSE", { stepId: "rcp:phase:2:viewer", accepted: true, recoveryLevel: 1, finishReason: "stop" }),
    ], "rcp:phase:2:viewer")).toEqual({ kind: "fresh" });
  });
  it("blocks Resume when reconstructed messages do not match the persisted request fingerprint", async () => {
    const repository = { listSessionEvents: vi.fn().mockResolvedValue([
      event(1, "VIEWER_OUTPUT_INCOMPLETE", { stepId: "rcp:phase:2:viewer", recoveryLevel: 0, reason: "output_limit", effectiveMaxOutputTokens: 16384, requestSha256: "old-hash" }),
    ]) };
    await expect(resolveViewerResumeStart({ repository, sessionId: "s", stepKey: "rcp:phase:2:viewer", requestSha256: "new-hash" })).rejects.toThrow(/fingerprint/i);
  });

  it("does not let an older terminal event close a newer dispatch at the same recovery level", () => {
    const decision = inspectViewerResumeLedger([
      event(1, "VIEWER_OUTPUT_ATTEMPT_STARTED", { stepId: "rcp:phase:2:viewer", attemptId: "attempt-1", recoveryLevel: 0, requestSha256: "hash" }),
      event(2, "VIEWER_OUTPUT_INCOMPLETE", { stepId: "rcp:phase:2:viewer", attemptId: "attempt-1", recoveryLevel: 0, reason: "empty", effectiveMaxOutputTokens: 16384, requestSha256: "hash" }),
      event(3, "VIEWER_OUTPUT_ATTEMPT_STARTED", { stepId: "rcp:phase:2:viewer", attemptId: "attempt-2", recoveryLevel: 0, requestSha256: "hash" }),
    ], "rcp:phase:2:viewer", "hash");
    expect(decision).toMatchObject({ kind: "uncertain", eventId: "e3", recoveryLevel: 0 });
  });

  it("allows a retry only when the same attempt is durably marked not dispatched", () => {
    const decision = inspectViewerResumeLedger([
      event(1, "VIEWER_OUTPUT_ATTEMPT_STARTED", { stepId: "rcp:phase:2:viewer", attemptId: "attempt-1", recoveryLevel: 0, requestSha256: "hash" }),
      event(2, "VIEWER_OUTPUT_ATTEMPT_NOT_DISPATCHED", { stepId: "rcp:phase:2:viewer", attemptId: "attempt-1", recoveryLevel: 0, requestSha256: "hash" }),
      event(3, "PROVIDER_ERROR", { stepId: "rcp:phase:2:viewer", attemptId: "attempt-1", dispatchOutcome: "not_dispatched", requestSha256: "hash" }),
    ], "rcp:phase:2:viewer", "hash");
    expect(decision).toEqual({ kind: "fresh" });
  });

  it("keeps an attempt uncertain when an earlier physical retry may have dispatched even if a later retry was not dispatched", () => {
    const decision = inspectViewerResumeLedger([
      event(1, "VIEWER_OUTPUT_ATTEMPT_STARTED", { stepId: "rcp:phase:2:viewer", attemptId: "attempt-1", recoveryLevel: 0, requestSha256: "hash" }),
      event(2, "PROVIDER_ATTEMPT_FAILED", { stepId: "rcp:phase:2:viewer", attemptId: "attempt-1", physicalAttempt: 1, dispatchOutcome: "unknown", requestSha256: "hash" }),
      event(3, "PROVIDER_ATTEMPT_FAILED", { stepId: "rcp:phase:2:viewer", attemptId: "attempt-1", physicalAttempt: 2, dispatchOutcome: "not_dispatched", requestSha256: "hash" }),
      event(4, "VIEWER_OUTPUT_ATTEMPT_NOT_DISPATCHED", { stepId: "rcp:phase:2:viewer", attemptId: "attempt-1", recoveryLevel: 0, requestSha256: "hash" }),
      event(5, "PROVIDER_ERROR", { stepId: "rcp:phase:2:viewer", attemptId: "attempt-1", dispatchOutcome: "not_dispatched", requestSha256: "hash" }),
    ], "rcp:phase:2:viewer", "hash");
    expect(decision).toMatchObject({ kind: "uncertain", eventId: "e1", recoveryLevel: 0 });
  });

});
