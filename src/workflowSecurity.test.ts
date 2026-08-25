import { describe, expect, it } from "vitest";
import dependabot from "../.github/dependabot.yml?raw";
import ci from "../.github/workflows/ci.yml?raw";
import codeql from "../.github/workflows/codeql.yml?raw";
import linux from "../.github/workflows/release-linux.yml?raw";
import prepareCargoLock from "../.github/workflows/prepare-cargo-lock.yml?raw";
import windows from "../.github/workflows/release-windows.yml?raw";

const workflows = {
  "ci.yml": ci,
  "codeql.yml": codeql,
  "prepare-cargo-lock.yml": prepareCargoLock,
  "release-linux.yml": linux,
  "release-windows.yml": windows,
};

describe("GitHub workflow supply-chain policy", () => {
  it("pins every external action to a full commit SHA and never pushes from CI", () => {
    for (const [name, content] of Object.entries(workflows)) {
      const uses = [...content.matchAll(/uses:\s*([^\s#]+)/g)].map((match) => match[1]);
      for (const action of uses) {
        expect(action, `${name}: ${action}`).toMatch(/^[\w.-]+\/[\w.-]+(?:\/[\w.-]+)?@[a-f0-9]{40}$/);
      }
      expect(content).not.toMatch(/git\s+push/i);
    }
  });

  it("attests both Windows and Linux release packages with OIDC permissions", () => {
    for (const content of [windows, linux]) {
      expect(content).toContain("id-token: write");
      expect(content).toContain("attestations: write");
      expect(content).toContain("artifact-metadata: write");
      expect(content).toContain("actions/attest@");
    }
    expect(workflows["release-linux.yml"]).toContain("--bundles appimage,deb");
    expect(workflows["release-windows.yml"]).toContain("id: tauri_build");
    expect(workflows["release-linux.yml"]).toContain("id: tauri_build");
    expect(workflows["release-windows.yml"]).toContain("Require the expected Windows installers");
    expect(workflows["release-linux.yml"]).toContain("Require the expected Linux packages");
  });

  it("generates Cargo.lock only as a reviewable artifact and never modifies the repository", () => {
    expect(prepareCargoLock).toContain("cargo generate-lockfile");
    expect(prepareCargoLock).toContain("actions/upload-artifact@");
    expect(prepareCargoLock).toContain("contents: read");
    expect(prepareCargoLock).not.toMatch(/git\s+(commit|push)/i);
  });

  it("keeps routine Dependabot updates paused during release stabilization", () => {
    expect(dependabot.match(/open-pull-requests-limit:\s*0/g)).toHaveLength(3);
  });

  it("uses buildless Rust CodeQL while CI owns Rust compilation checks", () => {
    expect(codeql).toContain("languages: rust");
    expect(codeql).toContain("build-mode: none");
    expect(ci).toContain("cargo test --manifest-path src-tauri/Cargo.toml --all-targets --locked");
    expect(ci).toContain("cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked");
    expect(ci).not.toContain("cargo fmt");
  });
});
