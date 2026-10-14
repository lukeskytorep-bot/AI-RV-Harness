import { inheritAbortOwnership } from "../application/abortOwnership";
import type { InterfaceLanguage } from "../types";
import type { ProviderStreamEvent } from "../providers/types";
import {
  analyzeRepetitiveOutput,
  maskRepetitionLine,
  sanitizeRepetitiveOutput,
  type RepetitionFenceState,
  type RepetitionInspection,
} from "./repetitionGuard";

const STREAM_SCAN_INTERVAL_CHARS = 384;
const STREAM_SCAN_TAIL_CHARS = 24_000;

export class StreamingRepetitionRunawayError extends Error {
  readonly rawContent: string;
  readonly sanitizedContent: string;
  readonly finding: RepetitionInspection;
  readonly providerRequestId?: string;
  readonly originalLength: number;
  readonly retainedLength: number;

  constructor(input: {
    rawContent: string;
    sanitizedContent: string;
    finding: RepetitionInspection;
    providerRequestId?: string;
    originalLength: number;
    retainedLength: number;
  }) {
    super("Viewer streaming output entered a clear repetition runaway.");
    this.name = "StreamingRepetitionRunawayError";
    this.rawContent = input.rawContent;
    this.sanitizedContent = input.sanitizedContent;
    this.finding = input.finding;
    this.providerRequestId = input.providerRequestId;
    this.originalLength = input.originalLength;
    this.retainedLength = input.retainedLength;
  }
}

export function isStreamingRepetitionRunawayError(value: unknown): value is StreamingRepetitionRunawayError {
  return value instanceof StreamingRepetitionRunawayError
    || Boolean(value && typeof value === "object" && (value as { name?: unknown }).name === "StreamingRepetitionRunawayError");
}

export interface StreamingRepetitionGuard {
  readonly signal: AbortSignal;
  onStreamEvent(event: ProviderStreamEvent): void;
  runawayError(): StreamingRepetitionRunawayError | undefined;
  cleanup(): void;
}

/**
 * Incremental, bounded-cost streaming guard. Fence state is carried across the
 * whole stream while only the latest bounded masked tail is analyzed. This
 * preserves ASCII/SVG drawing classification even when the opening fence is
 * older than the scan window.
 */
export function createStreamingRepetitionGuard(input: {
  parentSignal?: AbortSignal;
  language?: InterfaceLanguage;
} = {}): StreamingRepetitionGuard {
  const controller = new AbortController();
  inheritAbortOwnership(controller.signal,input.parentSignal);
  let content = "";
  let charsSinceScan = 0;
  let providerRequestId: string | undefined;
  let detected: StreamingRepetitionRunawayError | undefined;
  let parentCancelled = false;
  let cleaned = false;
  let fence: RepetitionFenceState | null = null;
  let pendingLine = "";
  let maskedTail = "";

  const appendMasked = (masked: string) => {
    maskedTail += masked;
    const overflow = maskedTail.length - STREAM_SCAN_TAIL_CHARS;
    if (overflow > 0) maskedTail = maskedTail.slice(overflow);
  };

  const ingestForMasking = (chunk: string) => {
    pendingLine += chunk;
    for (;;) {
      const newline = pendingLine.indexOf("\n");
      if (newline < 0) break;
      const line = pendingLine.slice(0, newline + 1);
      pendingLine = pendingLine.slice(newline + 1);
      const result = maskRepetitionLine(line, fence);
      fence = result.nextFence;
      appendMasked(result.masked);
    }
  };

  const currentMaskedTail = () => {
    const partial = pendingLine ? maskRepetitionLine(pendingLine, fence).masked : "";
    const combined = maskedTail + partial;
    return combined.length > STREAM_SCAN_TAIL_CHARS ? combined.slice(-STREAM_SCAN_TAIL_CHARS) : combined;
  };

  const abortFromParent = () => {
    parentCancelled = true;
    if (controller.signal.aborted) return;
    const reason = input.parentSignal?.reason ?? new DOMException("Provider request cancelled", "AbortError");
    controller.abort(reason);
  };
  if (input.parentSignal?.aborted) abortFromParent();
  else input.parentSignal?.addEventListener("abort", abortFromParent, { once: true });

  const inspect = () => {
    if (detected || parentCancelled || cleaned || !content) return;
    const tail = currentMaskedTail();
    const scanStart = Math.max(0, content.length - tail.length);
    const localFinding = analyzeRepetitiveOutput(tail);
    if (localFinding.severity !== "stop") return;
    const finding: RepetitionInspection = {
      ...localFinding,
      ...(localFinding.cutAt !== undefined ? { cutAt: scanStart + localFinding.cutAt } : {}),
    };
    const sanitized = sanitizeRepetitiveOutput(content, input.language ?? "en");
    // The full-content sanitizer is authoritative. If the bounded detector and
    // full classification disagree, do not abort valid evidence.
    if (!sanitized.truncated) return;
    detected = new StreamingRepetitionRunawayError({
      rawContent: content,
      sanitizedContent: sanitized.content,
      finding: sanitized.finding ?? finding,
      ...(providerRequestId ? { providerRequestId } : {}),
      originalLength: sanitized.originalLength,
      retainedLength: sanitized.retainedLength,
    });
    if (!controller.signal.aborted) controller.abort(detected);
  };

  return {
    signal: controller.signal,
    onStreamEvent(event) {
      if (parentCancelled || cleaned) return;
      if (event.event === "started") {
        content = "";
        charsSinceScan = 0;
        providerRequestId = event.data.providerRequestId;
        fence = null;
        pendingLine = "";
        maskedTail = "";
        return;
      }
      if (event.event === "contentDelta") {
        content += event.data.content;
        ingestForMasking(event.data.content);
        charsSinceScan += event.data.content.length;
        if (charsSinceScan >= STREAM_SCAN_INTERVAL_CHARS) {
          charsSinceScan = 0;
          inspect();
        }
        return;
      }
      if (event.event === "finished") inspect();
    },
    runawayError: () => detected,
    cleanup() {
      cleaned = true;
      input.parentSignal?.removeEventListener("abort", abortFromParent);
    },
  };
}

function parentAbortReason(signal?: AbortSignal): unknown {
  return signal?.reason ?? new DOMException("Provider request cancelled", "AbortError");
}

export async function runWithStreamingRepetitionGuard<T>(input: {
  parentSignal?: AbortSignal;
  language?: InterfaceLanguage;
  execute: (signal: AbortSignal, internalOnStreamEvent: (event: ProviderStreamEvent) => void) => Promise<T>;
}): Promise<T> {
  const guard = createStreamingRepetitionGuard({ parentSignal: input.parentSignal, language: input.language });
  try {
    const result = await input.execute(guard.signal, guard.onStreamEvent);
    // A resolved provider call is a definitive outcome even if parent Stop/lease
    // raced with the final return. Preserve that known result so the caller can
    // checkpoint it, then let the outer run observe parent cancellation before
    // starting any further protocol step or recovery request.
    const runaway = guard.runawayError();
    if (runaway && !input.parentSignal?.aborted) throw runaway;
    return result;
  } catch (cause) {
    // Explicit parent cancellation (USER STOP / lease loss) always wins over a
    // locally detected loop, including queued deltas arriving around abort.
    if (input.parentSignal?.aborted) throw parentAbortReason(input.parentSignal);
    const runaway = guard.runawayError();
    if (runaway) throw runaway;
    throw cause;
  } finally {
    guard.cleanup();
  }
}
