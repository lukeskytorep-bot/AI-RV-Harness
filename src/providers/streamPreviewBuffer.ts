import type { ProviderStreamEvent } from "./types";

const PREVIEW_INTERVAL_MS = 50;

/** One presentation buffer per transport attempt. Raw consumers run upstream. */
export function createStreamPresentation(emit: (event: ProviderStreamEvent) => void, signal?: AbortSignal) {
  let pending: string[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  // Preview observers are independent of the transport result and the raw consumer.
  const emitPreview = (event: ProviderStreamEvent) => {
    if (signal?.aborted) return;
    try { emit(event); } catch { /* Preview failure must not change the attempt outcome. */ }
  };
  const flush = () => {
    clearTimer();
    const content = pending.join("");
    pending = [];
    if (content) emitPreview({ event: "contentDelta", data: { content } });
  };
  const close = (completed = false) => {
    if (closed) return;
    closed = true;
    signal?.removeEventListener("abort", abort);
    if (completed && !signal?.aborted) flush();
    else {
      clearTimer();
      pending = [];
    }
  };
  const abort = () => close();
  signal?.addEventListener("abort", abort, { once: true });

  return {
    close,
    push(event: ProviderStreamEvent) {
      if (closed || signal?.aborted) return;
      if (event.event !== "contentDelta") {
        flush();
        emitPreview(event);
        return;
      }
      if (!event.data.content) return;
      pending.push(event.data.content);
      if (timer === undefined) timer = setTimeout(flush, PREVIEW_INTERVAL_MS);
    },
  };
}
