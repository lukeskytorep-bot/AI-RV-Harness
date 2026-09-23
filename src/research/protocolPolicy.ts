import { getFullRcp, getRvLite, type ProtocolResource, type RvLiteProtocolResource } from "../resources/protocolRegistry";
import type { InterfaceLanguage } from "../types";
import type { ResearchProtocolSelection } from "./types";

export type ResearchProtocolResource = ProtocolResource | RvLiteProtocolResource;

function unsupportedResearchProtocol(selection: { id?: unknown }): never {
  const id = selection.id;
  throw new Error(`Unsupported Research protocol: ${String(id ?? "<missing>")}.`);
}

export function createResearchProtocolSelection(id: ResearchProtocolSelection["id"], language: InterfaceLanguage): ResearchProtocolSelection {
  if (id === "full-rcp") {
    const resource = getFullRcp(language);
    return { id: resource.id, version: resource.version, contentSha256: resource.contentSha256 };
  }
  if (id === "rv-lite") {
    const resource = getRvLite(language, "extended");
    return { id: resource.id, version: resource.version, variant: "extended", contentSha256: resource.contentSha256 };
  }
  return unsupportedResearchProtocol({ id });
}

export function resolveResearchProtocol(selection: ResearchProtocolSelection, language: InterfaceLanguage): ResearchProtocolResource {
  if (selection.id === "full-rcp") {
    const resource = getFullRcp(language);
    if (selection.version !== resource.version) throw new Error(`Unsupported Research Full RCP version: ${selection.version}.`);
    if (selection.contentSha256 && selection.contentSha256 !== resource.contentSha256) throw new Error("Locked Research Full RCP content no longer matches the bundled resource.");
    return resource;
  }

  if (selection.id === "rv-lite") {
    if (selection.version !== "1.1.0" || selection.variant !== "extended") {
      throw new Error(`Unsupported Research RV Lite selection: ${selection.version}/${selection.variant}.`);
    }
    const resource = getRvLite(language, "extended");
    if (selection.contentSha256 !== resource.contentSha256) throw new Error("Locked Research RV Lite content no longer matches the bundled resource.");
    return resource;
  }

  return unsupportedResearchProtocol(selection);
}

export function researchProtocolViewerCalls(selection: ResearchProtocolSelection): 4 | 6 {
  if (selection.id === "full-rcp") return 6;
  if (selection.id === "rv-lite") return 4;
  return unsupportedResearchProtocol(selection);
}

export function researchProtocolLabel(selection: ResearchProtocolSelection): string {
  if (selection.id === "full-rcp") return `Full RCP ${selection.version}`;
  if (selection.id === "rv-lite") return `RV Lite ${selection.version}`;
  return unsupportedResearchProtocol(selection);
}
