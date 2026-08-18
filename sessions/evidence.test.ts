import { describe, expect, it } from "vitest";
import { verifySealedViewerEvidence } from "./evidence";

async function hash(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

describe("sealed Judge evidence", () => {
  it("returns the immutable transcript when its seal matches", async () => {
    const transcript = "## Phase 1\n\nCold, hard, vertical.";
    await expect(verifySealedViewerEvidence(transcript, await hash(transcript))).resolves.toBe(transcript);
  });

  it("rejects evidence that no longer matches its seal", async () => {
    await expect(verifySealedViewerEvidence("changed", await hash("original"))).rejects.toThrow(/integrity/i);
  });
});
