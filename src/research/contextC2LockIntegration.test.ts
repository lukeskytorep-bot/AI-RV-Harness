import { describe, expect, it } from "vitest";
import { prepareContextResearchDraft } from "./contextLockPreparation";
import { validateConfig } from "./planner";
import { runResearchPreflight } from "./preflight";
import type { ResearchConfig, ResearchContextBlockKey } from "./types";

const baseline = Object.fromEntries(([
  "system_prompt", "viewer_notes", "viewer_identity", "base_vocabulary",
] as ResearchContextBlockKey[]).map((key) => [key, {
  content: key === "viewer_notes" ? "notes" : key,
  source: `test:${key}`,
  availability: "available" as const,
}])) as Record<ResearchContextBlockKey, { content: string; source: string; availability: "available" }>;

async function config(): Promise<ResearchConfig> {
  const prepared = await prepareContextResearchDraft([
    { id: "standard", label: "Standard", design: { version: 1, mode: "standard" } },
    { id: "blank", label: "Tabula rasa", design: { version: 1, mode: "replace_all", content: "" } },
  ], baseline);
  return {
    schemaVersion: 1,
    name: "Context C2",
    workspaceId: "workspace",
    templateType: "context_instructions",
    sessionLanguage: "en",
    protocol: { id: "full-rcp", version: "1.5a" },
    targetIds: ["target"],
    repetitions: 1,
    requireUnusedTargets: false,
    contextPreparation: prepared,
    conditions: prepared.conditions.map((item) => ({
      key: item.id, label: item.label, profileId: "profile", providerConfigId: "provider", modelId: "model",
      requestedSettings: { maxOutputTokens: 1000 }, contextDesign: structuredClone(item.composition.design), contextComposition: structuredClone(item.composition),
    })),
    evaluationMode: "save_only",
    judges: [],
    randomization: { matchedTargets: true, randomizedExecution: true, randomizedJudgeOrder: true },
  };
}

describe("Context & Instructions C2 lock contract", () => {
  it("accepts a prepared Standard + Tabula rasa config in the lock validator", async () => {
    const value = await config();
    expect(() => validateConfig(value)).not.toThrow();
  });

  it("fails closed if a condition composition is changed after preparation", async () => {
    const value = await config();
    value.conditions[1].contextComposition!.applicationMessages.push({ role: "system", origin: "replace_all", content: "drift", sha256: "fake" });
    expect(() => validateConfig(value)).toThrow(/does not match the frozen preparation/);
  });


  it("fails closed when a config condition label drifts from the frozen preparation", async () => {
    const value = await config();
    value.conditions[0].label = "Renamed after preparation";
    expect(() => validateConfig(value)).toThrow(/label does not match the frozen preparation/);
    const result = runResearchPreflight(value, { profiles: [], providerConfigs: [], models: [], targets: [], targetUsage: [] });
    expect(result.checks.find((check) => check.id === "context_preparation")?.level).toBe("fail");
  });

  it("fails preflight when output reservation plus overhead cannot fit the advertised context window", async () => {
    const value = await config();
    value.conditions.forEach((condition) => { condition.requestedSettings.maxOutputTokens = 65_536; });
    const capabilities = { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: false, efforts: [], confidence: "unknown" as const }, temperature: { supported: false, confidence: "unknown" as const }, supportedParameters: ["max_tokens"], contextTokens: 65_536, maxOutputTokens: 65_536, source: "provider" as const, capturedAt: "now" };
    const result = runResearchPreflight(value, {
      profiles: [{ id: "profile", name: "P", credentialId: "cred", createdAt: "now", updatedAt: "now" }],
      providerConfigs: [{ id: "provider", provider: "openrouter", label: "Provider", credentialId: "cred", enabled: true, lastStatus: "ok", createdAt: "now", updatedAt: "now" }],
      models: [{ providerConfigId: "provider", provider: "openrouter", modelId: "model", displayName: "M", route: "openrouter:model", capabilities, pricing: {}, recommended: true, rawMetadata: {}, refreshedAt: "now" }],
      targets: [{ id: "target", collection: "user", title: "Target", revealText: "Reveal", tags: [], sourceMetadata: {}, createdAt: "now", updatedAt: "now" }],
      targetUsage: [],
    });
    expect(result.checks.find((check) => check.id === "condition:standard:context")?.level).toBe("fail");
    expect(result.checks.find((check) => check.id === "condition:standard:context")?.message).toMatch(/output tokens exceed/);
  });

  it("reports the frozen preparation in Preflight instead of the former C3 blocking failure", async () => {
    const value = await config();
    const result = runResearchPreflight(value, { profiles: [], providerConfigs: [], models: [], targets: [], targetUsage: [] });
    expect(result.checks.find((check) => check.id === "context_preparation")?.level).toBe("pass");
    expect(result.checks.find((check) => check.id === "context_runtime_pending")).toBeUndefined();
    expect(result.checks.find((check) => check.id === "context_runtime_gate")).toBeUndefined();
  });
});
