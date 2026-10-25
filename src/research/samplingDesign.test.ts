import { describe, expect, it } from "vitest";
import {
  RESEARCH_SAMPLING_MAX_CONFIGURATIONS,
  assertSamplingDesignMatchesConditions,
  assertSamplingResearchContract,
  buildResearchSamplingConditions,
  researchSamplingConfigurationCount,
  researchSamplingSessionCount,
  validateResearchSamplingDesign,
} from "./samplingDesign";
import { buildResearchLockPlan, validateConfig } from "./planner";
import type { ResearchConditionDefinition, ResearchConfig, ResearchSamplingDesign } from "./types";

const base: ResearchConditionDefinition = {
  key: "base",
  label: "Base",
  profileId: "p",
  providerConfigId: "pc",
  modelId: "m",
  requestedSettings: { temperature: 0.7, maxOutputTokens: 32768 },
};

function design(topP: number[], topK: number[] = [40], seed: number[] = [123]): ResearchSamplingDesign {
  return {
    version: 1,
    topP: topP.length === 1 ? { mode: "fixed", value: topP[0] } : { mode: "varied", values: topP },
    topK: topK.length === 1 ? { mode: "fixed", value: topK[0] } : { mode: "varied", values: topK },
    seed: seed.length === 1 ? { mode: "fixed", value: seed[0] } : { mode: "varied", values: seed },
  };
}

function config(d: ResearchSamplingDesign, targets = ["t1"], repetitions = 1): ResearchConfig {
  return {
    schemaVersion: 1,
    name: "Sampling grid",
    workspaceId: "w",
    templateType: "sampling",
    sessionLanguage: "en",
    protocol: { id: "full-rcp", version: "1.5a" },
    targetIds: targets,
    repetitions,
    requireUnusedTargets: false,
    viewerControl: {
      model: { mode: "fixed", modelId: "m" },
      systemPrompt: { mode: "fixed", source: "locked_only" },
      reasoning: { mode: "provider_default" },
      temperature: { mode: "fixed", value: 0.7 },
      sampling: { source: "research", profileId: "p", mode: "condition_variable" },
      maxOutputTokens: 32768,
    },
    samplingDesign: d,
    conditions: buildResearchSamplingConditions(base, d),
    evaluationMode: "save_only",
    judges: [],
    randomization: { matchedTargets: true, randomizedExecution: true, randomizedJudgeOrder: true },
  };
}

