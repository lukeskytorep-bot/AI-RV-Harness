import { analyzeRepetitiveOutput } from "./repetitionGuard";
import { describe, expect, it } from "vitest";
import { createStreamingRepetitionGuard, isStreamingRepetitionRunawayError, runWithStreamingRepetitionGuard } from "./streamingRepetitionGuard";

describe("streaming repetition guard", () => {
  it("detects a repeated word loop across delta boundaries and aborts the attempt", () => {
    const guard = createStreamingRepetitionGuard({ language: "en" });
    guard.onStreamEvent({ event: "started", data: { providerRequestId: "req-1" } });
    for (let index = 0; index < 250 && !guard.signal.aborted; index += 1) {
      guard.onStreamEvent({ event: "contentDelta", data: { content: index % 2 === 0 ? "ou" : "r " } });
    }
    expect(guard.signal.aborted).toBe(true);
    const error = guard.runawayError();
    expect(isStreamingRepetitionRunawayError(error)).toBe(true);
    expect(error).toMatchObject({ providerRequestId: "req-1", finding: { severity: "stop" } });
    expect(error?.sanitizedContent).toContain("OUTPUT TRUNCATED");
    guard.cleanup();
  });

  it("keeps normal long RV structure, labels and fenced drawings clear", () => {
    const guard = createStreamingRepetitionGuard({ language: "en" });
    guard.onStreamEvent({ event: "started", data: {} });
    const valid = Array.from({ length: 45 }, (_, index) => [
      `Observation ${index}: texture ${index % 7}, relation ${index % 5}, distinct wording ${index}.`,
      "S/M/VF/E/P/Sub/C/GD/D",
      "```text",
      "+------------------------------+",
      "|            X                 |",
      "```",
    ].join("\n")).join("\n");
    for (let offset = 0; offset < valid.length; offset += 37) {
      guard.onStreamEvent({ event: "contentDelta", data: { content: valid.slice(offset, offset + 37) } });
    }
    guard.onStreamEvent({ event: "finished", data: { finishReason: "stop" } });
    expect(guard.signal.aborted).toBe(false);
    expect(guard.runawayError()).toBeUndefined();
    guard.cleanup();
  });

  it("propagates an ordinary user abort without converting it into repetition", () => {
    const parent = new AbortController();
    const guard = createStreamingRepetitionGuard({ parentSignal: parent.signal });
    parent.abort(new DOMException("user stop", "AbortError"));
    expect(guard.signal.aborted).toBe(true);
    expect(guard.runawayError()).toBeUndefined();
    guard.cleanup();
  });

  it("ignores late stream deltas after an ordinary parent Stop", () => {
    const parent = new AbortController();
    const guard = createStreamingRepetitionGuard({ parentSignal: parent.signal });
    parent.abort(new DOMException("USER STOP", "AbortError"));
    guard.onStreamEvent({ event: "contentDelta", data: { content: "our ".repeat(200) } });
    expect(guard.runawayError()).toBeUndefined();
    guard.cleanup();
  });

  it("preserves parent abort priority when queued deltas arrive before transport rejection", async () => {
    const parent = new AbortController();
    await expect(runWithStreamingRepetitionGuard({ parentSignal: parent.signal, execute: async (_signal, emit) => {
      parent.abort(new DOMException("USER STOP", "AbortError"));
      emit({ event: "contentDelta", data: { content: "our ".repeat(200) } });
      throw parent.signal.reason;
    } })).rejects.toMatchObject({ name: "AbortError", message: "USER STOP" });
  });

  it("keeps drawing fence context when the opening fence is older than the bounded tail", () => {
    const guard = createStreamingRepetitionGuard();
    const content = "```text\n" + Array.from({ length: 1500 }, (_, i) => `Drawing label ${i}: distinct spatial position ${i}.\n`).join("") + "|---X---|\n".repeat(80) + "```\n";
    expect(analyzeRepetitiveOutput(content).severity).toBe("clear");
    guard.onStreamEvent({ event: "contentDelta", data: { content } });
    expect(guard.signal.aborted).toBe(false);
    guard.cleanup();
  });

  it("still catches natural-language runaway inside a long fenced block", () => {
    const guard = createStreamingRepetitionGuard();
    const prefix = "```text\n" + Array.from({ length: 1500 }, (_, i) => `Drawing label ${i}: distinct spatial position ${i}.\n`).join("");
    guard.onStreamEvent({ event: "contentDelta", data: { content: prefix } });
    guard.onStreamEvent({ event: "contentDelta", data: { content: "our ".repeat(240) } });
    expect(guard.signal.aborted).toBe(true);
    expect(guard.runawayError()).toBeDefined();
    guard.cleanup();
  });


  it("preserves tilde and unclosed fence state across delta boundaries", () => {
    const guard = createStreamingRepetitionGuard();
    const chunks = ["~~", "~text\n", "Distinct observation A.\n", "|---X---|\n".repeat(90)];
    for (const content of chunks) guard.onStreamEvent({ event: "contentDelta", data: { content } });
    guard.onStreamEvent({ event: "finished", data: { finishReason: "stop" } });
    expect(guard.signal.aborted).toBe(false);
    expect(guard.runawayError()).toBeUndefined();
    guard.cleanup();
  });

  it("preserves a definitive returned provider response when parent Stop races with completion", async () => {
    const parent = new AbortController();
    const response = { content: "Known completed evidence", finishReason: "stop", usage: { totalTokens: 10 } };
    await expect(runWithStreamingRepetitionGuard({
      parentSignal: parent.signal,
      execute: async () => {
        parent.abort(new DOMException("USER STOP", "AbortError"));
        return response;
      },
    })).resolves.toEqual(response);
  });

});
