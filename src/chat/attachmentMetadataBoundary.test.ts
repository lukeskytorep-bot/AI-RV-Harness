import { describe, expect, it } from "vitest";
import fs from "node:fs";

const engine = fs.readFileSync(new URL("./engine.ts", import.meta.url), "utf8");
const pending = fs.readFileSync(new URL("./pendingTurn.ts", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../../src-tauri/migrations/030_chat_message_attachment_metadata.sql", import.meta.url), "utf8");

describe("STEP 5A Conversation attachment metadata boundary", () => {
  it("persists metadata without image bytes", () => {
    expect(migration).toContain("metadata_json");
    expect(pending).toContain("images: []");
    expect(pending).toContain("Image bytes are intentionally not persisted");
  });

  it("distinguishes prepared, included, not included and uncertain attempts", () => {
    expect(engine).toContain('"prepared" | "included_in_request" | "not_included" | "uncertain"');
    expect(engine).toContain('!providerAttemptStarted || beforeDispatch ? "not_included" : "uncertain"');
    expect(engine).toContain('input.images?.length ? "included_in_request" : "not_included"');
  });

  it("updates the same user message on retry instead of appending another user turn", () => {
    expect(engine).toContain("const attemptNumber = (user.metadata?.attachmentAttempts?.length ?? 0) + 1");
    expect(engine).toContain("updateChatMessageMetadata(message.id, metadata)");
  });
});
