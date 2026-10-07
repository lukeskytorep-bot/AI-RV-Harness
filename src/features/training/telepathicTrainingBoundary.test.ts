import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const screen = readFileSync(new URL("./TrainingScreen.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("./TelepathicTrainingPanel.tsx", import.meta.url), "utf8");

describe("STEP 4B telepathic training UI boundary", () => {
  it("keeps standard Training and AI-AI Telepathic Training as separate surfaces", () => {
    expect(screen).toContain('"standard" | "telepathic"');
    expect(screen).toContain("<TelepathicTrainingPanel");
    expect(panel).toContain('mode: "ai_ai_training"');
    expect(panel).toContain("createTelepathicAiTrainingSeries");
  });

  it("uses 2-6 distinct Profiles, rotating sender, frozen learning and shared durable recovery", () => {
    expect(panel).toContain("selectedProfileIds.length >= 2");
    expect(panel).toContain("selectedProfileIds.length <= 6");
    expect(panel).toContain('senderPolicy: { kind: "rotate" }');
    expect(panel).toContain("runNextTelepathicAiRound");
    expect(panel).toContain("resumeBlockedTelepathicSeries");
    expect(panel).toContain("allowRetryForUncertainTelepathicCall");
    expect(panel).toContain("runTelepathicFinalReflections");
  });

  it("shows the operator full round content while leaving provider isolation to the shared engine", () => {
    expect(panel).toContain("currentViewRound.target.content");
    expect(panel).toContain("blind?.first");
    expect(panel).toContain("reflection?.reflection");
    expect(panel).toContain("resolveTelepathicAiRouteFromRepository");
  });
});
