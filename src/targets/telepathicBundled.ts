import type { AppRepository } from "../storage/repository";

export const TELEPATHIC_STARTER_PACK_ID = "telepathic-user-targets-10";
export const TELEPATHIC_STARTER_PACK_VERSION = "1.0.0";

const sourceModules = import.meta.glob<string>("../resources/telepathic-targets/t*.md", {
  eager: true,
  query: "?raw",
  import: "default",
});

export interface BundledTelepathicTarget {
  id: string;
  order: number;
  sourceFile: string;
  title: string;
  targetCode?: string;
  revealText: string;
}

export const BUNDLED_TELEPATHIC_TARGETS: readonly BundledTelepathicTarget[] = Object.entries(sourceModules)
  .map(([path, revealText]) => {
    const sourceFile = path.split("/").at(-1) ?? path;
    const order = Number(sourceFile.match(/^t(\d+)\.md$/i)?.[1] ?? 0);
    const title = revealText.match(/^\*\s+\*\*Historical Identity:\*\*\s*(.+?)\s*$/mi)?.[1]?.trim();
    const targetCode = revealText.match(/^\*\s+\*\*Target Number:\*\*\s*(.+?)\s*$/mi)?.[1]?.trim();
    if (!order || !title) throw new Error(`Invalid bundled telepathic target source: ${sourceFile}`);
    return {
      id: `user_telepathic_starter_${String(order).padStart(2, "0")}`,
      order,
      sourceFile,
      title,
      ...(targetCode ? { targetCode } : {}),
      revealText: revealText.trim(),
    };
  })
  .sort((left, right) => left.order - right.order);

export async function seedBundledTelepathicTargets(repository: Pick<AppRepository, "listTargets" | "createTarget">): Promise<number> {
  if (BUNDLED_TELEPATHIC_TARGETS.length !== 10) throw new Error(`Telepathic starter pack is incomplete: ${BUNDLED_TELEPATHIC_TARGETS.length}/10`);
  const existingIds = new Set((await repository.listTargets()).map((target) => target.id));
  let created = 0;
  for (const target of BUNDLED_TELEPATHIC_TARGETS) {
    if (existingIds.has(target.id)) continue;
    await repository.createTarget({
      id: target.id,
      collection: "user",
      title: target.title,
      revealText: target.revealText,
      tags: ["telepathic", "starter-pack", ...(target.targetCode ? [target.targetCode] : [])],
      sourceMetadata: {
        origin: "bundled_user_telepathic_starter_pack",
        targetKind: "telepathic",
        packId: TELEPATHIC_STARTER_PACK_ID,
        packVersion: TELEPATHIC_STARTER_PACK_VERSION,
        starterOrder: target.order,
        sourceFile: target.sourceFile,
        editable: true,
        deletable: true,
        provenance: "project_author_supplied",
      },
      contentHash: await sha256Text(target.revealText),
    });
    existingIds.add(target.id);
    created += 1;
  }
  return created;
}

async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
