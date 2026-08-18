import { describe, expect, it, vi } from "vitest";
import { runOrdinaryBatch, selectBatchTargets } from "./batch";
import type { TargetRecord } from "../targets/types";

const targets = ["a", "b", "c"].map((id) => ({ id, collection: "user", title: id, revealText: id, tags: [], sourceMetadata: {}, createdAt: "", updatedAt: "" } satisfies TargetRecord));

describe("ordinary batch", () => {
  it("selects without duplicate targets inside one batch", () => {
    expect(selectBatchTargets(targets, 3, () => 0.4).map((target) => target.id).sort()).toEqual(["a", "b", "c"]);
    expect(() => selectBatchTargets(targets, 4)).toThrow(/eligible target pool/i);
  });

  it("keeps completed sessions and stops pending work after an interrupted session", async () => {
    const runSession = vi.fn(async (_target: TargetRecord, index: number) => ({ sessionId: `s${index}`, sessionCode: `C${index}`, state: index === 1 ? "Interrupted" as const : "Revealed" as const }));
    const result = await runOrdinaryBatch({ targets, runSession });
    expect(result.map((item) => item.state)).toEqual(["Revealed", "Interrupted"]);
    expect(runSession).toHaveBeenCalledTimes(2);
  });
});
