import { describe, expect, it } from "vitest";
import packageJson from "../package.json";
import tauriConfig from "../src-tauri/tauri.conf.json";
import { APP_VERSION } from "./version";

describe("application version", () => {
  it("keeps frontend, package, and Tauri versions aligned", () => {
    expect(APP_VERSION).toBe("0.7.12");
    expect(packageJson.version).toBe(APP_VERSION);
    expect(tauriConfig.version).toBe(APP_VERSION);
  });
});
