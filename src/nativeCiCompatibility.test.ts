import { describe, expect, it } from "vitest";
import database from "../src-tauri/src/database.rs?raw";
import documents from "../src-tauri/src/documents.rs?raw";
import nativeLibrary from "../src-tauri/src/lib.rs?raw";
import providers from "../src-tauri/src/providers.rs?raw";
import storage from "../src-tauri/src/storage.rs?raw";

describe("native CI compatibility guards", () => {
  it("declares the Tauri plugin configuration type explicitly", () => {
    expect(nativeLibrary).toContain('tauri::plugin::Builder::<_, ()>::new("pre-migration-backup")');
  });

  it("keeps the Rust warning fixes required by the release CI", () => {
    expect(database).not.toContain("use sqlx::{Acquire, Executor};");
    expect(database).not.toContain("Some(_) =>");
    expect(documents).not.toContain("let mut entry = archive.by_index(index)");
  });

  it("keeps the Rust 1.98 Clippy fixes required by the release CI", () => {
    expect(providers).toContain("replace(['-', '_'], \"\")");
    expect(storage).toContain("sort_by_key(|record| std::cmp::Reverse(record.created_at_unix_ms))");
    expect(storage.match(/\.await\.inspect_err\(\|_\|/g)).toHaveLength(2);
    expect(documents).toContain("archive.is_empty()");
    expect(documents).toContain("image_metadata(bytes)");
    expect(documents).toContain("extension_matches_image(file_name, mime_type)");
  });
});
