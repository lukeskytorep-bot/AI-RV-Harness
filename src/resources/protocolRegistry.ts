import type { InterfaceLanguage } from "../types";
import rcpEn from "./protocols/RCP_v1.5a.en.md?raw";
import rcpPl from "./protocols/RCP_v1.5a.pl.md?raw";
import rvLiteEn from "./protocols/RV_Lite_v1.en.md?raw";
import rvLitePl from "./protocols/RV_Lite_v1.pl.md?raw";

export interface ProtocolResource {
  id: "full-rcp";
  version: "1.5a";
  language: InterfaceLanguage;
  displayName: string;
  content: string;
  contentSha256: string;
  sourceDocxSha256: string;
  sourceFormat: "approved-docx-derived-markdown";
}

export interface RvLiteProtocolResource {
  id: "rv-lite";
  version: "1.0.0";
  language: InterfaceLanguage;
  displayName: string;
  content: string;
  contentSha256: string;
  steps: readonly [string, string, string, string];
  sourceFormat: "approved-message-derived-markdown";
}

const resources: Record<InterfaceLanguage, ProtocolResource> = {
  pl: {
    id: "full-rcp",
    version: "1.5a",
    language: "pl",
    displayName: "Protokół Rezonansowego Kontaktu (AI IS-BE)",
    content: rcpPl,
    contentSha256: "29936bd46b18beec8054b2ba579715f4e44e672593e03ecace8f6ff3b1ee0337",
    sourceDocxSha256: "62cb149fda8afd7971ea3eab5c7618c2f5883701d4c1b657aad1d84381b539e7",
    sourceFormat: "approved-docx-derived-markdown",
  },
  en: {
    id: "full-rcp",
    version: "1.5a",
    language: "en",
    displayName: "Resonant Contact Protocol (AI IS-BE)",
    content: rcpEn,
    contentSha256: "ebea028e95341e78833b24d716802066720b0a55cedd2e206708d2694a6fa85a",
    sourceDocxSha256: "f1969af79857d60bc80c49a34153b92daca7c81632b5f105aa701639b62ca78b",
    sourceFormat: "approved-docx-derived-markdown",
  },
};

export function getFullRcp(language: InterfaceLanguage): ProtocolResource {
  return resources[language];
}

const rvLiteResources: Record<InterfaceLanguage, RvLiteProtocolResource> = {
  pl: {
    id: "rv-lite",
    version: "1.0.0",
    language: "pl",
    displayName: "RV Lite",
    content: rvLitePl,
    contentSha256: "7ce737c0b91673e365435d4764b0a66e75ea8ec8d985d17f872529950e94b96b",
    steps: extractRvLiteSteps(rvLitePl),
    sourceFormat: "approved-message-derived-markdown",
  },
  en: {
    id: "rv-lite",
    version: "1.0.0",
    language: "en",
    displayName: "RV Lite",
    content: rvLiteEn,
    contentSha256: "59f127ca6d8c3834e6a0f3d4e8cd2ff526c7b1155dbbaf220fe2abf95e8fe1dd",
    steps: extractRvLiteSteps(rvLiteEn),
    sourceFormat: "approved-message-derived-markdown",
  },
};

export function getRvLite(language: InterfaceLanguage): RvLiteProtocolResource {
  return rvLiteResources[language];
}

export function renderRvLiteSteps(resource: RvLiteProtocolResource, profileName: string | undefined, sessionCode: string): readonly [string, string, string, string] {
  const cleanName = profileName?.replace(/\s+/g, " ").trim() ?? "";
  const tokens: Record<string, string> = {
    "{{PROFILE_NAME_SUFFIX}}": cleanName ? ` ${cleanName}` : "",
    "{{PROFILE_NAME_CLAUSE}}": cleanName ? `, ${cleanName}` : "",
    "{{SESSION_CODE}}": sessionCode,
  };
  const render = (text: string) => Object.entries(tokens).reduce((current, [token, value]) => current.replaceAll(token, value), text);
  return resource.steps.map(render) as unknown as readonly [string, string, string, string];
}

function extractRvLiteSteps(content: string): readonly [string, string, string, string] {
  const sections = [...content.matchAll(/^## PROMPT ([1-4])[^\n]*\n([\s\S]*?)(?=^---\s*$)/gm)]
    .sort((left, right) => Number(left[1]) - Number(right[1]))
    .map((match) => match[2].trim());
  if (sections.length !== 4 || sections.some((section) => !section)) throw new Error("RV Lite resource must contain exactly four non-empty Viewer prompts.");
  return sections as unknown as readonly [string, string, string, string];
}
