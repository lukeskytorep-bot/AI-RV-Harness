import type { InterfaceLanguage } from "../types";

export interface CustomProtocolVersion {
  protocolId: string;
  versionId: string;
  displayName: string;
  description?: string;
  version: string;
  language: InterfaceLanguage;
  systemPrompt?: string;
  steps: string[];
  contentHash: string;
  createdAt: string;
}

export interface SaveCustomProtocolVersionInput extends CustomProtocolVersion {}

export interface CustomProtocolDraft {
  name: string;
  description?: string;
  language: InterfaceLanguage;
  systemPrompt?: string;
  steps: string[];
}

export interface CustomProtocolDryRunStep {
  sequence: number;
  role: "Viewer" | "Reveal";
  prompt?: string;
  boundary: "BLIND" | "REVEAL";
}
