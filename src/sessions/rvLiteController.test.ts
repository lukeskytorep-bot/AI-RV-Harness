import { describe, expect, it } from "vitest";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import { getRvLite } from "../resources/protocolRegistry";
import type { AppRepository } from "../storage/repository";
import type { TargetRecord } from "../targets/types";
import { injectRvLiteSpecialTask, runAutomaticRvLiteSession } from "./rvLiteController";
import type { SessionSnapshot } from "./types";

const config: ProviderConfig = { id: "p", provider: "openrouter", label: "P", credentialId: "c", enabled: true, createdAt: "now", updatedAt: "now" };
const model: ProviderModel = {
  providerConfigId: "p", provider: "openrouter", modelId: "m", displayName: "M", route: "openrouter:m", pricing: {}, recommended: false, rawMetadata: {}, refreshedAt: "now",
  capabilities: { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: false, confidence: "unknown" }, supportedParameters: [], maxOutputTokens: 4096, source: "provider", capturedAt: "now" },
};
const target: TargetRecord = { id: "training_1", collection: "training", title: "Secret target", revealText: "SECRET REVEAL", tags: [], sourceMetadata: {}, createdAt: "now", updatedAt: "now" };

function repository(log: string[], snapshots: SessionSnapshot[] = []) {
  return {
    createRvSession: async () => ({} as never),
    updateRvSessionState: async (_id: string, state: string) => { log.push(`state:${state}`); },
    appendSessionEvent: async (_id: string, event: { eventType: string }) => { log.push(event.eventType); },
    updatePreRevealTranscript: async () => { log.push("saved"); },
    saveSessionSnapshot: async (_id: string, snapshot: SessionSnapshot) => { snapshots.push(snapshot); },
    sealPreReveal: async () => { log.push("sealed"); },
    acceptReveal: async () => { log.push("reveal"); },
    recordTargetUsage: async () => undefined,
  } as unknown as Pick<AppRepository, "createRvSession" | "updateRvSessionState" | "appendSessionEvent" | "updatePreRevealTranscript" | "saveSessionSnapshot" | "sealPreReveal" | "acceptReveal" | "recordTargetUsage">;
}

describe("automatic RV Lite controller", () => {
  it("runs exactly four blind calls, persists each response first, deepens in Prompt 3, and reveals only after sealing", async () => {
    const log: string[] = [];
    const snapshots: SessionSnapshot[] = [];
    const requests: string[] = [];
    let calls = 0;
    const result = await runAutomaticRvLiteSession({
      repository: repository(log, snapshots), workspaceId: "w", profileId: "profile", profileName: "Leo", providerConfig: config, model,
      protocol: getRvLite("pl"), sessionLanguage: "pl", requestedSettings: { maxOutputTokens: 1024 }, automaticTarget: target,
      rvSystemPrompt: { id: "profile_prompt", version: "1", content: "FIXED PROFILE VIEWER PROMPT", contentSha256: "a".repeat(64) },
      chat: async ({ messages }) => {
        calls += 1;
        if (calls > 1) expect(log.filter((item) => item === "saved")).toHaveLength(calls - 1);
        const payload = JSON.stringify(messages);
        expect(payload).not.toContain("SECRET REVEAL");
        expect(messages[0]).toEqual({ role: "system", content: "FIXED PROFILE VIEWER PROMPT" });
        requests.push(messages.at(-1)?.content ?? "");
        return { content: `Blind evidence ${calls}`, usage: {} };
      },
    });
    expect(calls).toBe(4);
    expect(requests[0]).toContain("Witaj Leo, przedstawiam układ sesji RV.");
    expect(requests[2]).toContain("obowiązkowo wykonaj Deepening Movement");
    expect(requests[3]).toContain("Teraz wykonaj Krok 4.");
    expect(log.filter((item) => item === "saved")).toHaveLength(4);
    expect(log.indexOf("sealed")).toBeLessThan(log.indexOf("reveal"));
    expect(result.state).toBe("Revealed");
    expect(snapshots[0].rvSystemPrompt).toEqual(expect.objectContaining({ contentSha256: "a".repeat(64), fullContent: "FIXED PROFILE VIEWER PROMPT" }));
    expect(snapshots[0].rvSystemPrompt?.lockedBlocks?.map((block) => block.id)).toEqual(["locked-viewer-identity", "locked-activity-definition"]);
  });

  it("places a Special Viewer Task after Step 3 and before Extended deepening", () => {
    const prompt = injectRvLiteSpecialTask(getRvLite("pl", "extended").steps[2], "- Przejdź do Object A i opisz.", "pl", "extended");

    expect(prompt.indexOf("SPECJALNE ZADANIE VIEWERA")).toBeGreaterThan(prompt.indexOf("Teraz wykonaj Krok 3"));
    expect(prompt.indexOf("SPECJALNE ZADANIE VIEWERA")).toBeLessThan(prompt.indexOf("obowiązkowo wykonaj Deepening Movement"));
  });

  it("omits the name cleanly when the Profile has no AI name", async () => {
    let firstPrompt = "";
    let calls = 0;
    await runAutomaticRvLiteSession({
      repository: repository([]), workspaceId: "w", profileId: "profile", profileName: "", providerConfig: config, model,
      protocol: getRvLite("pl"), sessionLanguage: "pl", requestedSettings: { maxOutputTokens: 1024 },
      chat: async ({ messages }) => {
        calls += 1;
        if (calls === 1) firstPrompt = messages.at(-1)?.content ?? "";
        return { content: `Blind evidence ${calls}`, usage: {} };
      },
    });
    expect(firstPrompt).toContain("Witaj, przedstawiam układ sesji RV.");
    expect(firstPrompt).not.toContain("Nemo");
  });
});