describe("Research sampling design", () => {
  it("builds one-, two-, and three-axis Cartesian products exactly once", () => {
    const one = design([0.7, 0.8, 0.9]);
    const two = design([0.7, 0.8, 0.9], [20, 40]);
    const three = design([0.7, 0.8, 0.9], [20, 40], [123, 456]);
    expect(researchSamplingConfigurationCount(one)).toBe(3);
    expect(researchSamplingConfigurationCount(two)).toBe(6);
    expect(researchSamplingConfigurationCount(three)).toBe(12);
    const rows = buildResearchSamplingConditions(base, three);
    expect(rows).toHaveLength(12);
    expect(new Set(rows.map((row) => JSON.stringify(row.samplingValues))).size).toBe(12);
    expect(rows.every((row) => row.requestedSettings.temperature === 0.7 && row.requestedSettings.maxOutputTokens === 32768)).toBe(true);
  });

  it("keeps fixed Auto absent and preserves explicit zero", () => {
    const d: ResearchSamplingDesign = {
      version: 1,
      topP: { mode: "fixed" },
      topK: { mode: "varied", values: [0, 40] },
      seed: { mode: "fixed" },
    };
    const rows = buildResearchSamplingConditions(base, d);
    expect(rows.map((row) => row.requestedSettings.topK)).toEqual([0, 40]);
    expect(rows.every((row) => !("topP" in row.requestedSettings) && !("seed" in row.requestedSettings))).toBe(true);
    expect(rows[0].samplingValues).toEqual({ topK: 0 });
  });

  it("rejects duplicate numeric values, invalid ranges and a design with no varied axis", () => {
    expect(() => validateResearchSamplingDesign(design([0.9, 0.90]))).toThrow(/duplicate/i);
    expect(() => validateResearchSamplingDesign(design([0.7, 1.1]))).toThrow(/top_p/i);
    expect(() => validateResearchSamplingDesign(design([0.7, 0.8], [1.5, 2]))).toThrow(/top_k/i);
    expect(() => validateResearchSamplingDesign({ version: 1, topP: { mode: "fixed", value: 0.9 }, topK: { mode: "fixed", value: 40 }, seed: { mode: "fixed", value: 123 } })).toThrow(/at least one varied axis/i);
  });

  it("enforces central configuration/session limits before lock", () => {
    const tooMany: ResearchSamplingDesign = {
      version: 1,
      topP: { mode: "varied", values: Array.from({ length: RESEARCH_SAMPLING_MAX_CONFIGURATIONS + 1 }, (_, i) => i / (RESEARCH_SAMPLING_MAX_CONFIGURATIONS + 1)) },
      topK: { mode: "fixed", value: 40 },
      seed: { mode: "fixed", value: 123 },
    };
    expect(() => validateResearchSamplingDesign(tooMany)).toThrow(/maximum/i);
    expect(researchSamplingSessionCount(design([0.7, 0.8, 0.9], [20, 40], [123, 456]), 10, 2)).toBe(240);
  });

  it("rejects tampered conditions independently of UI", () => {
    const d = design([0.7, 0.8], [20, 40]);
    const rows = buildResearchSamplingConditions(base, d);
    rows[0].requestedSettings.seed = 999;
    expect(() => assertSamplingDesignMatchesConditions(d, rows)).toThrow(/does not match requestedSettings/i);
    const changed = buildResearchSamplingConditions(base, d);
    changed[1].requestedSettings.temperature = 0.8;
    expect(() => assertSamplingDesignMatchesConditions(d, changed)).toThrow(/only top_p, top_k and seed/i);
  });

  it("creates every condition for every target/repetition with the same pairKey", async () => {
    const d = design([0.7, 0.8, 0.9], [20, 40], [123, 456]);
    const targets = Array.from({ length: 10 }, (_, index) => `t${index + 1}`);
    const cfg = config(d, targets, 2);
    expect(() => validateConfig(cfg)).not.toThrow();
    const plan = await buildResearchLockPlan("research_sampling", cfg);
    expect(plan.conditions).toHaveLength(12);
    expect(plan.assignments).toHaveLength(240);
    const mappingByPair = new Map<string, typeof plan.mappings>();
    for (const mapping of plan.mappings) mappingByPair.set(mapping.pairKey, [...(mappingByPair.get(mapping.pairKey) ?? []), mapping]);
    expect(mappingByPair.size).toBe(20);
    expect([...mappingByPair.values()].every((group) => group.length === 12)).toBe(true);
  });

  it("requires an explicit sampling Viewer-control record for the new template", () => {
    const d = design([0.7, 0.8]);
    const valid = config(d);
    expect(() => assertSamplingResearchContract(valid)).not.toThrow();

    const withoutViewerControl = structuredClone(valid);
    delete withoutViewerControl.viewerControl;
    expect(() => validateConfig(withoutViewerControl)).toThrow(/Viewer-control/i);

    const withoutSampling = structuredClone(valid);
    delete withoutSampling.viewerControl!.sampling;
    expect(() => validateConfig(withoutSampling)).toThrow(/sampling control/i);

    const wrongMode = structuredClone(valid);
    wrongMode.viewerControl!.sampling = { source: "research", profileId: "p", mode: "fixed", topP: 0.7 };
    expect(() => validateConfig(wrongMode)).toThrow(/mode=condition_variable/i);

    const wrongSource = structuredClone(valid);
    wrongSource.viewerControl!.sampling = { source: "profile", profileId: "p", mode: "condition_variable" };
    expect(() => validateConfig(wrongSource)).toThrow(/source=research/i);
  });

  it("requires conditionInstruction to be absent or byte-semantically identical across Sampling conditions", () => {
    const d = design([0.7, 0.8]);
    const oneOnly = config(d);
    oneOnly.conditions[1].conditionInstruction = { id: "i", version: "1", content: "DIFFERENT", contentSha256: "a".repeat(64) };
    expect(() => validateConfig(oneOnly)).toThrow(/conditionInstruction/i);

    const differentContent = config(d);
    differentContent.conditions[0].conditionInstruction = { id: "i", version: "1", content: "A", contentSha256: "a".repeat(64) };
    differentContent.conditions[1].conditionInstruction = { id: "i", version: "1", content: "B", contentSha256: "b".repeat(64) };
    expect(() => validateConfig(differentContent)).toThrow(/identical frozen conditionInstruction/i);

    const lyingHash = config(d);
    lyingHash.conditions[0].conditionInstruction = { id: "i", version: "1", content: "A", contentSha256: "f".repeat(64) };
    lyingHash.conditions[1].conditionInstruction = { id: "i", version: "1", content: "B", contentSha256: "f".repeat(64) };
    expect(() => validateConfig(lyingHash)).toThrow(/identical frozen conditionInstruction/i);

    const common = config(d);
    const snapshot = { id: "i", version: "1", content: "COMMON", contentSha256: "c".repeat(64) };
    common.conditions.forEach((condition) => { condition.conditionInstruction = structuredClone(snapshot); });
    expect(() => validateConfig(common)).not.toThrow();
  });

});
