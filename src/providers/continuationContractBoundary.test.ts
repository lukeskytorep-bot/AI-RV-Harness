import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const read = (relative: string) => fs.readFileSync(path.resolve(process.cwd(), relative), "utf8");

describe("CONTINUATION-CONTRACT-0-R1 activation boundary", () => {

  it("keeps protected provider runtime files byte-for-byte on the green base", () => {
    const expected: Record<string, string> = {
      "src/providers/types.ts": "3d0403adbd48739d4b19e4868e49f3e3347ebff15426406a81582d256031d4d1",
      "src/providers/native.ts": "4a3e6b603470c124541dcecab73bab8026a0ad474a66042c2e490142b95246f3",
      "src-tauri/src/providers.rs": "a5e5b9c342d0e3f62fbf9b9fd64d51ce1b6ad859ecfd27589ac64bd3535aa1f2",
      "src-tauri/src/providers/request_builders.rs": "ba1c66d46d4bef64be7fefa71ee453bda8efafb1bddea9935d6cf27c0242a39a",
      "src-tauri/src/providers/response_parsers.rs": "47111749c8e0553d5371f180e9fad58ab8687658c1fd1d4983915b9f8bc380af",
      "src-tauri/src/migrations.rs": "e984345044a4a11f03a9c6655113592f97adb87b057cac2f647a6e84bf553731",
    };
    for (const [relative, expectedHash] of Object.entries(expected)) {
      const actual = crypto.createHash("sha256").update(fs.readFileSync(path.resolve(process.cwd(), relative))).digest("hex");
      expect(actual, relative).toBe(expectedHash);
    }
  });

  it("keeps runtime ProviderMessage and native dispatch unactivated", () => {
    const types = read("src/providers/types.ts");
    const native = read("src/providers/native.ts");
    const rustProviders = read("src-tauri/src/providers.rs");
    expect(types).not.toContain("continuationState?:");
    expect(native).not.toContain("continuationContract");
    expect(rustProviders).not.toContain("ProviderContinuationState");
  });

  it("does not add persistence or schema 025", () => {
    const migrations = read("src-tauri/src/migrations.rs");
    const contract = read("src/providers/continuationContract.ts");
    expect(migrations).not.toContain("version: 25");
    expect(contract).not.toContain("chat_message_provider_state");
    expect(contract).not.toContain("session_event_provider_state");
  });

  it("forbids a generic opaque or unknown-payload escape hatch", () => {
    const contract = read("src/providers/continuationContract.ts");
    expect(contract).not.toContain("payload: unknown");
    expect(contract).not.toContain('format: "opaque"');
  });

  it("keeps generic replay identity free of ambiguous reasoning mode semantics", () => {
    const contract = read("src/providers/continuationContract.ts");
    expect(contract).not.toContain("reasoningMode");
  });
});
