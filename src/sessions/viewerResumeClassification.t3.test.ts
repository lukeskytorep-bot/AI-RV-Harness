import { describe, expect, it } from "vitest";
import { ProviderCallError } from "../providers/providerError";
import { ProviderExecutionError } from "../providers/requestExecutor";
import type { ProviderResponseEvidence } from "../providers/responseEvidence";
import type { SessionEventRecord } from "./types";
import { viewerDispatchOutcome } from "./viewerOutputRecovery";
import { inspectViewerResumeLedger } from "./viewerResumeLedger";

const stepId = "lite:prompt:1:viewer";
const event = (n: number, eventType: string, metadata: Record<string, unknown>): SessionEventRecord => ({ id: `e${n}`, sessionId: "s", sequenceNumber: n, eventType, metadata: { stepId, requestSha256: "hash", attemptId: "logical", recoveryLevel: 0, ...metadata }, createdAt: "now" });
const evidence: ProviderResponseEvidence = { version: 1, transportOutcome: "response_finished", boundary: "sse_done" };

describe("T3 completion classification", () => {
  for (const boundary of ["sse_done", "body_read"] as const) it(`${boundary}: completed native rejection stays finished through executor wrappers`, () => {
    const error = new ProviderExecutionError(new ProviderCallError({ code: "empty_assistant_response", message: "Rejected final output", phase: "validating_response", responseEvidence: { ...evidence, boundary } }), {
      operationId: "viewer", logicalRequestId: "request", physicalAttempts: 1, elapsedMs: 1, ambiguousBillingAttempts: 0,
      attemptOutcomes: [{ attemptId: "request:1", logicalRequestId: "request", physicalAttempt: 1, outcome: "response_finished", validation: "rejected", responseEvidence: { ...evidence, boundary } }],
    });
    expect(viewerDispatchOutcome(error)).toBe("response_finished");
  });
  it("a completed rejected response is not a pending provider response in the ledger", () => {
    const outcomes = [{ attemptId: "request:1", logicalRequestId: "request", physicalAttempt: 1, outcome: "response_finished", validation: "rejected", responseEvidence: evidence }];
    expect(inspectViewerResumeLedger([
      event(1, "VIEWER_OUTPUT_ATTEMPT_STARTED", {}),
      event(2, "PROVIDER_ATTEMPT_FAILED", { providerAttemptOutcomes: outcomes, dispatchOutcome: "response_finished" }),
      event(3, "PROVIDER_ERROR", { providerAttemptOutcomes: outcomes, dispatchOutcome: "response_finished" }),
    ], stepId, "hash")).toMatchObject({ kind: "finished_rejected" });
  });
  it("later semantic output cannot settle an earlier unknown physical request", () => {
    expect(inspectViewerResumeLedger([
      event(1, "VIEWER_OUTPUT_ATTEMPT_STARTED", {}),
      event(2, "PROVIDER_ATTEMPT_FAILED", { physicalAttempt: 1, dispatchOutcome: "unknown" }),
      event(3, "VIEWER_OUTPUT_INCOMPLETE", { reason: "output_limit", effectiveMaxOutputTokens: 16384 }),
    ], stepId, "hash")).toMatchObject({ kind: "uncertain" });
  });
  it("a finished later physical call cannot settle an earlier unknown physical request", () => {
    const error = new ProviderExecutionError(new ProviderCallError({ code: "empty_assistant_response", message: "Rejected", phase: "validating_response", responseEvidence: evidence }), {
      operationId: "viewer", logicalRequestId: "request", physicalAttempts: 2, elapsedMs: 1, ambiguousBillingAttempts: 1,
      attemptOutcomes: [
        { attemptId: "request:1", logicalRequestId: "request", physicalAttempt: 1, outcome: "dispatch_unknown", validation: "not_evaluated" },
        { attemptId: "request:2", logicalRequestId: "request", physicalAttempt: 2, outcome: "response_finished", validation: "rejected", responseEvidence: evidence },
      ],
    });
    expect(viewerDispatchOutcome(error)).toBe("unknown");
  });
  it("stop text or a completion label without transport proof remains unknown", () => {
    expect(viewerDispatchOutcome({ phase: "validating_response", code: "unknown", message: "finish-reason=stop", dispatchOutcome: "response_finished" })).toBe("unknown");
  });
});
