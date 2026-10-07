import { describe, expect, it, vi } from "vitest";
import { sha256Text } from "../application/sha256";
import type { ProviderMessage } from "../providers/types";
import type { AppRepository } from "../storage/repository";
import { buildReceiverFirstPacket } from "./packets";
import { freezeTelepathicTrainingLearning, withTelepathicTrainingLearning } from "./trainingLearning";
import type { TelepathicParticipant, TelepathicSeriesConfig } from "./types";

function ai(id: string): TelepathicParticipant {
  return {
    id,
    kind: "ai",
    displayName: id.toUpperCase(),
    ai: {
      profileId: `profile-${id}`,
      profileName: id.toUpperCase(),
      workspaceId: `workspace-${id}`,
      aiIdentityId: `identity-${id}`,
      providerConfigId: `provider-${id}`,
      credentialId: `credential-${id}`,
      credentialFingerprint: `fingerprint-${id}`,
      modelId: `model-${id}`,
      route: `custom_openai:model-${id}`,
    },
  };
}

function config(): TelepathicSeriesConfig {
  return {
    schemaVersion: 1,
    seriesId: "training-learning",
    seriesWorkspaceId: "workspace-leo",
    mode: "ai_ai_training",
    language: "en",
    participants: [ai("leo"), ai("nemo")],
    roundCount: 2,
    topic: "any",
    discloseTopicToReceivers: false,
    senderPolicy: { kind: "rotate" },
  };
}

describe("STEP 4A telepathic training Viewer Learning", () => {
  it("freezes exact active Field Guide and Viewer Notes content without using any learning write API", async () => {
    const fgContent = "LEO FIELD GUIDE CONTENT";
    const vnContent = "LEO VIEWER NOTES CONTENT";
    const fgHash = await sha256Text(fgContent);
    const vnHash = await sha256Text(vnContent);
    const getExistingFieldGuideBundle = vi.fn(async (identityId: string) => identityId === "identity-leo" ? ({
      activeVersion: { id: "fg-leo-4", aiIdentityId: identityId, language: "en", versionNumber: 4, content: fgContent, contentSha256: fgHash, estimatedTokens: 17 },
    }) : null);
    const getExistingViewerNoteBundle = vi.fn(async (identityId: string) => identityId === "identity-leo" ? ({
      activeVersion: { id: "vn-leo-2", aiIdentityId: identityId, versionNumber: 2, content: vnContent, contentSha256: vnHash, estimatedTokens: 11 },
    }) : null);
    const repository = {
      getExistingFieldGuideBundle,
      getExistingViewerNoteBundle,
      createFieldGuideVersion: vi.fn(() => { throw new Error("must not write Field Guide"); }),
      commitViewerNoteReflection: vi.fn(() => { throw new Error("must not write Viewer Notes"); }),
      restoreFieldGuideVersion: vi.fn(() => { throw new Error("must not restore Field Guide"); }),
      restoreViewerNoteVersion: vi.fn(() => { throw new Error("must not restore Viewer Notes"); }),
    } as unknown as AppRepository;

    const frozen = await freezeTelepathicTrainingLearning({ repository, config: config(), now: () => "2026-10-07T12:00:00.000Z" });
    const leo = frozen.participants.find((item) => item.id === "leo")!;
    expect(leo.fieldGuide).toMatchObject({ id: "fg-leo-4", version: "4", versionNumber: 4, content: fgContent, contentSha256: fgHash, capturedAt: "2026-10-07T12:00:00.000Z" });
    expect(leo.viewerNotes).toMatchObject({ id: "vn-leo-2", version: "2", versionNumber: 2, content: vnContent, contentSha256: vnHash, capturedAt: "2026-10-07T12:00:00.000Z" });
    expect(frozen.participants.find((item) => item.id === "nemo")?.fieldGuide).toBeUndefined();
    expect(frozen.participants.find((item) => item.id === "nemo")?.viewerNotes).toBeUndefined();
    expect(getExistingFieldGuideBundle).toHaveBeenCalledTimes(2);
    expect(getExistingViewerNoteBundle).toHaveBeenCalledTimes(2);
    expect((repository.createFieldGuideVersion as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect((repository.commitViewerNoteReflection as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("adds only the selected participant's frozen learning to the provider packet and verifies hashes", async () => {
    const leo = ai("leo");
    const fg = "ONLY LEO FIELD GUIDE";
    const notes = "ONLY LEO VIEWER NOTES";
    leo.fieldGuide = { id: "fg", version: "1", versionNumber: 1, content: fg, contentSha256: await sha256Text(fg), capturedAt: "now", profileId: leo.ai!.profileId, aiIdentityId: leo.ai!.aiIdentityId, modelRoute: leo.ai!.route, language: "en" };
    leo.viewerNotes = { id: "vn", version: "2", versionNumber: 2, content: notes, contentSha256: await sha256Text(notes), capturedAt: "now", profileId: leo.ai!.profileId, aiIdentityId: leo.ai!.aiIdentityId, modelRoute: leo.ai!.route };
    const packet = buildReceiverFirstPacket({ language: "en", seriesId: "s", roundId: "r", participantId: "leo", name: "LEO", roundNumber: 1, topicLabel: "location", discloseTopic: false });
    const enriched = await withTelepathicTrainingLearning({ packet, participant: leo, language: "en" });
    const all = enriched.messages.map((message: ProviderMessage) => message.content).join("\n");
    expect(all).toContain("ONLY LEO FIELD GUIDE");
    expect(all).toContain("ONLY LEO VIEWER NOTES");
    expect(all).toContain("READ-ONLY");
    expect(all).not.toContain("location");
    expect(enriched.scopeKey).toBe(packet.scopeKey);

    const tampered = structuredClone(leo);
    tampered.fieldGuide!.content = "TAMPERED";
    await expect(withTelepathicTrainingLearning({ packet, participant: tampered, language: "en" })).rejects.toThrow(/SHA-256/);

    const wrongOwner = structuredClone(leo);
    wrongOwner.fieldGuide = { ...wrongOwner.fieldGuide!, profileId: "profile-someone-else" };
    await expect(withTelepathicTrainingLearning({ packet, participant: wrongOwner, language: "en" })).rejects.toThrow(/Profile/);

    const wrongIdentity = structuredClone(leo);
    wrongIdentity.viewerNotes = { ...wrongIdentity.viewerNotes!, aiIdentityId: "identity-someone-else" };
    await expect(withTelepathicTrainingLearning({ packet, participant: wrongIdentity, language: "en" })).rejects.toThrow(/AI Identity/);

    const wrongRoute = structuredClone(leo);
    wrongRoute.viewerNotes = { ...wrongRoute.viewerNotes!, modelRoute: "custom_openai:other-model" };
    await expect(withTelepathicTrainingLearning({ packet, participant: wrongRoute, language: "en" })).rejects.toThrow(/model route/);

    const wrongLanguage = structuredClone(leo);
    wrongLanguage.fieldGuide = { ...wrongLanguage.fieldGuide!, language: "pl" };
    await expect(withTelepathicTrainingLearning({ packet, participant: wrongLanguage, language: "en" })).rejects.toThrow(/language/);
  });
});
