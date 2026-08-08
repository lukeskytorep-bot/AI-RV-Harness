import target01 from "../resources/targets/target_1.md?raw";
import target02 from "../resources/targets/target_2.md?raw";
import target03 from "../resources/targets/target_3.md?raw";
import target04 from "../resources/targets/target_4.md?raw";
import target05 from "../resources/targets/target_5.md?raw";
import target06 from "../resources/targets/target_6.md?raw";
import target07 from "../resources/targets/target_7.md?raw";
import target08 from "../resources/targets/target_8.md?raw";
import target09 from "../resources/targets/target_9.md?raw";
import target10 from "../resources/targets/target_10.md?raw";
import type { AppRepository } from "../storage/repository";

export const STARTER_TARGET_PACK_ID = "ai-rv-harness-starter-10";
export const STARTER_TARGET_PACK_VERSION = "1.0.0";

const sourceTargets = [target01, target02, target03, target04, target05, target06, target07, target08, target09, target10] as const;

export interface BundledTrainingTarget {
  id: string;
  targetId: number;
  sourceFile: string;
  title: string;
  revealText: string;
}

export const BUNDLED_TRAINING_TARGETS: readonly BundledTrainingTarget[] = sourceTargets.map((revealText, index) => {
  const targetId = index + 1;
  return {
    id: `training_${targetId}`,
    targetId,
    sourceFile: `target_${targetId}.md`,
    title: extractTargetTitle(revealText, targetId),
    revealText,
  };
});

export async function ensureBundledTrainingTargets(repository: Pick<AppRepository, "listTargets" | "createTarget">): Promise<number> {
  const existingIds = new Set((await repository.listTargets()).map((target) => target.id));
  let created = 0;
  for (const target of BUNDLED_TRAINING_TARGETS) {
    if (existingIds.has(target.id)) continue;
    await repository.createTarget({
      id: target.id,
      collection: "training",
      title: target.title,
      revealText: target.revealText,
      tags: ["starter"],
      sourceMetadata: {
        origin: "bundled_starter_pack",
        packId: STARTER_TARGET_PACK_ID,
        packVersion: STARTER_TARGET_PACK_VERSION,
        targetId: target.targetId,
        sourceFile: target.sourceFile,
        provenance: "project_author_supplied",
      },
      contentHash: await sha256Text(target.revealText),
    });
    existingIds.add(target.id);
    created += 1;
  }
  return created;
}

function extractTargetTitle(content: string, targetId: number): string {
  const match = content.match(/^\*\*Target:\*\*\s*(.+?)\s*$/m);
  return match?.[1]?.trim() || `Target ${targetId}`;
}

async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
