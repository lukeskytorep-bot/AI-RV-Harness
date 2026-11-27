import { sha256Text } from "../application/sha256";
import {
  RESEARCH_CONTEXT_BLOCK_KEYS,
  type ResearchContextBaseBlock,
  type ResearchContextBlockKey,
  type ResearchContextConditionDesign,
  type ResearchContextFrozenBlock,
  type ResearchContextApplicationMessage,
  type ResearchFrozenContextComposition,
} from "./types";

/**
 * Deterministic logical context composition. It does NOT create the full provider
 * request or include protocol/task messages. Execution uses the frozen composition
 * through the separate Research lock and runtime validation paths.
 *
 * The system_prompt base block represents the existing editable/Field Guide
 * portion; identity and vocabulary remain separate *logical* blocks here.
 */
export const RESEARCH_CONTEXT_ADDITION_SEPARATOR = "\n\n";
const MAX_BLOCK_CHARS = 120_000;
const KEY_ORDER = RESEARCH_CONTEXT_BLOCK_KEYS;

type BaseBlocks = Record<ResearchContextBlockKey, ResearchContextBaseBlock>;

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export function assertResearchContextDesign(design: ResearchContextConditionDesign): void {
  if (design.version !== 1) throw new Error("Unsupported context design version.");
  if (design.mode === "standard") return;
  if (design.mode === "replace_all") {
    if (typeof design.content !== "string" || design.content.length > MAX_BLOCK_CHARS) {
      throw new Error("Replace-all context must be text within the size limit.");
    }
    return;
  }
  if (design.mode === "selected_only") {
    if (!Array.isArray(design.blocks) || design.blocks.some((key) => !KEY_ORDER.includes(key)) ||
        new Set(design.blocks).size !== design.blocks.length) {
      throw new Error("Select distinct, known context blocks.");
    }
    return;
  }
  if (design.mode !== "add_to_selected" || !design.additions || typeof design.additions !== "object" || Array.isArray(design.additions)) {
    throw new Error("Unsupported context design mode or additions.");
  }
  const keys = Object.keys(design.additions);
  if (!keys.length) throw new Error("Add-to-selected requires at least one target block.");
  for (const key of keys) {
    if (!KEY_ORDER.includes(key as ResearchContextBlockKey)) throw new Error(`Unknown context block: ${key}`);
    const value = design.additions[key as ResearchContextBlockKey];
    if (typeof value !== "string" || value.length === 0 || value.length > MAX_BLOCK_CHARS) {
      throw new Error(`Context addition to ${key} must be nonempty text within the size limit.`);
    }
  }
}

function assertBaseBlocks(blocks: BaseBlocks): void {
  if (!blocks || typeof blocks !== "object") throw new Error("Missing research base blocks.");
  for (const key of KEY_ORDER) {
    if (!hasOwn(blocks, key)) throw new Error(`Missing research base block ${key}.`);
    const block = blocks[key];
    if (!block || typeof block.content !== "string" || block.content.length > MAX_BLOCK_CHARS ||
        typeof block.source !== "string" || !block.source ||
        !["available", "unavailable", "disabled"].includes(block.availability)) {
      throw new Error(`Invalid base block ${key}.`);
    }
    if (block.availability !== "available" && block.content.length > 0) {
      throw new Error(`Nonavailable block ${key} cannot contain a hidden base prompt.`);
    }
  }
}

function appendExact(base: string, extra: string): string {
  return base.length > 0 ? `${base}${RESEARCH_CONTEXT_ADDITION_SEPARATOR}${extra}` : extra;
}

async function freezeBlock(block: ResearchContextBaseBlock, content: string, enabled: boolean): Promise<ResearchContextFrozenBlock> {
  return {
    content,
    sha256: await sha256Text(content),
    enabled,
    source: block.source,
    ...(block.version === undefined ? {} : { version: block.version }),
    availability: block.availability,
  };
}

/** Canonical manifest uses explicit order; whitespace in user text is preserved byte-for-byte. */
export async function composeResearchContext(
  design: ResearchContextConditionDesign,
  blocks: BaseBlocks,
): Promise<ResearchFrozenContextComposition> {
  assertResearchContextDesign(design);
  assertBaseBlocks(blocks);
  const baseBlocks = {} as ResearchFrozenContextComposition["baseBlocks"];
  const effectiveBlocks = {} as ResearchFrozenContextComposition["effectiveBlocks"];
  const messages: ResearchContextApplicationMessage[] = [];

  for (const key of KEY_ORDER) {
    const base = blocks[key];
    baseBlocks[key] = await freezeBlock(base, base.content, base.availability === "available" && base.content.length > 0);
    const addition = design.mode === "add_to_selected" ? design.additions[key] : undefined;
    const selected = design.mode !== "selected_only" || design.blocks.includes(key);
    if (design.mode === "selected_only" && selected && (base.availability !== "available" || !base.content.trim())) {
      throw new Error(`Selected context block ${key} is unavailable or empty.`);
    }
    const omitted = design.mode === "replace_all" || !selected;
    const content = omitted ? "" : addition === undefined ? base.content : appendExact(base.content, addition);
    const enabled = content.length > 0;
    effectiveBlocks[key] = await freezeBlock(base, content, enabled);
    if (enabled) messages.push({ role: "system", origin: key, content, sha256: effectiveBlocks[key].sha256 });
  }

  if (design.mode === "replace_all" && design.content.length > 0) {
    messages.push({ role: "system", origin: "replace_all", content: design.content, sha256: await sha256Text(design.content) });
  }

  // Hash both original and effective blocks, source states, message order and
  // exact design, so position changes cannot collide even for equal text.
  const canonical = JSON.stringify({
    version: 1,
    design: design.mode === "standard"
      ? { version: 1, mode: "standard" }
      : design.mode === "replace_all"
        ? { version: 1, mode: "replace_all", content: design.content }
        : design.mode === "selected_only"
          ? { version: 1, mode: "selected_only", blocks: KEY_ORDER.filter((key) => design.blocks.includes(key)) }
          : { version: 1, mode: "add_to_selected", additions: KEY_ORDER.filter((key) => hasOwn(design.additions, key)).map((key) => [key, design.additions[key]]) },
    baseBlocks: KEY_ORDER.map((key) => [key, baseBlocks[key]]),
    effectiveBlocks: KEY_ORDER.map((key) => [key, effectiveBlocks[key]]),
    applicationMessages: messages,
  });
  return {
    version: 1,
    design: structuredClone(design),
    baseBlocks,
    effectiveBlocks,
    applicationMessages: messages,
    compositionSha256: await sha256Text(canonical),
  };
}
