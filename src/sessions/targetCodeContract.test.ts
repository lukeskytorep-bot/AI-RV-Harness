import { describe, it, expect } from "vitest";
import { captureSessionTargetCodeContract, validateSessionTargetCodeContract } from "./targetCodeContract";
import type { SessionSnapshot } from "./types";
import { targetCodePolicy } from "../resources/rvLiteTargetCode";

function fixture(field?: string): SessionSnapshot {
  return { schemaVersion: 4, sessionId: "s", sessionCode: "RV-local", sessionLanguage: "en",
    protocol: { id: "rv-lite", version: "v1" }, ...(field ? { [field]: { policy: targetCodePolicy("without_code"), renderedPrompts: [{ content: "Describe", sha256: "frozen" }] } } : {}) } as SessionSnapshot;
}
describe("durable Session target-code contract", () => {
  it.each(["profileTargetCode", "researchTargetCode", "rcpProfileTargetCode", "telepathicProfileTargetCode"] as const)("refuses deletion of %s after reopen", async field => {
    const saved = fixture(field);
    await captureSessionTargetCodeContract(saved);
    const reopened = JSON.parse(JSON.stringify(saved)) as SessionSnapshot;
    await expect(validateSessionTargetCodeContract(reopened)).resolves.toBeUndefined();
    delete reopened[field];
    await expect(validateSessionTargetCodeContract(reopened)).rejects.toThrow("contract");
  });
  it("refuses a missing marker, mode drift, prompt drift and identity drift", async () => {
    const saved = fixture("profileTargetCode"); await captureSessionTargetCodeContract(saved);
    for (const change of [
      (s: SessionSnapshot) => { delete s.targetCodeContract; },
      (s: SessionSnapshot) => { s.profileTargetCode!.policy.mode = "with_code"; },
      (s: SessionSnapshot) => { s.profileTargetCode!.renderedPrompts[0].content = "Changed"; },
      (s: SessionSnapshot) => { s.sessionId = "other"; },
    ]) { const damaged = structuredClone(saved); change(damaged); await expect(validateSessionTargetCodeContract(damaged)).rejects.toThrow("contract"); }
  });
  it("does not upgrade or reinterpret historical records", async () => {
    for (const saved of [fixture(), fixture("profileTargetCode")]) {
      const before = JSON.stringify(saved);
      await validateSessionTargetCodeContract(saved);
      expect(JSON.stringify(saved)).toBe(before);
    }
  });
  it("explicitly records new traditional sessions and tolerates object key reordering", async () => {
    const saved = fixture(); await captureSessionTargetCodeContract(saved);
    expect(saved.targetCodeContract?.policyField).toBe("legacy");
    saved.protocol = Object.fromEntries(Object.entries(saved.protocol).reverse()) as SessionSnapshot["protocol"];
    await expect(validateSessionTargetCodeContract(saved)).resolves.toBeUndefined();
  });
});

it("Browser repository preserves the contract across reopen and refuses policy loss", async () => {
  const { BrowserSessionsRepository } = await import("../storage/browser/sessionsRepository");
  const data = new Map<string, string>();
  const storage: Storage = { get length() { return data.size; }, clear: () => data.clear(), key: i => [...data.keys()][i] ?? null,
    getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } };
  const repository = () => new BrowserSessionsRepository({ storage, isResearchScoresFrozen: () => false });
  const saved = fixture("profileTargetCode"); await captureSessionTargetCodeContract(saved);
  await repository().saveSessionSnapshot("s", saved, "unchanged-outer-hash");
  expect(await repository().getSessionSnapshot("s")).toEqual(saved);
  for (const [key, value] of data) {
    const rows = JSON.parse(value) as { snapshot: SessionSnapshot }[];
    if (Array.isArray(rows) && rows[0]?.snapshot) { delete rows[0].snapshot.profileTargetCode; storage.setItem(key, JSON.stringify(rows)); }
  }
  await expect(repository().getSessionSnapshot("s")).rejects.toThrow("contract");
});
