import { describe, expect, it } from "vitest";
import { buildJudgePacket } from "./judgePacket";

describe("Judge packet allowlist", () => {
  it("drops experimental and technical metadata even when supplied on the input object", () => {
    const packet = buildJudgePacket({
      anonymousSessionId: "BlindSession_X7F2K9",
      preRevealEvidence: "Hard angular form; cool surface.",
      reveal: { text: "Reference target" },
      rubricVersion: "3-3-2-2/v1",
      viewerModel: "secret-condition-model",
      profile: "Leo",
      reasoning: "HIGH",
      condition: "SECOND",
      temperature: 1.5,
      runNumber: 2,
      masterRecord: { apiKeyFingerprint: "must-not-leak" },
    });
    const wire = JSON.stringify(packet);

    expect(Object.keys(packet).sort()).toEqual(
      ["anonymousSessionId", "preRevealEvidence", "reveal", "rubricVersion"].sort(),
    );
    expect(wire).not.toContain("secret-condition-model");
    expect(wire).not.toContain("Leo");
    expect(wire).not.toContain("HIGH");
    expect(wire).not.toContain("SECOND");
    expect(wire).not.toContain("must-not-leak");
  });
});
