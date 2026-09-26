import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (relative: string) => fs.readFileSync(path.resolve(process.cwd(), relative), "utf8");

describe("CUSTOM-WIRE-PARAMETER-OVERRIDE-1 boundary", () => {
  it("keeps max_tokens as the Custom OpenAI compatibility default and scopes the override to Custom OpenAI only", () => {
    const types = read("src/providers/types.ts");
    const native = read("src/providers/native.ts");
    const service = read("src/providers/service.ts");
    const rust = read("src-tauri/src/providers.rs");
    const builders = read("src-tauri/src/providers/request_builders.rs");
    const validation = read("src-tauri/src/providers/validation.rs");

    expect(types).toContain('CustomOpenAiOutputTokenField = "max_tokens" | "max_completion_tokens"');
    expect(service).toContain('config.provider !== "custom_openai"');
    expect(native).toContain('input.config.provider === "custom_openai"');
    expect(rust).toContain("CustomOpenAiOutputTokenField");
    expect(builders).toContain("unwrap_or(super::CustomOpenAiOutputTokenField::MaxTokens)");
    expect(builders).toContain('ProviderKind::Openrouter | ProviderKind::Openai => "max_completion_tokens"');
    expect(builders).toContain('ProviderKind::Zai | ProviderKind::Deepseek | ProviderKind::Mistral | ProviderKind::Blackbox => "max_tokens"');
    expect(validation).toContain("override is allowed only for Custom OpenAI-compatible providers");
  });

  it("persists the optional override in existing settings and keeps its persistence on schema 025 while current schema advances", () => {
    const repository = read("src/storage/sqlite/settingsModelsRepository.ts");
    const writes = read("src/storage/databaseWriteOperations.ts");
    const migrations = read("src-tauri/src/migrations.rs");
    const docs = read("docs/README.md");

    expect(repository).toContain("provider.customOutputTokenField.");
    expect(repository).toContain("INSERT INTO app_settings");
    expect(repository).toContain("DELETE FROM app_settings WHERE key = $1");
    expect(writes).toContain("settings_models_delete_app_settings_01");
    expect(migrations).toContain("version: 25");
    expect(migrations).toContain("version: 26");
    expect(docs).toContain("Custom OpenAI wire parameter override");
  });

  it("exposes the control only on Custom OpenAI provider settings", () => {
    const settings = read("src/components/ProviderSettings.tsx");
    expect(settings).toContain('config.provider === "custom_openai"');
    expect(settings).toContain("CustomWireSettingsDialog");
    expect(settings).toContain("customOutputTokenDefault");
    expect(settings).toContain("customOutputTokenCompletion");
  });
});
