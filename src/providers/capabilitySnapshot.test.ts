import { describe, expect, it } from "vitest";

import { parseModelCapabilitiesSnapshot } from "./capabilitySnapshot";

const valid = {
  inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true,
  reasoning: { supported: false, efforts: [], confidence: "unknown" },
  temperature: { supported: true, min: 0, max: 2, confidence: "provider_metadata" },
  supportedParameters: ["temperature"], source: "provider", capturedAt: "now",
};

describe("capability snapshots", () => {
  it("accepts a captured ModelCapabilities object", () => {
    expect(parseModelCapabilitiesSnapshot(valid)).toEqual(valid);
  });

  it("rejects malformed historical JSON instead of casting it into a provider model", () => {
    expect(() => parseModelCapabilitiesSnapshot({ supportsVision: false })).toThrow("capability snapshot");
  });
});
