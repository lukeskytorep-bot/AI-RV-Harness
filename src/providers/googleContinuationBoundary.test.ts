import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import fixture from "./continuation-fixtures/google-thought-signature.json";

const read = (relative: string) => fs.readFileSync(path.resolve(process.cwd(), relative), "utf8");

describe("GOOGLE-CONTINUITY-1 boundary", () => {
  it("anchors C4 to the live-observed Gemini 3.8 text-part signature contract", () => {
    expect(fixture.sourceKind).toBe("live-harness-observed-anonymized");
    expect(fixture.model).toBe("gemini-3.8-flash");
    const responsePart = fixture.providerResponse.candidates[0].content.parts[0];
    const oldPart = fixture.observedPreC4NextRequest.contents[1].parts[0];
    const replayPart = fixture.nextRequest.contents[1].parts[0];
    expect(responsePart.thoughtSignature).toBeTruthy();
    expect(oldPart).not.toHaveProperty("thoughtSignature");
    expect(replayPart).toEqual(responsePart);
  });

  it("captures signed visible Google parts in Rust and replays them through the Google request builder", () => {
    const parser = read("src-tauri/src/providers/response_parsers.rs");
    const builder = read("src-tauri/src/providers/request_builders.rs");
    const validation = read("src-tauri/src/providers/validation.rs");
    expect(parser).toContain('part.get("thoughtSignature")');
    expect(parser).toContain("parts.clone()");
    expect(builder).toContain("ProviderContinuationState::Google");
    expect(builder).toContain('value.insert("thoughtSignature"');
    expect(validation).toContain("Google continuation fingerprint is incompatible");
    expect(validation).toContain("Google continuation parts do not match the bound assistant message content");
  });

  it("keeps Google active in Conversation and Session while Anthropic remains Session-only under C5", () => {
    const chat = read("src/chat/engine.ts");
    const memory = read("src/chat/continuationMemory.ts");
    const session = read("src/sessions/providerContinuation.ts");
    expect(chat).toContain("captureGoogleContinuationState");
    expect(memory).toContain("validateGoogleReplayForRequest");
    expect(session).toContain("captureGoogleContinuationState");
    expect(session).toContain('transport: "google-native"');
    expect(session).toContain("captureAnthropicContinuationState");
    expect(session).toContain('prefixPolicy: "append-only"');
    expect(chat).not.toContain("captureAnthropicContinuationState");
    expect(memory).not.toContain("validateAnthropicReplayForRequest");
  });

  it("keeps Google continuation persistence on schema 025 and ProviderMessage v1 free of tool/function parts", () => {
    const migrations = read("src-tauri/src/migrations.rs");
    const contract = read("src/providers/continuationContract.ts");
    expect(migrations).toContain("version: 25");
    expect(migrations).toContain("version: 26");
    expect(contract).toContain("Function/tool parts remain outside the v1 message model");
    expect(contract).not.toContain('format: "opaque"');
  });
});
