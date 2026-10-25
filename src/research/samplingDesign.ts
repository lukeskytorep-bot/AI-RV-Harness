import { validateOpenRouterAdditionalSamplingSettings } from "../providers/openRouterSamplingSettings";
import type {
  ResearchConditionDefinition,
  ResearchSamplingAxis,
  ResearchSamplingConditionValues,
  ResearchSamplingDesign,
  ResearchSamplingParameter,
  ResearchConfig,
  ResearchSystemPromptSnapshot,
} from "./types";

export const RESEARCH_SAMPLING_MAX_CONFIGURATIONS = 125;
export const RESEARCH_SAMPLING_MAX_SESSIONS = 10_000;

const PARAMETERS: ResearchSamplingParameter[] = ["topP", "topK", "seed"];

export function validateResearchSamplingDesign(design: ResearchSamplingDesign): ResearchSamplingDesign {
  if (!design || typeof design !== "object" || design.version !== 1) throw new Error("Sampling design version 1 is required.");
  let varied = 0;
  for (const parameter of PARAMETERS) {
    const axis = design[parameter];
    if (!axis || (axis.mode !== "fixed" && axis.mode !== "varied")) throw new Error(`${wire(parameter)} sampling axis is invalid.`);
    if (axis.mode === "fixed") {
      if (Object.prototype.hasOwnProperty.call(axis, "value") && axis.value !== undefined) validateValue(parameter, axis.value);
    } else {
      varied += 1;
      if (!Array.isArray(axis.values) || axis.values.length < 2) throw new Error(`${wire(parameter)} varied axis requires at least two values.`);
      const normalized = axis.values.map((value) => validateValue(parameter, value));
      if (new Set(normalized.map(numberKey)).size !== normalized.length) throw new Error(`${wire(parameter)} varied axis contains duplicate numeric values.`);
    }
  }
  if (varied < 1) throw new Error("Sampling configurations requires at least one varied axis.");
  const count = researchSamplingConfigurationCount(design);
  if (count > RESEARCH_SAMPLING_MAX_CONFIGURATIONS) throw new RangeError(`Sampling design produces ${count} configurations; maximum is ${RESEARCH_SAMPLING_MAX_CONFIGURATIONS}.`);
  return structuredClone(design);
}

export function researchSamplingConfigurationCount(design: ResearchSamplingDesign): number {
  return PARAMETERS.reduce((total, parameter) => safeMultiply(total, axisValues(design[parameter]).length, "sampling configuration count"), 1);
}

export function researchSamplingSessionCount(design: ResearchSamplingDesign, targetCount: number, repetitions: number): number {
  if (!Number.isSafeInteger(targetCount) || targetCount < 1) throw new RangeError("Sampling Research target count must be a positive safe integer.");
  if (!Number.isSafeInteger(repetitions) || repetitions < 1) throw new RangeError("Sampling Research repetitions must be a positive safe integer.");
  const sessions = safeMultiply(safeMultiply(researchSamplingConfigurationCount(design), targetCount, "sampling session count"), repetitions, "sampling session count");
  if (sessions > RESEARCH_SAMPLING_MAX_SESSIONS) throw new RangeError(`Sampling design produces ${sessions} sessions; maximum is ${RESEARCH_SAMPLING_MAX_SESSIONS}.`);
  return sessions;
}

export function researchSamplingConditionValues(design: ResearchSamplingDesign): ResearchSamplingConditionValues[] {
  validateResearchSamplingDesign(design);
  return cartesian(
    axisValues(design.topP),
    axisValues(design.topK),
    axisValues(design.seed),
  ).map(([topP, topK, seed]) => ({
    ...(topP !== undefined ? { topP } : {}),
    ...(topK !== undefined ? { topK } : {}),
    ...(seed !== undefined ? { seed } : {}),
  }));
}

export function buildResearchSamplingConditions(base: ResearchConditionDefinition, design: ResearchSamplingDesign): ResearchConditionDefinition[] {
  const combinations = researchSamplingConditionValues(design);
  return combinations.map((values, index) => {
    const { topP, topK, seed } = values;
    const requestedSettings = { ...base.requestedSettings };
    delete requestedSettings.topP;
    delete requestedSettings.topK;
    delete requestedSettings.seed;
    Object.assign(requestedSettings, values);
    const cloned = structuredClone(base);
    delete cloned.effectiveSettings;
    delete cloned.capabilitySnapshot;
    return {
      ...cloned,
      key: `sampling_${String(index + 1).padStart(3, "0")}_${valueKey(values)}`,
      label: samplingConditionLabel(values),
      requestedSettings,
      samplingValues: values,
    };
  });
}

export function assertSamplingDesignMatchesConditions(design: ResearchSamplingDesign, conditions: ResearchConditionDefinition[]): void {
  validateResearchSamplingDesign(design);
  const expected = buildResearchSamplingConditions({
    ...structuredClone(conditions[0] ?? missingBase()),
    key: "base",
    label: "base",
  }, design);
  if (conditions.length !== expected.length) throw new Error(`Sampling design requires exactly ${expected.length} conditions.`);
  const expectedSignatures = expected.map((condition) => samplingValuesSignature(condition.samplingValues ?? {})).sort();
  const actualSignatures = conditions.map((condition) => {
    if (!condition.samplingValues) throw new Error(`Sampling condition ${condition.key} is missing structural samplingValues.`);
    const fromSettings = pickSampling(condition.requestedSettings);
    if (samplingValuesSignature(condition.samplingValues) !== samplingValuesSignature(fromSettings)) throw new Error(`Sampling condition ${condition.key} does not match requestedSettings.`);
    return samplingValuesSignature(condition.samplingValues);
  }).sort();
  if (expectedSignatures.join("|") !== actualSignatures.join("|")) throw new Error("Sampling conditions do not match the frozen samplingDesign Cartesian product.");

  const baseline = conditions[0];
  for (const condition of conditions.slice(1)) {
    if (nonSamplingSettingsSignature(condition.requestedSettings) !== nonSamplingSettingsSignature(baseline.requestedSettings)) {
      throw new Error("Sampling configurations may vary only top_p, top_k and seed; all other generation settings must remain fixed.");
    }
    if (condition.profileId !== baseline.profileId || condition.providerConfigId !== baseline.providerConfigId || condition.modelId !== baseline.modelId) {
      throw new Error("Sampling configurations require one fixed Viewer profile, provider connection and model.");
    }
  }
}


