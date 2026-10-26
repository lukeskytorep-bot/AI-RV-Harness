import { expect, it, vi } from "vitest";
import { workflowTestRepository } from "../testing/workflowRepository";
import type { AppRepository } from "../storage/repository";
import type { SessionEventInput, SessionEventRecord } from "./types";
import { inspectViewerSessionResume, prepareViewerSessionResume } from "./viewerResumeDecision";
import { resolveViewerResumeStart } from "./viewerResumeLedger";

const stepId = "lite:prompt:1:viewer";
function fixture(kind: "exhausted" | "uncertain" | "rejected" = "exhausted") {
  const events: SessionEventRecord[] = [];
  const append = async (_id: string, event: SessionEventInput) => {
    const stored = { ...event, id: `e${events.length + 1}`, sessionId: "s", sequenceNumber: events.length + 1, createdAt: "now" };
    events.push(stored); return stored;
  };
  const m = { stepId, requestSha256: "hash", attemptId: "attempt", recoveryLevel: 1 };
  void append("s", { eventType: "VIEWER_OUTPUT_ATTEMPT_STARTED", metadata: m });
  if (kind !== "uncertain") void append("s", { eventType: "VIEWER_OUTPUT_INCOMPLETE", metadata: { ...m, reason: kind === "exhausted" ? "output_limit" : "empty", effectiveMaxOutputTokens: 32768 } });
  const repository = workflowTestRepository({ listSessionEvents: async () => structuredClone(events), appendSessionEvent: vi.fn(append) } as unknown as AppRepository);
  return { repository, events, append, input: { repository, sessionId: "s", language: "en" as const } };
}

for (const kind of ["exhausted", "uncertain", "rejected"] as const) it(`T3 ${kind}: cancellation does not authorize dispatch or mutate history`, async () => {
  const f = fixture(kind); const before = structuredClone(f.events);
  expect(await prepareViewerSessionResume({ ...f.input, confirm: async () => false })).toBe(false);
  expect(f.events).toEqual(before);
  await expect(resolveViewerResumeStart({ ...f.input, stepKey: stepId, requestSha256: "hash" })).rejects.toThrow(/AUTO-STOP/);
});

for (const kind of ["exhausted", "uncertain", "rejected"] as const) it(`T3 ${kind}: durable confirmation allows one recovery attempt without clearing history`, async () => {
  const f = fixture(kind); const before = structuredClone(f.events); const confirm = vi.fn(async () => true);
  expect(await prepareViewerSessionResume({ ...f.input, confirm })).toBe(true);
  expect(f.events.slice(0, before.length)).toEqual(before);
  const restart = { repository: { listSessionEvents: async () => structuredClone(f.events) }, sessionId: "s", stepKey: stepId, requestSha256: "hash" };
  const start = await resolveViewerResumeStart(restart);
  expect(start).toEqual({ startRecoveryLevel: 1, resumeAuthorizationId: f.events.at(-1)!.id });
  await f.append("s", { eventType: "VIEWER_OUTPUT_ATTEMPT_STARTED", metadata: { stepId, requestSha256: "hash", attemptId: "manual", recoveryLevel: 1, resumeAuthorizationId: start.resumeAuthorizationId } });
  await expect(resolveViewerResumeStart(restart)).rejects.toThrow(/duplicate paid request/);
  expect(confirm).toHaveBeenCalledTimes(1);
});

it("T3 rejects a stale confirmation after any new durable session event", async () => {
  const f = fixture();
  await expect(prepareViewerSessionResume({ ...f.input, confirm: async () => {
    await f.append("s", { eventType: "VIEWER_OUTPUT_ATTEMPT_STARTED", metadata: { stepId, requestSha256: "hash", attemptId: "new", recoveryLevel: 1 } }); return true;
  } })).rejects.toThrow(/state changed/);
  expect(f.events.some(e => e.eventType === "VIEWER_OUTPUT_RETRY_AUTHORIZED")).toBe(false);
});

it("T3 fingerprint mismatch cannot consume a manual authorization", async () => {
  const f = fixture(); await prepareViewerSessionResume({ ...f.input, confirm: async () => true });
  await expect(resolveViewerResumeStart({ ...f.input, stepKey: stepId, requestSha256: "changed" })).rejects.toThrow(/fingerprint/);
});

it("T3 a legacy ambiguous step is blocked before asking for authorization", async () => {
  const f = fixture(); delete f.events[0].metadata!.attemptId; const confirm = vi.fn(async () => true);
  expect(inspectViewerSessionResume(f.events)).toMatchObject({ kind: "unsafe" });
  await expect(prepareViewerSessionResume({ ...f.input, confirm })).rejects.toThrow(/attempt identity/);
  expect(confirm).not.toHaveBeenCalled();
});

it("T3 a saved accepted response needs neither confirmation nor a new authorization", async () => {
  const f = fixture(); await f.append("s", { eventType: "VIEWER_RESPONSE", content: "saved", metadata: { stepId, accepted: true, finishReason: "stop" } });
  const confirm = vi.fn(); expect(await prepareViewerSessionResume({ ...f.input, confirm })).toBe(true);
  expect(confirm).not.toHaveBeenCalled(); expect(f.repository.appendSessionEvent).not.toHaveBeenCalled();
});

it("T3 an authorization save failure cannot resolve uncertainty or permit a resend", async () => {
 const f = fixture("uncertain");
 vi.mocked(f.repository.appendSessionEvent).mockRejectedValueOnce(new Error("DB write failed"));
 await expect(prepareViewerSessionResume({ ...f.input, confirm: async () => true })).rejects.toThrow("DB write failed");
 expect(inspectViewerSessionResume(f.events)).toMatchObject({ kind: "uncertain" });
 await expect(resolveViewerResumeStart({ ...f.input, stepKey: stepId, requestSha256: "hash" })).rejects.toThrow(/duplicate paid request/);
});

it("T3 Stop during confirmation cannot authorize another call", async () => {
 const f = fixture("uncertain"); const stop = new AbortController();
 await expect(prepareViewerSessionResume({ ...f.input, signal: stop.signal, confirm: async () => { stop.abort(); return true; } })).rejects.toMatchObject({ name: "AbortError" });
 expect(f.repository.appendSessionEvent).not.toHaveBeenCalled();
});
