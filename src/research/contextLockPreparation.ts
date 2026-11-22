import { sha256Text } from "../application/sha256";
import { composeResearchContext } from "./contextComposition";
import { validateResearchContextDraft, type ResearchContextDraftCondition } from "./contextDesignDraft";
import {
  RESEARCH_CONTEXT_BLOCK_KEYS,
  type ResearchContextBaseBlock,
  type ResearchContextBlockKey,
  type ResearchPreparedContextDraft,
} from "./types";

type BaseBlocks = Record<ResearchContextBlockKey, ResearchContextBaseBlock>;

/**
 * C2 deterministic preparation for Preflight and Experiment Lock. It freezes
 * the four logical Viewer-context blocks but deliberately does NOT construct
 * the final provider wire payload or authorize session execution; those remain
 * C3 responsibilities. No defaults are invented inside this function.
 */
export type PreparedContextResearchDraft = ResearchPreparedContextDraft;
function canonicalBase(blocks: BaseBlocks): BaseBlocks {
  return Object.fromEntries(RESEARCH_CONTEXT_BLOCK_KEYS.map((key) => {
    const block = blocks?.[key];
    if (!block) throw new Error(`Missing baseline block ${key}.`);
    return [key, {
      content: block.content,
      source: block.source,
      availability: block.availability,
      ...(block.version === undefined ? {} : { version: block.version }),
    }];
  })) as BaseBlocks;
}

function canonicalJson(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === "object") {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => [key, normalize(nested)]),
      );
    }
    return input;
  };
  return JSON.stringify(normalize(value));
}

function canonicalPreparedPayload(prepared: Omit<PreparedContextResearchDraft, "preparationSha256">): string {
  return canonicalJson({
    version: 1,
    kind: "context_instructions_prepared",
    baseBlocks: RESEARCH_CONTEXT_BLOCK_KEYS.map((key) => [key, prepared.baseBlocks[key]]),
    conditions: prepared.conditions.map(({ id, label, composition }) => [id, label, composition.compositionSha256]),
  });
}

/** Explicit baseline is captured once and reused across every condition. */
export async function prepareContextResearchDraft(
  conditions: readonly ResearchContextDraftCondition[],
  baseline: BaseBlocks,
): Promise<PreparedContextResearchDraft> {
  // Capture all caller-owned inputs before any asynchronous work. Future UI or
  // adapter mutations must not be able to alter the snapshot being prepared.
  const frozenConditions = structuredClone(conditions) as ResearchContextDraftCondition[];
  const frozenBaseline = structuredClone(baseline) as BaseBlocks;
  const errors = validateResearchContextDraft(frozenConditions);
  if (errors.length) throw new Error(errors.join("\n"));
  const baseBlocks = canonicalBase(frozenBaseline);
  const prepared: Omit<PreparedContextResearchDraft, "preparationSha256"> = {
    version: 1,
    kind: "context_instructions_prepared",
    baseBlocks: structuredClone(baseBlocks),
    conditions: await Promise.all(frozenConditions.map(async ({ id, label, design }) => ({
      id,
      label,
      composition: await composeResearchContext(design, baseBlocks),
    }))),
  };
  return { ...prepared, preparationSha256: await sha256Text(canonicalPreparedPayload(prepared)) };
}

/** Detect edits before Experiment Lock and when a locked project is reopened. */
export async function assertPreparedContextResearchDraft(prepared: PreparedContextResearchDraft): Promise<void> {
  if (prepared?.version !== 1 || prepared.kind !== "context_instructions_prepared" || !Array.isArray(prepared.conditions)) {
    throw new Error("Unsupported prepared context research draft.");
  }
  const designs = prepared.conditions.map(({ id, label, composition }) => ({ id, label, design: composition.design }));
  const reconstructed = await prepareContextResearchDraft(designs, prepared.baseBlocks);
  if (reconstructed.preparationSha256 !== prepared.preparationSha256) {
    throw new Error("Prepared context research fingerprint changed.");
  }
  for (let index = 0; index < prepared.conditions.length; index += 1) {
    // Rebuilding the full composition is essential: matching the stored SHA
    // alone would not catch independently altered message or block contents.
    const actual = prepared.conditions[index].composition;
    const expected = reconstructed.conditions[index].composition;
    const same = actual.version === expected.version
      && actual.compositionSha256 === expected.compositionSha256
      && canonicalJson(actual.design) === canonicalJson(expected.design)
      && RESEARCH_CONTEXT_BLOCK_KEYS.every((key) => canonicalJson(actual.baseBlocks[key]) === canonicalJson(expected.baseBlocks[key])
        && canonicalJson(actual.effectiveBlocks[key]) === canonicalJson(expected.effectiveBlocks[key]))
      && canonicalJson(actual.applicationMessages) === canonicalJson(expected.applicationMessages);
    if (!same) throw new Error(`Frozen context composition changed for condition ${prepared.conditions[index].id}.`);
  }
}
