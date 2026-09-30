import { describe, expect, it } from "vitest";
import capabilities from "../../src-tauri/capabilities/default.json";
import tauriConfig from "../../src-tauri/tauri.conf.json";

describe("native startup configuration", () => {
  it("keeps only plugin lifecycle permissions on the main window", () => {
    expect(capabilities.windows).toContain("main");
    expect(capabilities.permissions).toEqual(
      expect.arrayContaining(["sql:allow-load", "sql:allow-close"]),
    );
    expect(capabilities.permissions).not.toContain("sql:default");
    expect(capabilities.permissions).not.toContain("sql:allow-select");
    expect(capabilities.permissions).not.toContain("sql:allow-execute");
  });

  it("keeps the capability label and Windows bundle icon aligned", () => {
    expect(tauriConfig.app.windows.some((window) => window.label === "main")).toBe(true);
    expect(tauriConfig.bundle.icon).toContain("icons/icon.ico");
  });

  it("uses a light native background before the web interface is ready", () => {
    const mainWindow = tauriConfig.app.windows.find((window) => window.label === "main");

    expect(mainWindow?.backgroundColor).toBe("#f6f2ff");
  });
});
