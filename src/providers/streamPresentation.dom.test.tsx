// @vitest-environment jsdom
import { act, Profiler, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { executeProviderChat } from "./requestExecutor";
import { createStreamPresentation } from "./streamPreviewBuffer";
import type { ProviderStreamEvent } from "./types";

const delta = (content: string): ProviderStreamEvent => ({ event: "contentDelta", data: { content } });
const finished: ProviderStreamEvent = { event: "finished", data: { finishReason: "stop" } };

it("reduces preview emissions and React commits while passing every delta to the raw consumer", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  const host = document.createElement("div");
  const root = createRoot(host);
  let renders = 0;
  let raw = "";
  let rawCount = 0;
  let emit!: (event: ProviderStreamEvent) => void;
  let release!: () => void;
  let ready!: (send: (event: ProviderStreamEvent) => void) => void;
  const started = new Promise<(event: ProviderStreamEvent) => void>(resolve => { ready = resolve; });
  const onStreamEvent = vi.fn((event: ProviderStreamEvent) => emit(event));

  function Preview() {
    const [value, setValue] = useState("");
    emit = event => {
      if (event.event === "contentDelta") setValue(old => old + event.data.content);
    };
    return <output>{value}</output>;
  }

  try {
    await act(async () => root.render(<Profiler id="preview" onRender={() => { renders++; }}><Preview /></Profiler>));
    renders = 0;
    const run = executeProviderChat({
      config: { id: "p", provider: "openai", label: "P", credentialId: "c", enabled: true, createdAt: "now", updatedAt: "now" },
      modelId: "model",
      messages: [{ role: "user", content: "test" }],
      settings: { requested: {}, effective: {}, omitted: [] },
      streamWorkflowContext: "conversation",
      operationKind: "conversation",
      onStreamEvent,
      internalOnStreamEvent: event => {
        if (event.event === "contentDelta") {
          raw += event.data.content;
          rawCount++;
        }
      },
      attempt: async request => {
        ready(request.onStreamEvent!);
        await new Promise<void>(resolve => { release = resolve; });
        return { content: raw, usage: {} };
      },
    });
    const send = await started;
    for (let i = 0; i < 103; i++) {
      await act(async () => {
        send(delta(`${i},`));
        await vi.advanceTimersByTimeAsync(5);
      });
    }
    await act(async () => { release(); await run; });
    console.info(JSON.stringify({ rawCount, previewEmissions: onStreamEvent.mock.calls.length, renders }));
    expect(rawCount).toBe(103);
    expect(raw).toBe(Array.from({ length: 103 }, (_, i) => `${i},`).join(""));
    expect(host.textContent).toBe(raw);
    expect(onStreamEvent).toHaveBeenCalledTimes(11);
    expect(renders).toBe(11);
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
  }
});

it("flushes before finished, and discards pending and late text on STOP or a failed attempt", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  try {
    const emit = vi.fn();
    const first = createStreamPresentation(emit);
    first.push(delta("a"));
    first.push(delta("b"));
    first.push(finished);
    first.close(true);
    expect(emit.mock.calls).toEqual([[delta("ab")], [finished]]);

    for (const stop of [false, true]) {
      emit.mockClear();
      const controller = new AbortController();
      const attempt = createStreamPresentation(emit, controller.signal);
      attempt.push(delta("stale"));
      if (stop) controller.abort();
      else attempt.close();
      attempt.push(delta("late"));
      attempt.close(true);
      vi.runAllTimers();
      expect(emit).not.toHaveBeenCalled();
    }
  } finally {
    vi.useRealTimers();
  }
});
