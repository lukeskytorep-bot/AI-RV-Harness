import { describe, expect, it } from "vitest";
import database from "../src-tauri/src/database.rs?raw";
import documents from "../src-tauri/src/documents.rs?raw";
import nativeLibrary from "../src-tauri/src/lib.rs?raw";

describe("native CI compatibility guards", () => {
  it("declares the Tauri plugin configuration type explicitly", () => {
    expect(nativeLibrary).toContain('tauri::plugin::Builder::<_, ()>::new("pre-migration-backup")');
  });

  it("keeps the Rust warning fixes required by the release CI", () => {
    expect(database).not.toContain("use sqlx::{Acquire, Executor};");
    expect(database).not.toContain("Some(_) =>");
    expect(documents).not.toContain("let mut entry = archive.by_index(index)");
  });
});
