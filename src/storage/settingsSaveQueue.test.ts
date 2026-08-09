import { describe, expect, it } from "vitest";
import { createDefaultSettings } from "../startupDefaults";
import { SettingsSaveQueue } from "./settingsSaveQueue";

describe("settings save queue", () => {
  it("serializes rapid changes so the newest settings are persisted last", async () => {
    const saved: string[] = [];
    const queue = new SettingsSaveQueue(async (settings) => {
      if (settings.interfaceLanguage === "pl") await Promise.resolve();
      saved.push(`${settings.interfaceLanguage}:${settings.theme}`);
    }, () => undefined);
    queue.enqueue({ ...createDefaultSettings(), interfaceLanguage: "pl", theme: "dark" });
    queue.enqueue({ ...createDefaultSettings(), interfaceLanguage: "en", theme: "aurora" });
    await queue.idle();
    expect(saved).toEqual(["pl:dark", "en:aurora"]);
  });

  it("continues after a failed save and reports the error", async () => {
    const saved: string[] = [];
    const errors: unknown[] = [];
    let first = true;
    const queue = new SettingsSaveQueue(async (settings) => {
      if (first) { first = false; throw new Error("disk busy"); }
      saved.push(settings.interfaceLanguage);
    }, (error) => errors.push(error));
    queue.enqueue(createDefaultSettings());
    queue.enqueue({ ...createDefaultSettings(), interfaceLanguage: "pl" });
    await queue.idle();
    expect(errors).toHaveLength(1);
    expect(saved).toEqual(["pl"]);
  });
});
