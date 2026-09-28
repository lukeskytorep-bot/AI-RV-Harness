import privacyEn from "./privacy.en.md?raw";
import privacyPl from "./privacy.pl.md?raw";

export const PRIVACY_POLICY_URL = "https://lukeskytorep-bot.github.io/AI-RV-Harness/privacy.html";
export const PRIVACY_POLICY_UPDATED = "2026-09-27";

export const PRIVACY_POLICY_RESOURCES = {
  en: { language: "en" as const, title: "AI RV Harness Privacy Policy", content: privacyEn, sha256: "20f6f3a3b05e1ab80210b851c0d6f5e91d9e3cbf6f0d4022b779866feed236e5" },
  pl: { language: "pl" as const, title: "Polityka prywatności AI RV Harness", content: privacyPl, sha256: "1433f6ec06abd85dee48635f2df5a554da4062d408578e2936c02846635dd003" },
} as const;
