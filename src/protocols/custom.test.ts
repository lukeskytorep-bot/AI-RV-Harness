import { describe, expect, it, vi } from "vitest";
import { dryRunCustomProtocol, saveCustomProtocol } from "./custom";

describe("Custom Protocol", () => {
  it("keeps Reveal separate from the 1–20 blind steps", async () => {
    const save = vi.fn(async (input) => input);
    const protocol = await saveCustomProtocol({ listCustomProtocols: vi.fn().mockResolvedValue([]), saveCustomProtocolVersion: save }, {
      name: "Two step test", language: "en", steps: ["Blind step one", "Blind step two"],
    });
    const plan = dryRunCustomProtocol(protocol);
    expect(plan.map((step) => step.role)).toEqual(["Viewer", "Viewer", "Reveal"]);
    expect(plan.at(-1)?.prompt).toBeUndefined();
  });

  it("rejects more than twenty blind steps", async () => {
    await expect(saveCustomProtocol({ listCustomProtocols: vi.fn().mockResolvedValue([]), saveCustomProtocolVersion: vi.fn() }, {
      name: "Too many", language: "en", steps: Array.from({ length: 21 }, (_, index) => `Step ${index}`),
    })).rejects.toThrow(/1–20/);
  });
});
