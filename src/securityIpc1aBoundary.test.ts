/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

function registeredCommandNames(): string[] {
  const lib = read("src-tauri/src/lib.rs");
  const block = lib.match(/tauri::generate_handler!\[([\s\S]*?)\]\)/)?.[1];
  if (!block) throw new Error("Tauri invoke handler list was not found");
  return block
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.split("::").at(-1) ?? entry)
    .sort();
}

function quotedList(source: string, marker: string): string[] {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`List marker not found: ${marker}`);
  const tail = source.slice(start + marker.length);
  const list = tail.match(/\[([\s\S]*?)\]/)?.[1];
  if (!list) throw new Error(`List body not found: ${marker}`);
  return [...list.matchAll(/"([a-z0-9_:-]+)"/g)].map((match) => match[1]).sort();
}

function productionTypeScriptFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...productionTypeScriptFiles(fullPath));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("SECURITY-IPC-1A trust-boundary hardening", () => {
  it("keeps migration registration and expected current version on one contiguous 001-023 registry", () => {
    const registry = read("src-tauri/src/migrations.rs");
    const lib = read("src-tauri/src/lib.rs");
    const migrationNames = fs
      .readdirSync(path.join(root, "src-tauri", "migrations"))
      .filter((name) => /^\d{3}_.*\.sql$/.test(name))
      .sort();

    expect(migrationNames).toHaveLength(23);
    expect(migrationNames[0]).toMatch(/^001_/);
    expect(migrationNames.at(-1)).toMatch(/^023_/);
    expect(migrationNames.some((name) => name.startsWith("024_"))).toBe(false);
    expect(registry).toContain("MIGRATION_SPECS[MIGRATION_SPECS.len() - 1].version");
    expect(registry).toContain("version: 23,");
    expect(lib).toContain("migrations::registered_migrations()");
  });

  it("removes direct dialog plugin permissions while retaining native Rust dialog ownership", () => {
    const capability = JSON.parse(read("src-tauri/capabilities/default.json")) as {
      windows: string[];
      permissions: string[];
    };
    const dialogs = read("src-tauri/src/dialogs.rs");

    expect(capability.windows).toEqual(["main"]);
    expect(capability.permissions).not.toContain("dialog:allow-open");
    expect(capability.permissions).not.toContain("dialog:allow-save");
    expect(dialogs).toContain("app.dialog().file()");

    for (const file of productionTypeScriptFiles(path.join(root, "src"))) {
      expect(fs.readFileSync(file, "utf8")).not.toContain("@tauri-apps/plugin-dialog");
    }
  });

  it("keeps AppManifest, app permission and invoke handler in exact command-set agreement", () => {
    const build = read("src-tauri/build.rs");
    const permission = read("src-tauri/permissions/main-window.toml");
    const capability = JSON.parse(read("src-tauri/capabilities/default.json")) as {
      permissions: string[];
    };

    const handlerCommands = registeredCommandNames();
    const manifestCommands = quotedList(build, "const APP_COMMANDS: &[&str] = &");
    const allowedCommands = quotedList(permission, "commands.allow");

    expect(build).toContain("AppManifest::new().commands(APP_COMMANDS)");
    expect(capability.permissions).toContain("main-window-commands");
    expect(manifestCommands).toEqual(handlerCommands);
    expect(allowedCommands).toEqual(handlerCommands);
  });

  it("does not expose an attachment filesystem path as an IPC import capability", () => {
    const frontend = read("src/attachments/native.ts");
    const lib = read("src-tauri/src/lib.rs");
    const dialogs = read("src-tauri/src/dialogs.rs");
    const documents = read("src-tauri/src/documents.rs");

    expect(frontend).toContain('invoke<ImportedAttachment[]>("choose_and_import_attachments"');
    expect(frontend).not.toContain('"choose_attachments"');
    expect(frontend).not.toContain('"import_attachment"');
    expect(lib).toContain("documents::choose_and_import_attachments");
    expect(lib).not.toContain("dialogs::choose_attachments");
    expect(lib).not.toContain("documents::import_attachment");
    expect(dialogs).toContain("pub(crate) async fn choose_attachment_paths");
    expect(dialogs).not.toContain("#[tauri::command]\npub async fn choose_attachments");
    expect(documents).toContain("dialogs::choose_attachment_paths(app, title).await?");
    expect(documents).not.toMatch(/#\[tauri::command\][\s\S]{0,120}fn import_attachment\s*\([^)]*path\s*:\s*String/);
  });
});
