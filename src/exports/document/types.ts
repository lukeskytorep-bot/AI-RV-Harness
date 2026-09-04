import type { InterfaceLanguage } from "../../types";

export interface StandardExportMetadata {
  workspace?: string;
  profile?: string;
  mode: string;
  protocol?: string;
  viewerModel?: string;
  monitorModel?: string;
  judgeModels?: string[];
  state?: string;
  createdAt?: string;
  completedAt?: string;
  exportedAt: Date;
}

export interface ExportMetadataField {
  label: string;
  value: string | number;
}

export interface MarkdownExportDocumentInput {
  language: InterfaceLanguage;
  title: string;
  metadata: StandardExportMetadata;
  additionalMetadata?: ExportMetadataField[];
  body?: string;
}