export function assertSamplingResearchContract(config: ResearchConfig): void {
  if (config.templateType !== "sampling") return;
  if (!config.viewerControl) throw new Error("Sampling configurations requires an explicit frozen Viewer-control record.");
  if (!config.viewerControl.sampling) throw new Error("Sampling configurations requires an explicit frozen sampling control.");
  if (config.viewerControl.sampling.mode !== "condition_variable" || config.viewerControl.sampling.source !== "research") {
    throw new Error("Sampling configurations requires Viewer sampling control source=research and mode=condition_variable.");
  }
  const profileIds = new Set(config.conditions.map((condition) => condition.profileId));
  if (profileIds.size !== 1 || !profileIds.has(config.viewerControl.sampling.profileId)) {
    throw new Error("Sampling configurations Viewer sampling control must reference the one frozen Viewer profile used by every condition.");
  }
  if (!config.samplingDesign) throw new Error("Sampling configurations requires frozen samplingDesign metadata.");
  assertSamplingDesignMatchesConditions(config.samplingDesign, config.conditions);
  assertSamplingConditionInstructionInvariant(config.conditions);
}

export function assertSamplingConditionInstructionInvariant(conditions: ResearchConditionDefinition[]): void {
  const snapshots = conditions.map((condition) => condition.conditionInstruction);
  const present = snapshots.filter((snapshot): snapshot is ResearchSystemPromptSnapshot => Boolean(snapshot));
  if (present.length === 0) return;
  if (present.length !== snapshots.length) {
    throw new Error("Sampling configurations requires conditionInstruction to be absent everywhere or frozen identically across every condition.");
  }
  const baseline = conditionInstructionSignature(present[0]);
  if (present.some((snapshot) => conditionInstructionSignature(snapshot) !== baseline)) {
    throw new Error("Sampling configurations requires one identical frozen conditionInstruction across every condition.");
  }
}

export function samplingConditionLabel(values: ResearchSamplingConditionValues): string {
  return `top_p=${display(values.topP)} · top_k=${display(values.topK)} · seed=${display(values.seed)}`;
}

export function samplingValuesSignature(values: ResearchSamplingConditionValues): string {
  return PARAMETERS.map((parameter) => `${parameter}:${values[parameter] === undefined ? "auto" : numberKey(values[parameter]!)}`).join("|");
}


function conditionInstructionSignature(snapshot: ResearchSystemPromptSnapshot): string {
  return canonicalJson({
    id: snapshot.id,
    version: snapshot.version,
    content: snapshot.content,
    contentSha256: snapshot.contentSha256,
    fieldGuide: snapshot.fieldGuide ?? null,
  });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function axisValues(axis: ResearchSamplingAxis): Array<number | undefined> {
  return axis.mode === "fixed" ? [axis.value] : [...axis.values];
}

function validateValue(parameter: ResearchSamplingParameter, value: number): number {
  validateOpenRouterAdditionalSamplingSettings({ enabled: true, [parameter]: value });
  return value;
}

function pickSampling(settings: ResearchConditionDefinition["requestedSettings"]): ResearchSamplingConditionValues {
  return {
    ...(settings.topP !== undefined ? { topP: settings.topP } : {}),
    ...(settings.topK !== undefined ? { topK: settings.topK } : {}),
    ...(settings.seed !== undefined ? { seed: settings.seed } : {}),
  };
}

function nonSamplingSettingsSignature(settings: ResearchConditionDefinition["requestedSettings"]): string {
  const clone = { ...settings };
  delete clone.topP;
  delete clone.topK;
  delete clone.seed;
  return JSON.stringify(Object.keys(clone).sort().map((key) => [key, (clone as unknown as Record<string, unknown>)[key]]));
}

function cartesian(a: Array<number | undefined>, b: Array<number | undefined>, c: Array<number | undefined>): Array<[number | undefined, number | undefined, number | undefined]> {
  const rows: Array<[number | undefined, number | undefined, number | undefined]> = [];
  for (const topP of a) for (const topK of b) for (const seed of c) rows.push([topP, topK, seed]);
  return rows;
}

function safeMultiply(left: number, right: number, label: string): number {
  const value = left * right;
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} exceeds the safe integer range.`);
  return value;
}

function numberKey(value: number): string { return Object.is(value, -0) ? "0" : String(value); }
function display(value: number | undefined): string { return value === undefined ? "Auto" : numberKey(value); }
function wire(parameter: ResearchSamplingParameter): string { return parameter === "topP" ? "top_p" : parameter === "topK" ? "top_k" : "seed"; }
function valueKey(values: ResearchSamplingConditionValues): string {
  return `tp_${token(values.topP)}_tk_${token(values.topK)}_sd_${token(values.seed)}`;
}
function token(value: number | undefined): string { return value === undefined ? "auto" : numberKey(value).replace("-", "m").replace(".", "p"); }
function missingBase(): ResearchConditionDefinition { throw new Error("Sampling configurations require at least one condition."); }
