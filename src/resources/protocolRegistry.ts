import type { InterfaceLanguage } from "../types";
import rcpEn from "./protocols/RCP_v1.5a.en.md?raw";
import rcpPl from "./protocols/RCP_v1.5a.pl.md?raw";
import rvLiteEn from "./protocols/RV_Lite_v1.en.md?raw";
import rvLitePl from "./protocols/RV_Lite_v1.pl.md?raw";
import telepathyEn from "./protocols/Telepathy_v1.1.en.md?raw";
import telepathyPl from "./protocols/Telepathy_v1.1.pl.md?raw";

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
  version: "1.1.0";
  variant: "core" | "extended";
  language: InterfaceLanguage;
  displayName: string;
  content: string;
  contentSha256: string;
  steps: readonly [string, string, string, string];
  sourceFormat: "approved-message-derived-markdown";
}

export interface TelepathicProtocolResource {
  id: "telepathic-protocol";
  version: "1.1";
  language: InterfaceLanguage;
  displayName: string;
  content: string;
  contentSha256: string;
  sourceDocxSha256: string;
  sourceFormat: "approved-docx-derived-markdown";
  controllerStepCount: 9;
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

const telepathicResources: Record<InterfaceLanguage, TelepathicProtocolResource> = {
  pl: {
    id: "telepathic-protocol",
    version: "1.1",
    language: "pl",
    displayName: "Moduł Telepatia — protokół dla AI Viewera",
    content: telepathyPl,
    contentSha256: "f0e25179748ed9df6f2a4e00e10c3f20f8d2743c776e7d18c6a76949deeeb8ba",
    sourceDocxSha256: "bd933bb22c928457212a499e5fe56ca534abc11b1d4b59c590a515b8259f15b6",
    sourceFormat: "approved-docx-derived-markdown",
    controllerStepCount: 9,
  },
  en: {
    id: "telepathic-protocol",
    version: "1.1",
    language: "en",
    displayName: "Telepathy Module — Protocol for AI Viewer",
    content: telepathyEn,
    contentSha256: "9db147cf0935ecc33ca2cf307b46b7010c8f2e5428e8fafd62dc8f6004f3994b",
    sourceDocxSha256: "de7c5494f77c8777108dcdae50a7647058067926c5a3e2f92c02e9c7f81aaa43",
    sourceFormat: "approved-docx-derived-markdown",
    controllerStepCount: 9,
  },
};

export function getTelepathicProtocol(language: InterfaceLanguage): TelepathicProtocolResource {
  return telepathicResources[language];
}

const extendedRvLiteResources: Record<InterfaceLanguage, RvLiteProtocolResource> = {
  pl: {
    id: "rv-lite",
    version: "1.1.0",
    variant: "extended",
    language: "pl",
    displayName: "RV Lite",
    content: rvLitePl,
    contentSha256: "7118fa26eca259e8da3320ca7e6298e2699bb280d9b0363711ba30dec337c1f1",
    steps: extractRvLiteSteps(rvLitePl),
    sourceFormat: "approved-message-derived-markdown",
  },
  en: {
    id: "rv-lite",
    version: "1.1.0",
    variant: "extended",
    language: "en",
    displayName: "RV Lite",
    content: rvLiteEn,
    contentSha256: "d178a1b59ba8aba3e5c6cf70bfa1886c0629bb3143ed8b4ac67399c491489fbb",
    steps: extractRvLiteSteps(rvLiteEn),
    sourceFormat: "approved-message-derived-markdown",
  },
};

const coreRvLiteResources: Record<InterfaceLanguage, RvLiteProtocolResource> = {
  pl: makeCoreResource(extendedRvLiteResources.pl),
  en: makeCoreResource(extendedRvLiteResources.en),
};

export function getRvLite(language: InterfaceLanguage, variant: "core" | "extended" = "extended"): RvLiteProtocolResource {
  return variant === "core" ? coreRvLiteResources[language] : extendedRvLiteResources[language];
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

function makeCoreResource(extended: RvLiteProtocolResource): RvLiteProtocolResource {
  const third = extended.steps[2]
    .replace(/\nAfter completing Step 3,[\s\S]*?Do not name or guess the target\./, "\n\nDo not name or guess the target.")
    .replace(/\nPo zakończeniu Kroku 3[\s\S]*?Nie nazywaj celu ani nie zgaduj, czym jest\./, "\n\nNie nazywaj celu ani nie zgaduj, czym jest.");
  const steps = [extended.steps[0], extended.steps[1], third, extended.steps[3]] as const;
  const content = extended.content.replace(extended.steps[2], third)
    .replace(/RV Lite — approved English version/, "RV Lite Core — approved English version")
    .replace(/RV Lite — wersja polska zatwierdzona/, "RV Lite Core — wersja polska zatwierdzona");
  return {
    ...extended,
    variant: "core",
    displayName: "RV Lite Core",
    content,
    contentSha256: extended.language === "pl" ? "80a417f17029d3fe4f10a0b3af3d5fe65658ff3ce43ae23bda0d8864551377bd" : "740cebe1d2c18ef14fb66203289edf4e39dcd5cf5a5a08dbb6c9324632e8a5a2",
    steps,
  };
}
