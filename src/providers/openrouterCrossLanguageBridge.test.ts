import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { captureOpenRouterContinuationState } from "./openRouterContinuation";
import type { ProviderConfig } from "./types";
import {
  prepareProviderContinuationState,
  restoreProviderContinuationState,
  type PersistedProviderContinuationStateRow,
} from "../storage/providerContinuationState";

const rustOut = process.env.AI_RV_BRIDGE_RUST_OUT;
const tsOut = process.env.AI_RV_BRIDGE_TS_OUT;
const bridgeIt = rustOut && tsOut ? it : it.skip;

const config: ProviderConfig = {
  id: "provider-config",
  provider: "openrouter",
  label: "OpenRouter",
  credentialId: "credential",
  enabled: true,
  createdAt: "now",
  updatedAt: "now",
};

describe("OPENROUTER-CONTINUATION-COMPATIBILITY-2 cross-language bridge", () => {
  bridgeIt("takes the actual Rust stream result through TS capture and persisted restore", async () => {
    const rustResult = JSON.parse(fs.readFileSync(rustOut!, "utf8")) as {
      content: string;
      reasoningDetails: unknown[];
      modelId: string;
      normalizedEndpoint: string;
      providerConfigId: string;
      credentialId: string;
    };
    expect(rustResult.providerConfigId).toBe(config.id);
    expect(rustResult.credentialId).toBe(config.credentialId);

    const captured = captureOpenRouterContinuationState({
      config,
      requestedModelId: rustResult.modelId,
      normalizedEndpoint: rustResult.normalizedEndpoint,
      reasoningDetails: rustResult.reasoningDetails,
    });
    expect(captured.issue).toBeUndefined();
    expect(captured.state).toBeDefined();
    if (!captured.state) throw new Error("Rust bridge result was not captured");

    const prepared = await prepareProviderContinuationState(captured.state);
    const row: PersistedProviderContinuationStateRow = {
      ownerId: "bridge-assistant-message",
      format: prepared.format,
      formatVersion: prepared.formatVersion,
      transport: prepared.transport,
      replayFingerprintJson: prepared.replayFingerprintJson,
      payloadJson: prepared.payloadJson,
      payloadSha256: prepared.payloadSha256,
      payloadSizeBytes: prepared.payloadSizeBytes,
      createdAt: "2026-09-27T00:00:00.000Z",
    };
    const restored = await restoreProviderContinuationState(row);
    expect(restored.state.transport).toBe("openrouter");
    if (restored.state.transport !== "openrouter") throw new Error("Unexpected bridge transport");
    expect(restored.state.reasoningDetails).toEqual(rustResult.reasoningDetails);

    fs.writeFileSync(tsOut!, JSON.stringify({
      state: restored.state,
      modelId: rustResult.modelId,
      normalizedEndpoint: rustResult.normalizedEndpoint,
    }, null, 2));
  });
});
