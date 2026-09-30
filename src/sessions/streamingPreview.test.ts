import { describe, expect, it } from "vitest";
import { createSessionStreamPreviewHandler } from "./streamingPreview";

describe("S2 RV Session streaming preview", () => {
  it("accumulates visible chunks without creating a durable session artifact", () => {
    const previews: unknown[] = [];
    const handler = createSessionStreamPreviewHandler({ emit: (preview) => previews.push(preview), role: "viewer", phase: 3 });
    handler?.({ event: "started", data: {} });
    handler?.({ event: "contentDelta", data: { content: "first" } });
    handler?.({ event: "contentDelta", data: { content: " second" } });
    expect(previews).toEqual([
      null,
      { role: "viewer", phase: 3, content: "first" },
      { role: "viewer", phase: 3, content: "first second" },
    ]);
  });

  it("resets the provisional buffer when Monitor output recovery starts a new semantic generation", () => {
    const previews: unknown[] = [];
    const handler = createSessionStreamPreviewHandler({ emit: (preview) => previews.push(preview), role: "monitor", phase: 6, exchangeNumber: 2 });
    handler?.({ event: "started", data: {} });
    handler?.({ event: "contentDelta", data: { content: "partial" } });
    handler?.({ event: "started", data: {} });
    handler?.({ event: "contentDelta", data: { content: "recovery" } });
    expect(previews.at(-1)).toEqual({ role: "monitor", phase: 6, exchangeNumber: 2, content: "recovery" });
    expect(previews).not.toContainEqual({ role: "monitor", phase: 6, exchangeNumber: 2, content: "partialrecovery" });
  });

});
