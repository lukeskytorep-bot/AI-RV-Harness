import { describe, expect, it } from "vitest";
import { assertTargetCodeAbsent, isTargetCodeMode, resolveTargetCodeMode } from "./targetCodeMode";

describe("shared target-code visibility policy", () => {
  it("defaults only missing settings to the legacy behavior", () => {
    expect(resolveTargetCodeMode(undefined)).toBe("with_code");
    for (const mode of ["with_code", "without_code"] as const) {
      expect(isTargetCodeMode(mode)).toBe(true);
      expect(resolveTargetCodeMode(mode)).toBe(mode);
    }
    for (const invalid of [null, false, "", "WITHOUT_CODE", {}, 0]) {
      expect(isTargetCodeMode(invalid)).toBe(false);
      expect(() => resolveTargetCodeMode(invalid)).toThrow(/Invalid/);
    }
  });
  it("preserves existing with-code payloads and accepts neutral instructions", () => {
    const payload = [{ role: "user", content: "RV-SECRET-7" }];
    expect(() => assertTargetCodeAbsent("with_code", "RV-SECRET-7", payload)).not.toThrow();
    expect(() => assertTargetCodeAbsent("without_code", "RV-SECRET-7", [{ role: "user", content: "Begin the session." }])).not.toThrow();
    expect(payload[0].content).toBe("RV-SECRET-7");
  });
  it("rejects exact identifiers anywhere in the serialized payload", () => {
    for (const role of ["system", "user", "assistant"]) {
      expect(() => assertTargetCodeAbsent("without_code", "RV-SECRET-7", [{ role, content: "Prefix RV-SECRET-7 suffix" }])).toThrow(/refused/);
    }
    expect(() => assertTargetCodeAbsent("without_code", 'RV-"7', { nested: { value: 'RV-"7' } })).toThrow(/refused/);
  });
  it("fails closed for missing identifiers and unserializable payloads", () => {
    for (const code of ["", "  "]) expect(() => assertTargetCodeAbsent("without_code", code, [])).toThrow(/non-empty/);
    expect(() => assertTargetCodeAbsent("without_code", "RV-7", undefined)).toThrow(/serializable/);
    const circular: { self?: unknown } = {}; circular.self = circular;
    expect(() => assertTargetCodeAbsent("without_code", "RV-7", circular)).toThrow();
  });
});
