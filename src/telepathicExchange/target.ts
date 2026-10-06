import { sha256Text } from "../application/sha256";
import type { TelepathicLockedTarget, TelepathicTargetAsset, TelepathicTargetDraft } from "./types";

function canonicalTargetPayload(
  roundId: string,
  senderParticipantId: string,
  target: Pick<TelepathicTargetDraft, "content" | "assets">,
): string {
  return JSON.stringify({
    schemaVersion: 1,
    roundId,
    senderParticipantId,
    content: target.content,
    assets: [...(target.assets ?? [])]
      .map((asset) => ({
        artifactId: asset.artifactId,
        kind: asset.kind,
        originalFileName: asset.originalFileName,
        mimeType: asset.mimeType,
        size: asset.size,
        sha256: asset.sha256,
        shortDescription: asset.shortDescription ?? "",
      }))
      .sort((a, b) => a.artifactId.localeCompare(b.artifactId)),
  });
}

function freezeTargetAssets(assets: TelepathicTargetAsset[] = []): TelepathicTargetAsset[] {
  const copied = assets.map((asset) => Object.freeze({ ...asset })) as TelepathicTargetAsset[];
  return Object.freeze(copied) as unknown as TelepathicTargetAsset[];
}

function freezeLockedTarget(target: TelepathicLockedTarget): TelepathicLockedTarget {
  return Object.freeze({
    ...target,
    assets: freezeTargetAssets(target.assets),
  }) as TelepathicLockedTarget;
}

async function calculateLockedTargetHash(target: Pick<TelepathicLockedTarget, "roundId" | "senderParticipantId" | "content" | "assets">): Promise<string> {
  return sha256Text(canonicalTargetPayload(target.roundId, target.senderParticipantId, target));
}

export async function assertTelepathicTargetIntegrity(
  target: TelepathicLockedTarget,
  options: {
    expectedRoundId?: string;
    requireTransmissionReady?: boolean;
  } = {},
): Promise<void> {
  if (options.expectedRoundId && target.roundId !== options.expectedRoundId) {
    throw new Error("Telepathic target round does not match the round being revealed.");
  }
  if (options.requireTransmissionReady && target.status !== "transmission_ready") {
    throw new Error("Telepathic target must be transmission_ready before Reveal.");
  }
  if (!target.content.trim()) {
    throw new Error("Telepathic target content is empty after it was locked.");
  }
  const currentHash = await calculateLockedTargetHash(target);
  if (currentHash !== target.contentSha256) {
    throw new Error("Telepathic target integrity check failed: locked content or assets changed after hashing.");
  }
}

export async function lockTelepathicTarget(
  roundId: string,
  senderParticipantId: string,
  draft: TelepathicTargetDraft,
  now = new Date().toISOString(),
): Promise<TelepathicLockedTarget> {
  if (!draft.content.trim()) throw new Error("A telepathic target requires a text description before it can be locked.");
  const assets = freezeTargetAssets([...(draft.assets ?? [])]);
  const contentSha256 = await sha256Text(canonicalTargetPayload(roundId, senderParticipantId, { content: draft.content, assets }));
  return freezeLockedTarget({
    schemaVersion: 1,
    roundId,
    senderParticipantId,
    content: draft.content,
    assets,
    contentSha256,
    lockedAt: now,
    status: "locked",
  });
}

export async function markTelepathicTargetTransmissionReady(
  target: TelepathicLockedTarget,
  now = new Date().toISOString(),
): Promise<TelepathicLockedTarget> {
  await assertTelepathicTargetIntegrity(target);
  if (target.status === "transmission_ready") return target;
  return freezeLockedTarget({ ...target, status: "transmission_ready", transmissionReadyAt: now });
}
