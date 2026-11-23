import { describe, expect, it } from "vitest";
import { buildResearchContextRequestEvidence } from "./contextRequestEvidence";

const settings = {
  requested: { maxOutputTokens: 1000 },
  effective: { maxOutputTokens: 900 },
  omitted: [],
} as never;

describe("Context & Instructions request evidence", () => {
  it("preserves exact message order, roles, text and hashes", async () => {
    const evidence = await buildResearchContextRequestEvidence([
      { role: "system", content: "  protocol\n" },
      { role: "system", content: "replace all  " },
      { role: "user", content: "Step" },
    ], settings);
    expect(evidence.messages.map((message) => [message.index, message.role, message.content])).toEqual([
      [0, "system", "  protocol\n"],
      [1, "system", "replace all  "],
      [2, "user", "Step"],
    ]);
    expect(evidence.messages.every((message) => /^[a-f0-9]{64}$/.test(message.sha256))).toBe(true);
    expect(evidence.messagesSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(evidence.requestedMaxOutputTokens).toBe(1000);
    expect(evidence.effectiveMaxOutputTokens).toBe(900);
  });

  it("changes the aggregate hash when message order changes", async () => {
    const a = await buildResearchContextRequestEvidence([{ role: "system", content: "a" }, { role: "user", content: "b" }], settings);
    const b = await buildResearchContextRequestEvidence([{ role: "user", content: "b" }, { role: "system", content: "a" }], settings);
    expect(a.messagesSha256).not.toBe(b.messagesSha256);
  });
});
