/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(process.cwd(), "src-tauri", "src");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("Etap 6 Rust provider module boundary", () => {
  it("keeps Tauri provider commands as a thin facade over focused Rust modules", () => {
    const facade = read("providers.rs");

    for (const moduleName of [
      "adapters",
      "errors",
      "reasoning",
      "request_builders",
      "response_parsers",
      "transport",
      "validation",
    ]) {
      expect(facade).toContain(`mod ${moduleName};`);
      expect(fs.existsSync(path.join(root, "providers", `${moduleName}.rs`))).toBe(true);
    }

    expect(facade).toContain("pub async fn provider_discover_models");
    expect(facade).toContain("pub async fn provider_chat");
    expect(facade).toContain("pub fn cancel_provider_request");

    for (const implementationSymbol of [
      "fn build_openai_compatible_request",
      "fn build_google_request",
      "fn build_anthropic_request",
      "fn parse_openai_compatible_response",
      "fn parse_google_response",
      "fn parse_anthropic_response",
      "fn normalize_reasoning_response",
      "fn send_chat_request",
    ]) {
      expect(facade).not.toContain(implementationSymbol);
    }
  });

  it("keeps wire-format ownership in the intended modules and Tauri command names stable", () => {
    const builders = read("providers/request_builders.rs");
    const parsers = read("providers/response_parsers.rs");
    const errors = read("providers/errors.rs");
    const adapters = read("providers/adapters.rs");
    const reasoning = read("providers/reasoning.rs");
    const transport = read("providers/transport.rs");
    const validation = read("providers/validation.rs");
    const lib = read("lib.rs");

    expect(builders).toContain("fn build_openai_compatible_request");
    expect(builders).toContain("fn build_google_request");
    expect(builders).toContain("fn build_anthropic_request");
    expect(builders).toContain("pub(super) fn build_openai_compatible_request");
    expect(builders).toContain("pub(super) fn build_google_request");
    expect(parsers).toContain("fn parse_openai_compatible_response");
    expect(parsers).toContain("fn parse_google_response");
    expect(parsers).toContain("fn parse_anthropic_response");
    expect(errors).toContain("fn provider_error_metadata");
    expect(reasoning).toContain("fn normalize_reasoning_response");
    expect(transport).toContain("async fn send_chat_request");
    expect(transport).toContain("static HTTP_CLIENT");
    expect(transport).toContain('env!("CARGO_PKG_VERSION")');
    expect(adapters).not.toContain("HTTP_CLIENT");
    expect(validation).toContain("fn validate_chat_request");
    expect(validation).toContain("fn validate_request_id");

    expect(lib).toContain("providers::provider_discover_models");
    expect(lib).toContain("providers::provider_chat");
    expect(lib).toContain("providers::cancel_provider_request");
  });
});
