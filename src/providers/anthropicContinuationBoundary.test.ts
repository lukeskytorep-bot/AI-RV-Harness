import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import fixture from "./continuation-fixtures/anthropic-thinking-blocks.json";

const read = (relative: string) => fs.readFileSync(path.resolve(process.cwd(), relative), "utf8");

describe("ANTHROPIC-CONTINUITY-1 boundary", () => {
  it("anchors replay to ordered thinking/redacted_thinking blocks from the official documented contract", () => {
    expect(fixture.sourceKind).toBe("official-documentation-derived-anonymized");
    expect(fixture.providerResponse.content.slice(0, 2)).toEqual(fixture.continuationState.blocks);
    expect(fixture.nextRequest.messages[1].content.slice(0, 2)).toEqual(fixture.continuationState.blocks);
    expect(fixture.nextRequest.messages[1].content[2]).toEqual({ type: "text", text: "Visible fixture answer." });
  });

  it("preserves exact Anthropic blocks in Rust and replays them before visible assistant text", () => {
    const parser = read("src-tauri/src/providers/response_parsers.rs");
    const builder = read("src-tauri/src/providers/request_builders.rs");
    const validation = read("src-tauri/src/providers/validation.rs");
    expect(parser).toContain('"redacted_thinking"');
    expect(parser).toContain("unsupported Anthropic continuation block layout");
    expect(builder).toContain("ProviderContinuationState::Anthropic");
    expect(validation).toContain("Anthropic continuation fingerprint is incompatible");
  });

  it("activates Anthropic only on frozen append-only Session routes and leaves ordinary Conversation text-only", () => {
    const session = read("src/sessions/providerContinuation.ts");
    const chat = read("src/chat/engine.ts");
    const memory = read("src/chat/continuationMemory.ts");
    const postReveal = read("src/sessions/postReveal.ts");
    expect(session).toContain("captureAnthropicContinuationState");
    expect(session).toContain('transport: "anthropic-native"');
    expect(session).toContain('prefixPolicy: "append-only"');
    expect(chat).toContain("buildLocalTemporalContext");
    expect(chat).not.toContain("captureAnthropicContinuationState");
    expect(memory).not.toContain("validateAnthropicReplayForRequest");
    expect(postReveal).toContain('frozenContinuationRoute?.transport === "anthropic-native" ? undefined');
  });

  it("keeps continuation persistence on schema 025 and does not expand v1 into tools/function calls", () => {
    const migrations = read("src-tauri/src/migrations.rs");
    const contract = read("src/providers/continuationContract.ts");
    expect(migrations).toContain("version: 25");
    expect(migrations).toContain("version: 26");
    expect(contract).toContain("Function/tool parts remain outside the v1 message model");
  });
});
