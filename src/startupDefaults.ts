import type { AppSettings } from "./types";

export const DEFAULT_INTERFACE_LANGUAGE = "en" as const;
export const DEFAULT_THEME = "aurora" as const;

export function createDefaultSettings(): AppSettings {
  return {
    interfaceLanguage: DEFAULT_INTERFACE_LANGUAGE,
    sessionLanguage: "same",
    theme: DEFAULT_THEME,
    requestTimeoutMs: 120_000,
    maxRetries: 2,
    defaultMaxOutputTokens: 8192,
    maxSessionCostUsd: 0,
    defaultRevealSource: "external",
    targetRepeatPolicy: "allow",
    sessionCodePrefix: "RVH",
    textScale: "normal",
    animations: true,
  };
}
