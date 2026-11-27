import { expect, it } from "vitest";
import { assertTargetCodeContract, captureTargetCodeContract, type TargetCodeContractCarrier } from "./targetCodeContract";
it("keeps historical carriers unchanged and freezes only at creation", () => {
  const carrier: TargetCodeContractCarrier = {};
  assertTargetCodeContract(carrier, "owner", undefined); expect(carrier).toEqual({});
  captureTargetCodeContract(carrier, "owner", { mode: "without_code", hash: "frozen" });
  expect(() => captureTargetCodeContract(carrier, "owner", {})).toThrow("already frozen");
  expect(() => assertTargetCodeContract(carrier, "owner", { hash: "frozen", mode: "without_code" })).not.toThrow();
});
it.each(["version", "contract", "policy", "owner", "mode", "unknown"])("refuses %s corruption", kind => {
  const c: TargetCodeContractCarrier = {}; captureTargetCodeContract(c, "a", { mode: "without_code" });
  if (kind === "version") delete c.targetCodeContractVersion;
  if (kind === "contract") delete c.targetCodeContract;
  if (kind === "unknown") c.targetCodeContractVersion = 99 as never;
  expect(() => assertTargetCodeContract(c, kind === "owner" ? "b" : "a",
    kind === "policy" ? undefined : { mode: kind === "mode" ? "with_code" : "without_code" })).toThrow(/contract/);
});
