import { describe, expect, it } from "vitest";
import { resolveProviderTimeoutPolicy } from "./streamingPolicy";

describe("S1 provider timeout policy", () => {
  it("maps the 120s base setting through ORP1 semantic timeout classes", () => {
    expect(resolveProviderTimeoutPolicy("interactive", 120_000)).toEqual({
      timeoutClass: "interactive",
      firstEventTimeoutMs: 120_000,
      idleTimeoutMs: 120_000,
      absoluteEmergencyTimeoutMs: 16 * 60_000,
      nonStreamingTimeoutMs: 120_000,
    });
    expect(resolveProviderTimeoutPolicy("analytical", 120_000)).toEqual({
      timeoutClass: "analytical",
      firstEventTimeoutMs: 180_000,
      idleTimeoutMs: 150_000,
      absoluteEmergencyTimeoutMs: 30 * 60_000,
      nonStreamingTimeoutMs: 180_000,
    });
    expect(resolveProviderTimeoutPolicy("long_reasoning", 120_000)).toEqual({
      timeoutClass: "long_reasoning",
      firstEventTimeoutMs: 300_000,
      idleTimeoutMs: 180_000,
      absoluteEmergencyTimeoutMs: 60 * 60_000,
      nonStreamingTimeoutMs: 300_000,
    });
  });

  it("keeps the user timeout as the base dial while bounding every class", () => {
    expect(resolveProviderTimeoutPolicy("interactive", 1).firstEventTimeoutMs).toBe(1_000);
    expect(resolveProviderTimeoutPolicy("long_reasoning", 600_000).firstEventTimeoutMs).toBe(600_000);
    expect(resolveProviderTimeoutPolicy("long_reasoning", 600_000).absoluteEmergencyTimeoutMs).toBe(2 * 60 * 60_000);
  });
});
